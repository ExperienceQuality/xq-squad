# Implementation Plan: Repository-Native Devin Subagent Squad

## Overview

Build the `xq-squad` package source: a versioned, installable Devin subagent squad that consumers add to any repository. The result is a set of GitHub Release assets (`install.sh`, archive, checksum) plus a consumer-side installation that gives Devin an Agent Lead contract, specialist subagent profiles, a delivery skill, shared memory, and safe upgrade behavior. No standalone application or hosted service.

## Architecture decisions

- `.devin/` is the Devin-native activation layer inside the consumer repo.
- `.squad/` stores portable contracts, workflows, schemas, knowledge, memory, and install state.
- `AGENTS.md` at the consumer root remains the always-on entry point with a managed squad section.
- Specialist subagents are `.devin/agents/*.md` profiles that load `.squad/agents/*.md` role contracts.
- Main Devin session is Lead; no Lead subagent.
- The Lead drives the default workflow via `.devin/skills/squad-delivery/SKILL.md`.
- Executable tooling is `.sh` and `.mjs` only.
- JSON for config and schemas, Markdown for instructions and knowledge, NDJSON for structured memory.
- Release packaging is deterministic and validated before publication.
- Upgrades distinguish upstream-managed, merge-managed, and consumer-owned files.

## Task list

### Phase 1: Devin native contract

- [ ] Task 1: Create distribution root `AGENTS.md`
  - Acceptance: consumer root `AGENTS.md` template loads `.squad/README.md`, directs Devin to skill and Lead, keeps managed section identifiable.
  - Verify: `wc -c distribution/AGENTS.md` stays under 16384 bytes; section markers present.
  - Files: `distribution/AGENTS.md`
  - Dependencies: None

- [ ] Task 2: Create `.squad/README.md` and `.squad/squad.json`
  - Acceptance: README explains Lead role, file layout, native Devin integration, and consumer customization. squad.json lists components, release version, schema versions, and ownership rules.
  - Verify: JSON parses, required fields present.
  - Files: `distribution/.squad/README.md`, `distribution/.squad/squad.json`
  - Dependencies: Task 1

- [ ] Task 3: Create Lead contract
  - Acceptance: `.squad/agents/lead.md` defines intake, discovery, planning, execution, integration, verification, memory update, delivery, and fallback behavior.
  - Verify: content references relevant workflow files; no unsupported delegation claims.
  - Files: `distribution/.squad/agents/lead.md`
  - Dependencies: Task 2

- [ ] Task 4: Create specialist role contracts
  - Acceptance: each `.squad/agents/<role>.md` (analyst, implementer, tester, reviewer, memory-maintainer) has responsibilities, expected output, and report format.
  - Verify: contracts covered by contract checklist; no role assumes unsupported runtime.
  - Files: `distribution/.squad/agents/analyst.md`, `distribution/.squad/agents/implementer.md`, `distribution/.squad/agents/tester.md`, `distribution/.squad/agents/reviewer.md`, `distribution/.squad/agents/memory-maintainer.md`
  - Dependencies: Task 3

- [ ] Task 5: Create `.devin/agents` native profiles
  - Acceptance: each profile has valid frontmatter (`name`, `description`, `allowed-tools`), loads the matching `.squad/agents/<role>.md`, and defines expected output.
  - Verify: `devin doctor` validates frontmatter when installed.
  - Files: `distribution/.devin/agents/analyst.md`, `distribution/.devin/agents/implementer.md`, `distribution/.devin/agents/tester.md`, `distribution/.devin/agents/reviewer.md`, `distribution/.devin/agents/memory-maintainer.md`
  - Dependencies: Task 4

- [ ] Task 6: Create `.devin/skills/squad-delivery/SKILL.md`
  - Acceptance: skill provides task template, calls Lead workflow, instructs selective memory, verification, and memory maintenance before delivery.
  - Verify: frontmatter valid, file loads in skill listing.
  - Files: `distribution/.devin/skills/squad-delivery/SKILL.md`
  - Dependencies: Task 3

- [ ] Task 7: Create `.squad/workflows`
  - Acceptance: delivery, memory-maintenance, and parallel-execution workflows documented with clear steps and stop conditions.
  - Verify: Lead and skill reference workflows.
  - Files: `distribution/.squad/workflows/delivery.md`, `distribution/.squad/workflows/memory-maintenance.md`, `distribution/.squad/workflows/parallel-execution.md`
  - Dependencies: Task 3

- [ ] Checkpoint 1
  - [ ] Distribution `AGENTS.md`, `squad.json`, Lead, roles, profiles, skill, and workflows exist.
  - [ ] Devin doctor passes on a test install.
  - [ ] Files remain within size and scope limits.

### Phase 2: Memory system

- [ ] Task 8: Create NDJSON memory schema
  - Acceptance: schema covers `id`, `type`, `topic`, `summary`, `details`, `source`, `status`, `created_at`, `updated_at`, `supersedes`, and version.
  - Verify: JSON Schema validates sample records and rejects invalid ones.
  - Files: `distribution/.squad/schemas/memory-record.schema.json`
  - Dependencies: Task 2

- [ ] Task 9: Create memory update script
  - Acceptance: `memory-update.mjs` validates NDJSON, detects duplicates, handles `supersedes`, prevents concurrent overwrite, and reports outcome.
  - Verify: unit tests cover valid append, invalid line, duplicate ID, superseded status, and simultaneous-write conflict.
  - Files: `scripts/memory-update.mjs`, `tests/memory-update.test.mjs`
  - Dependencies: Task 8

- [ ] Task 10: Create memory search/retrieval script
  - Acceptance: `memory-search.mjs` filters by type, topic, status, source, and keywords, returns ranked bounded context packet.
  - Verify: unit tests cover keyword match, status filter, budget limit, and output references.
  - Files: `scripts/memory-search.mjs`, `tests/memory-search.test.mjs`
  - Dependencies: Task 8

- [ ] Task 11: Create `MEMORY.md` template
  - Acceptance: consumer-owned canonical memory summary template with sections for repository map, conventions, architecture, and testing strategy.
  - Verify: template is Markdown and is copied only on fresh install.
  - Files: `distribution/.squad/MEMORY.md`
  - Dependencies: Task 2

- [ ] Checkpoint 2
  - [ ] Schema validates.
  - [ ] Memory update and search scripts pass tests.
  - [ ] `MEMORY.md` template is install-once.

### Phase 3: Release packaging

- [ ] Task 12: Define distribution manifest and packaging rules
  - Acceptance: tool knows exactly which files go into the archive; development-only files excluded.
  - Verify: list of expected paths matches distribution tree.
  - Files: `scripts/package-release.sh`, `scripts/manifest.txt`
  - Dependencies: Tasks 1–11

- [ ] Task 13: Implement archive and checksum generation
  - Acceptance: script produces `squad-vX.Y.Z.tar.gz` and `.sha256` with deterministic content, excluding tests and source-only files.
  - Verify: archive unpacks into `AGENTS.md`, `.devin/`, `.squad/`; checksum verifies; `tar tzf` matches manifest.
  - Files: `scripts/package-release.sh`
  - Dependencies: Task 12

- [ ] Task 14: Implement packaging validation
  - Acceptance: `scripts/validate.sh` checks required files, schema validity, no forbidden executables, no oversized `AGENTS.md`, archive correctness.
  - Verify: `bash scripts/validate.sh` passes; intentionally broken package fails with clear message.
  - Files: `scripts/validate.sh`
  - Dependencies: Tasks 8, 12, 13

- [ ] Checkpoint 3
  - [ ] Packaged archive and checksum produced.
  - [ ] Validation script passes.

### Phase 4: Safe installation

- [ ] Task 15: Implement `install.sh` preflight
  - Acceptance: checks target exists, is a git repo, version format, required commands, uncommitted changes, existing squad files, write permissions.
  - Verify: test each failure mode returns clear error code and message.
  - Files: `install.sh`
  - Dependencies: Task 12

- [ ] Task 16: Implement archive download and verification
  - Acceptance: downloads from GitHub Release, verifies SHA-256, rejects path traversal and unsafe entries, validates contents.
  - Verify: tests for valid, missing, bad checksum, and invalid archive entries.
  - Files: `install.sh`, `tests/install-download.test.sh`
  - Dependencies: Task 13, 15

- [ ] Task 17: Implement managed `AGENTS.md` section
  - Acceptance: preserves existing file, inserts identifiable managed section, detects duplicate, updates managed section without touching unrelated text.
  - Verify: fixtures for fresh, existing-no-conflict, existing-with-managed-section, existing-with-overlap.
  - Files: `install.sh`, `tests/agents-merge.test.sh`
  - Dependencies: Task 15

- [ ] Task 18: Implement file installation and idempotency
  - Acceptance: copies distribution files, skips memory/knowledge if present, records install state with version and ownership.
  - Verify: repeated install same version makes no duplicate changes; changed version updates managed files.
  - Files: `install.sh`, `tests/install-idempotent.test.sh`
  - Dependencies: Tasks 16, 17

- [ ] Checkpoint 4
  - [ ] Fresh install works.
  - [ ] Repeated install is idempotent.
  - [ ] Existing `AGENTS.md` preserved.
  - [ ] State file records version and ownership.

### Phase 5: Safe upgrade

- [ ] Task 19: Implement `update.sh` entry point
  - Acceptance: parses `--target` and `--version`, loads installed state, runs preflight similar to install.
  - Verify: invalid arguments and missing state fail safely.
  - Files: `update.sh`, `distribution/.squad/scripts/update.sh`
  - Dependencies: Task 18

- [ ] Task 20: Implement three-way managed-file comparison
  - Acceptance: compares old baseline, current consumer file, and new release file; reports clean update, no-op, or conflict.
  - Verify: unit tests for unchanged, upstream change only, consumer change only, both change same line, both change different lines, deletion vs update.
  - Files: `scripts/merge-managed.mjs`, `tests/merge-managed.test.mjs`
  - Dependencies: Task 19

- [ ] Task 21: Implement safe apply and state update
  - Acceptance: applies non-conflicting upstream changes, preserves consumer-owned files, stages conflicts, updates install state only after success.
  - Verify: fixture upgrade from v1.0.0 to v1.1.0; consumer edits preserved; conflicts reported.
  - Files: `update.sh`, `tests/upgrade.test.sh`
  - Dependencies: Task 20

- [ ] Checkpoint 5
  - [ ] Upgrade succeeds when upstream changed only.
  - [ ] Consumer edits preserved.
  - [ ] Conflicts reported and not silently overwritten.

### Phase 6: End-to-end validation

- [ ] Task 22: Create sample consumer repository fixture
  - Acceptance: fixture has an existing tech stack, existing `AGENTS.md`, existing memory, and local customization.
  - Verify: fixture builds and tests on its own.
  - Files: `tests/fixtures/sample-consumer/` and its stack files
  - Dependencies: None

- [ ] Task 23: Run install, upgrade, and workflow tests
  - Acceptance: full suite covers packaging, installation, upgrade, memory, and failure paths.
  - Verify: `bash scripts/validate.sh && node --test tests/*.test.mjs && bash tests/*.test.sh` passes.
  - Files: existing test files
  - Dependencies: Tasks 14, 18, 21, 22

- [ ] Task 24: Produce Devin compatibility report
  - Acceptance: report documents what was tested in real Devin session, what was simulated, and what remains unverified.
  - Verify: report committed or attached.
  - Files: `docs/devin-compatibility-report.md`
  - Dependencies: Tasks 5, 6, 23

- [ ] Task 25: Finalize documentation
  - Acceptance: README, CONTRIBUTING, CHANGELOG, and consumer onboarding docs are complete and accurate.
  - Verify: docs reviewed against installed fixture.
  - Files: `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `docs/consumer-onboarding.md`
  - Dependencies: Task 24

- [ ] Checkpoint 6
  - [ ] All tests pass.
  - [ ] Sample consumer installation works.
  - [ ] Devin compatibility report completed.
  - [ ] Documentation ready.
  - [ ] No uncommitted changes remain unless authorized.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Custom subagents unavailable in consumer Devin environment | High | Design sequential fallback; never require subagent delegation. |
| Managed `AGENTS.md` section conflicts with consumer rules | Medium | Explicit section markers, three-way merge, conflict reporting. |
| Archive non-deterministic across platforms | Medium | Sorted file list, normalized metadata, sha256 verification. |
| NDJSON concurrent update loses data | Medium | One-writer update script, validate before commit. |
| Release published untested | High | Validate before packaging, manual approval gate before publishing. |
| Consumer repo dirty state corrupted | Medium | Preflight check, backup/staging, failure rollback. |

## Open questions

1. Do you want the first release version to be `v0.1.0` or `v1.0.0`?
2. Which sample consumer repo should be used for end-to-end validation: a new fixture or an existing repository from `/Users/davidchau/Documents/repo/`?
3. Should `install.sh` support a `--dry-run` flag for the initial implementation?
