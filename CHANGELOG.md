# Changelog

## [1.0.3]

### Added

- Consumer usage documentation: "Using the squad" and "Updating" sections in README covering Devin chat usage, delegation fallback, memory, and authority boundaries; expanded "How to use" in `.squad/README.md` shipped to consumers.

### Changed

- `update.sh` is now published as a release asset, so upgrades can be piped via `curl | sh` like installs.

## [1.0.2]

### Fixed

- Install/update no longer require confirmation or `--yes` for uncommitted changes that don't overlap squad-managed paths (`AGENTS.md`, `.devin/`, `.squad/`). Only overlapping dirty files prompt or fail non-interactively.

## [1.0.1]

### Fixed

- Installer no longer requires Node.js or shasum (POSIX fallbacks for AGENTS.md merge and install-state; sha256sum/openssl supported).

## [1.0.0] - 2026-10-17

### Added

- Initial XQ Squad release.
- Agent Lead contract and delivery workflow.
- Specialist subagent profiles: analyst, implementer, tester, reviewer, memory-maintainer.
- `.devin/skills/squad-delivery` on-demand skill.
- Shared memory schema, NDJSON update and search scripts.
- Versioned release packaging with deterministic archive and SHA-256 checksum.
- Safe installer with managed `AGENTS.md` section, idempotency, and preflight checks.
- Safe updater with ownership classes and consumer-edit preservation.
- Validation, install, upgrade, and end-to-end tests.
