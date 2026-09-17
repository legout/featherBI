"""Shared remote-source plumbing for featherBI's uv scripts.

Credentials follow the remote sources specification: the AWS credential chain
(environment, profiles, SSO) first, then a gitignored `.env` (from the working
directory upward) naming FTHR_S3_* variables. Secrets never reach output.
"""

import os
import re
from pathlib import Path

import duckdb  # pyright: ignore[reportMissingImports] # resolved by `uv run --script` from the caller's PEP 723 block

REMOTE_INPUT = re.compile(r"^[a-z][a-z0-9+.-]*://", re.IGNORECASE)
ENV_PREFIX = "FTHR_S3_"


def is_remote(input_path):
    return bool(REMOTE_INPUT.match(input_path))


def env_with_dotenv():
    """Process environment overlaid with a manually parsed .env from cwd upward."""
    values = dict(os.environ)
    for directory in [Path.cwd(), *Path.cwd().parents]:
        candidate = directory / ".env"
        if candidate.is_file():
            for line in candidate.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                line = line.removeprefix("export ")
                key, sep, value = line.partition("=")
                if not sep or not key.strip():
                    continue
                value = value.strip().strip('"').strip("'")
                values.setdefault(key.strip(), value)
            break
    return values


def redact_secrets(message, values):
    """Replace every configured FTHR_S3_* value with a placeholder."""
    safe = message
    for name, value in values.items():
        if name.startswith(ENV_PREFIX) and value:
            safe = safe.replace(value, "<redacted>")
    return safe


def load_httpfs(con):
    """Load httpfs, installing it once into the DuckDB extension cache if missing."""
    try:
        con.execute("LOAD httpfs")
    except duckdb.Error:
        con.execute("INSTALL httpfs")
        con.execute("LOAD httpfs")


def sql_literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def s3_credentials(source_id, values, region=None, endpoint=None):
    """Build config-provider options; raise with the required secret named."""
    def get(name):
        return values.get(f"{ENV_PREFIX}{name}", "")

    key_id = get("KEY_ID")
    secret = get("SECRET")
    if not key_id or not secret:
        raise ValueError(
            f"source {source_id!r} requires S3 credentials; set {ENV_PREFIX}KEY_ID "
            f"and {ENV_PREFIX}SECRET in the process environment or in a gitignored "
            ".env file (see .env.example), or configure the AWS credential chain"
        )
    region = region or get("REGION")
    endpoint = endpoint or get("ENDPOINT")
    options = [f"KEY_ID {sql_literal(key_id)}", f"SECRET {sql_literal(secret)}"]
    for value, sql_name in (
        (get("SESSION_TOKEN"), "SESSION_TOKEN"),
        (region, "REGION"),
        (endpoint, "ENDPOINT"),
    ):
        if value:
            options.append(f"{sql_name} {sql_literal(value)}")
    use_ssl = get("USE_SSL").lower()
    if use_ssl in ("true", "false"):
        options.append(f"USE_SSL {use_ssl}")
    if endpoint:
        # ponytail: path-style for explicit endpoints; add a URL_STYLE override if a virtual-hosted S3-compatible endpoint appears.
        options.append("URL_STYLE 'path'")
    return " ".join(options)


def credential_chain_secret(con):
    """Create a temporary secret from the AWS credential chain; report success."""
    try:
        con.execute(
            "CREATE OR REPLACE TEMP SECRET fthr_s3 "
            "(TYPE s3, PROVIDER credential_chain)"
        )
        return True
    except duckdb.Error:
        # A failed creation leaves nothing behind; CREATE OR REPLACE in the
        # config-provider path below supersedes any earlier secret.
        return False


def configure_remote(con, source_id, auth, secret_values, region=None, endpoint=None):
    """Prepare one engine for remote reads with the resolved credentials."""
    load_httpfs(con)
    if auth != "s3":
        return
    if credential_chain_secret(con):
        return
    con.execute(
        "CREATE OR REPLACE TEMP SECRET fthr_s3 "
        f"(TYPE s3, PROVIDER config, {s3_credentials(source_id, secret_values, region, endpoint)})"
    )
