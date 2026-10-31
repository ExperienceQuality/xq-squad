# Changelog

## [1.3.0] - 2026-10-31

### Added

- New managed helper `.squad/scripts/fetch-openapi-spec.mjs`: downloads the
  latest `openapi/<service>/openapi.yaml` contract from the centralized
  `xq-luthor` repository into the consumer repo root `openapi/` directory.
  Supports `--all`, `--list`, `--out`, `--ref`, and `--repo`; authenticates via
  the `gh` CLI, `GH_TOKEN`/`GITHUB_TOKEN`, or unauthenticated access for
  public repos; output is anchored to the git repo root regardless of the
  caller's working directory.
- New managed skill `fetch-openapi-spec`
  (`.devin/skills/fetch-openapi-spec/SKILL.md`): lets the consumer's agent
  sync API contracts on request, reporting the resolved source sha and
  surfacing the contract diff before any client regeneration. Registered in
  `squad.json` under `components.skills`.

## [1.2.1] - 2026-10-30

### Fixed

- `update.sh` now installs managed files first shipped by a release. The
  upgrader previously only iterated the consumer's recorded `managed_files`,
  so files new to a release — such as `train-me` in v1.2.0 — were never
  copied or registered. Consumers on v1.2.0 receive `train-me` automatically
  with this update; a differing consumer file at a new managed path is
  preserved and reported as a conflict.

## [1.2.0] - 2026-10-30

### Added

- New managed skill `train-me` (`.devin/skills/train-me/SKILL.md`): a patient
  tutor that helps the user learn any technical topic through simple
  explanations, analogies, and guided questions. Registered in `squad.json`
  under `components.skills`.

### Fixed

- Concurrent `acquire` no longer fails permanently on transient registry
  mutex contention during activation. Mutex-busy results are flagged
  (`contended: true`) and the activation lock retries briefly before
  reporting retained-claim recovery.

## [1.1.0] - 2026-10-25

### Added

- Opt-in concurrent delivery protocol for separate Devin sessions in the same
  consumer repository: approved per-delivery worktree isolation
  (`.squad/worktrees/<id>` on `squad/<id>`), hard-blocking scope claims in a
  shared common-dir registry, explicit stopped-confirmation resume/release
  that preserves work, delivery-write verification, and delivery-local memory
  sources (`memory-search.mjs --source`). Requires Node.js ≥ 20 in the
  consumer and a base commit containing compatible installed `.squad` helpers.
  Validated end-to-end with two real Devin CLI sessions; see
  `docs/devin-compatibility-report.md` and
  `distribution/.squad/workflows/concurrent-delivery.md`.

### Fixed

- The Lead contract is now inside the managed `AGENTS.md` section, so it is installed into repositories that already have an `AGENTS.md`. Upgrading repairs v1.0.0–v1.0.4 installs and removes the legacy duplicated block; release packaging stamps the managed marker with the package version.

## [1.0.4]

### Added

- Mermaid anatomy and delivery-lifecycle diagrams in the repo and distribution READMEs.
- `docs/ideas/concurrent-delivery.md` — design note for parallel squad deliveries via worktree isolation.
- Rebase-onto-remote-target requirement before any authorized push or PR (`workflows/delivery.md`, `agents/lead.md`).

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
