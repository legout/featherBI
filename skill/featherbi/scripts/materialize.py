#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb==1.5.5"]
# ///
"""Fetch one declared remote source to a local file for packaged delivery."""

import argparse
import sys
from pathlib import Path

# Resolved by `uv run --script` from the PEP 723 block above.
import duckdb  # pyright: ignore[reportMissingImports]
# Resolved at runtime: `uv run --script` puts this script's directory on sys.path.
from remote_common import configure_remote, env_with_dotenv, redact_secrets  # pyright: ignore[reportMissingImports]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("uri")
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--format", required=True, choices=("csv", "parquet", "json"))
    parser.add_argument("--auth", choices=("none", "s3"), default="none")
    parser.add_argument("--region")
    parser.add_argument("--endpoint")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    env = env_with_dotenv()
    con = duckdb.connect(":memory:")
    try:
        configure_remote(con, args.source_id, args.auth, env, args.region, args.endpoint)
        blob = con.execute(
            "SELECT content FROM read_blob(?)", [args.uri]
        ).fetchone()
        if blob is None:
            raise ValueError("remote source returned no content")
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(blob[0])
    except Exception as error:
        message = redact_secrets(str(error), env)
        print(
            f"cannot materialize source {args.source_id!r} as {args.format}: {message}",
            file=sys.stderr,
        )
        return 1
    finally:
        con.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
