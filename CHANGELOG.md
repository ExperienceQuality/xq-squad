# Changelog

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
