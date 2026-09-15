---
name: make-release
description: Prepare and publish semver GitHub releases for Python/uv, Node projects, or VERSION-based skill catalogs, optionally publishing Python packages to PyPI. Use for version bumps, changelogs, tags, or releases.
compatibility: Requires git and gh; Python publishing requires uv; Node releases require the repository's package manager.
---

# Make Release

Create one release from a clean default branch: select or bump the version, finalize the changelog, validate the release, commit, push, tag, publish a GitHub Release, and optionally publish a Python package to PyPI. A skill catalog uses its root `VERSION` and Git snapshot; do not invent a package manifest or package build.

If specialized changelog, commit, GitHub, or uv skills are installed, they may assist; this workflow remains complete without them.

## Inputs

Resolve these from the request and repository before asking:

- bump: `patch`, `minor`, or `major`; `initial` explicitly publishes a VERSION-based catalog's prepared version without bumping, only when the catalog has no prior releases;
- package when a monorepo or mixed Python/Node repository has multiple candidates; and
- for Python, whether this release should publish to PyPI.

Ask only for unresolved choices. A Python project's first PyPI release must also ask for its publishing method: `github` workflow or local `uv publish`. Do not choose a default.

## Preflight

1. Require a clean Git worktree on the repository's default branch with an upstream. Fetch and require the local branch to equal its upstream. If it is behind or diverged, stop and ask the user to update it before release work. Never force-push.
2. Verify `gh auth status` and the GitHub remote.
3. Detect the version source:
   - Python: static `[project].version` in `pyproject.toml`.
   - Node: `version` in the selected `package.json`.
   - Skill catalog: a root `VERSION` explicitly designated by repository docs, containing one stable `MAJOR.MINOR.PATCH` value without a `v` prefix. It versions the catalog, not individual skills, upstream pins/schema versions, or nested vendored package manifests.
4. If multiple canonical version sources or multiple packages are present, select one package unless their manifests clearly describe the same release and currently have the same version. Never silently synchronize unrelated packages.
5. Calculate the next semantic version from the requested bump and documented repository compatibility policy. For catalog `initial`, keep the prepared `VERSION`; refuse if a prior catalog release exists. Stop on non-semantic or dynamically generated versions rather than guessing.
6. Verify that the intended `v<version>` tag and published version are absent locally, remotely, and on GitHub Releases, plus the selected package registry when applicable. A catalog's prepared VERSION file is not an existing publication. Catalog-only releases have no npm/PyPI registry check.
7. Inspect commits since the latest release tag and confirm there is a releasable change. For `initial`, inspect the current catalog and available history as the baseline; do not invent an earlier release.

## First PyPI setup

Use `[project].name` as the distribution name and show it to the user for confirmation. Check whether that name exists on PyPI; absence is valid for a first release. The package name in `pyproject.toml` is canonical—do not invent a separate release name.

Ask the user to choose one method, with no default:

### GitHub workflow

1. Ask whether to use PyPI Trusted Publishing or a GitHub Actions secret. Recommend Trusted Publishing, but require the user's choice.
2. Draft one dedicated publish workflow that builds with `uv build`, passes the exact built artifacts between jobs, and publishes with every third-party action—including `pypa/gh-action-pypi-publish`—pinned to a reviewed full commit SHA on version tags. Do not write it before release-plan approval.
3. For Trusted Publishing, add `permissions: id-token: write` and a named GitHub environment. Tell the user the exact repository owner, repository, workflow filename, environment, and PyPI project name to register on PyPI. Stop before releasing until the user confirms that publisher setup is complete.
4. For secret authentication, reference `${{ secrets.PYPI_API_TOKEN }}`. Never request or print the token in chat or write it to the repository. Ask the user to set it through GitHub's secret UI or an interactive `gh secret set PYPI_API_TOKEN`, then verify only that the secret name exists.
5. Keep the action's default artifact attestations enabled. Treat the committed workflow as the persistent publishing-method configuration and reuse it on later releases.

### Local `uv publish`

1. Require `uv` and a configured `UV_PUBLISH_TOKEN`, or obtain the token through a secure interactive mechanism that does not expose it to the model or shell history.
2. Do not create `.pypirc`: `uv publish` does not use it. Do not commit credentials or place them in `pyproject.toml`.
3. Never infer publishing mode from credential availability. Reuse an established repository publishing workflow; otherwise ask the user to choose local or GitHub publishing for this release.

## Release plan and approval

Before the first mutation, display one exact plan containing:

- old version, requested bump, new version, and rationale;
- commits and user-facing changelog entries since the prior tag;
- files to change, including any first-use PyPI workflow;
- build and package-inspection commands;
- commit, tag, push, GitHub Release, and optional PyPI actions; and
- the partial-state boundary after each remote action.

If `--dry-run` is present, stop after this preview. Otherwise require explicit approval of the complete plan. A changed choice regenerates the preview. Do not edit manifests, changelogs, lockfiles, or workflows before approval.

## Version and changelog

1. Write any approved first-use publishing workflow, then update only the selected canonical version source:
   - Python: edit `[project].version`; run `uv lock` when `uv.lock` exists.
   - Node: use the lockfile's package manager version command with tag/commit creation disabled so its manifest and lockfile stay synchronized.
   - Skill catalog: edit only root `VERSION` (leave it unchanged for `initial`); never bump schema versions, upstream pins, individual skills, or vendored manifests.
2. Collect notable user-facing changes since the latest release tag.
3. Update `CHANGELOG.md`, or `CHANGELOG` when that is the repository convention. Create `CHANGELOG.md` only when neither exists.
4. Finalize the current Unreleased entries under `## <version> - <YYYY-MM-DD>` (preserving the repository's heading/link style) and leave a fresh empty Unreleased section above it.
5. Re-read the changelog and verify that the new version heading exists and contains at least one real entry. Stop before committing if the write is missing, empty, duplicated, or includes claims unsupported by the inspected commits.

## Build validation

Run the repository's established release checks, including its configured tests, lint/type checks, and build. Do not substitute a package build for behavioral validation. Then perform ecosystem-specific package inspection:

- Python: show any stale distribution artifacts and remove only known build outputs covered by the approved plan, run `uv build`, run `uvx twine check dist/*`, and inspect wheel/sdist names plus embedded name/version metadata.
- Node: run the repository's build script when present, then run the package manager's pack dry-run and inspect included files.
- Skill catalog: run its declared structure/link/contract tests and required checks; inspect the tracked file list that the Git tag will expose. Require the dated changelog heading to match `VERSION` before publication. Do not run npm pack, create a package manifest, or build vendored tools merely to release the catalog. Existing catalog checks may still call vendored tests when required by project policy.

Stop on any build failure or unexpected package contents. Do not publish broken or stale artifacts.

## Publish release

1. Review the exact version, changelog, workflow/configuration, lockfile, and generated-file diff. Exclude build artifacts unless the repository intentionally tracks them. The release commit must contain only release metadata and approved publishing configuration, never feature fixes or unrelated edits.
2. Create one release commit: `chore(release): <version>`. Never bypass commit hooks with `--no-verify`.
3. Push the default branch normally and verify its remote SHA.
4. Create annotated tag `v<version>`, push it, and verify the remote tag SHA. Never move or replace an existing tag.
5. For local Python publishing, run `uv publish` against the artifacts built from the committed version and verify the released version through PyPI.
6. For GitHub-workflow PyPI publishing, resolve the run ID whose workflow file, tag, and head SHA match this release, then watch that exact run with `gh run watch <run-id>`; stop and report if it fails.
7. Write the finalized changelog section to a unique `mktemp` notes file, create the GitHub Release with `gh release create v<version> --verify-tag --notes-file <file>`, remove the temporary file, then verify the release URL and published state.
8. After PyPI publication, install the exact released version in a fresh temporary uv environment and run the smallest import or CLI smoke check. If consumer installation fails, do not rewrite the release; report it and prepare a patch release.

If any remote publication step fails, do not rewrite history, delete published releases, or conceal partial state. Report exactly which commit, tag, GitHub Release, workflow, or PyPI version exists and the safest retry command.

## Report

Report the old and new versions, changed files, build commands and artifacts, release commit, pushed tag, GitHub Release URL, and PyPI result or explicit skip.
