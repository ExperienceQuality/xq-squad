# Concurrent Delivery — Implementation Plan

Status: **Approved 2026-10-24. Complete 2026-10-25.** All tasks done — T1 through T12; all
8 final gate commands green in one pass, followed by focused final-review regression checks.
T12 real two-session Devin validation **PASSED** (see
`docs/devin-compatibility-report.md`).

Approved spec: [docs/spec-concurrent-delivery.md](../docs/spec-concurrent-delivery.md)
Task list: [tasks/concurrent-delivery-todo.md](concurrent-delivery-todo.md) — explicit user override
of the default task files. The original `tasks/plan.md` and `tasks/todo.md` are retained unchanged.

## Objective

Deliver safe separate-session worktree concurrency in the consumer repository, per the approved
spec.

## Scope and constraints

- No new runtime, daemon, third-party dependencies, version changes, or publication.
- Tests are written before production code within each slice.
- Completed partial slices are never advertised as usable concurrency; only the final integrated
  gate may declare readiness.
- The entire feature remains opt-in; existing serial deliveries are unchanged.

## Frozen architecture and interfaces

These interfaces are frozen for human review. Executors implement against them as written.

### Modules and dependency direction

New distribution modules (Node builtins only, Node >=20, for the opt-in helper):

- `.squad/scripts/delivery-scope.mjs`
- `.squad/scripts/delivery-registry.mjs`
- `.squad/scripts/delivery-session.mjs`
- `.squad/scripts/delivery-worktree.mjs` (private extraction from `delivery-session.mjs` —
  Git/worktree/exclude/symlink/provisioning helpers only; no session policy; imported solely by the
  session module)
- `.squad/scripts/delivery-verify.mjs`
- `.squad/schemas/delivery-session.schema.json`

Dependency direction (relative imports): `scope` is imported by registry, session, and verifier;
`registry` is imported by session and verifier; `session` invokes Git provisioning and registry
transactions; the verifier reads and never mutates claims.

Runtime data lives under `<resolved-git-common-dir>/squad/run/`; worktrees live at
`.squad/worktrees/<id>` under the recorded main checkout; the local `info/exclude` entry is
approved-only. Registry metadata writes are exempt from repository-authored file scopes — an
exemption explicitly limited to control operations, never permission to touch arbitrary Git
metadata. The registry validates records against the schema without executing code from records.

### delivery-scope.mjs

- `normalizeScope(entries)` — synchronous; validates canonical literal file/tree/root entries;
  returns sorted, deduplicated strings.
- `findScopeConflicts(left, right)` — synchronous; returns sorted `{left, right}` pairs using
  conservative case-folded comparison.
- `validateWritePaths({worktreePath, paths, scope})` — async; resolves nearest existing symlink
  ancestors for future paths; rejects escapes, internal `.git`/runtime aliases; returns a standard
  result with violations.
- Logical paths are repo-relative across worktrees; never realpath-compare across worktrees as if
  they were different repositories.
- Canonically equivalent Unicode names are treated conservatively: normalize comparisons with NFC
  plus case-folding; reject ambiguity/collisions rather than claiming exact native filesystem
  matching; persisted original paths are retained.
- No general globs.

### delivery-registry.mjs

- `readRegistry({repositoryPath})` — async, read-only; standard result including sanitized records.
- `withRegistryLock({repositoryPath, approval}, operation)` — async; `mkdir` mutex with
  finally-release of only its own mutex during normal completion. The operation sees a validated
  raw claim map and an atomic record writer. Inputs are revalidated inside the lock; no exposed
  mutation path permits bypassing approval.
- Under live contention, return BLOCKED (retry is an explicit caller operation); no busy-spin and
  no automatic stale steal. A crashed mutex is recovered only through manual user-confirmed-stop
  recovery — a documented, inspected operator procedure in the workflow; no auto-recover API.
- Reads are safe and bounded — unreasonable input is rejected per schema limits approved during
  implementation contract review; no numeric thresholds are set in this plan. Malformed or
  unknown-version state fails closed; symlink registry paths are refused.
- Delivery identifiers match `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`. Released IDs are never reused; a new ID
  is required.
- Schema per the approved spec, including approval evidence objects, stopped-confirmation
  evidence, token generation, states, and path/base binding. No record conveys real external
  authorization; the Lead must capture actual user approval.

### delivery-session.mjs

- Export `runSessionCommand(command, request)` — async.
- CLI: `node .squad/scripts/delivery-session.mjs <status|acquire|extend|heartbeat|resume|release>`.
  Consumes one JSON request on stdin (empty allowed for read-only `status`), emits one JSON result
  on stdout, human diagnostics on stderr; exit 0 OK, 2 BLOCKED, 1 ERROR.
- Request fields: `repositoryPath` is the base field. `acquire` adds `deliveryId`,
  `mainCheckoutPath`, `baseRef`, `scope`, `approval`. `heartbeat` and `extend` authenticate with
  `deliveryId` + `ownerToken` + `generation`; `extend` adds `scope` + `approval`. `resume` and
  `release` are explicit human-approved recovery transitions: they accept `deliveryId` +
  `expectedGeneration` + `approval` + `stoppedConfirmation` and do NOT require the possibly lost old
  `ownerToken`.
- Evidence objects `{confirmed: true, reference: 'user-message-reference'}` are required; neither
  the boolean nor the reference independently proves actual human consent.
- One setup grant authorizes `acquire`, its provisioning transitions, and owner heartbeats — not a
  new user question per heartbeat. `extend`/`resume`/`release` need fresh applicable approval.
- Idempotency is fail-closed: an existing acquire ID never duplicates a branch/worktree;
  status/retry directs the caller to inspect or resume.
- Unknown fields/commands are invalid; raw errors carry no secrets.
- Result shape `{status, code, deliveryId?, conflicts?, ...operation-specific fields}`; codes per
  the approved spec. Successful `acquire`/`resume` return `ownerToken`/`generation` once; normal
  `status` redacts tokens and evidence transcripts (reference only).
- Recovery under the mutex: compare `expectedGeneration` to the record, verify record/path/base
  binding, and for `resume` confirm no overlapping active claim exists; `resume` rotates
  token/generation, `release` writes the tombstone. A stale expected generation returns BLOCKED
  `OWNER_MISMATCH`. Fresh user stopped-confirmation is mandatory regardless of token possession.
  Simultaneous recovery attempts are serialized by the mutex — only one wins. (Interface
  elaboration awaiting user approval; not a user-policy change.)
- Owner tokens are opaque `randomUUID`; generation increments under lock. A fresh resume cannot be
  used to bypass overlaps or claim identity. Release tombstones are checked; no cleanup.

### delivery-verify.mjs

- `captureDeliverySnapshot(context)` and `verifyDeliveryWrites(context, baseline)` — async; standard
  result. Context: `repositoryPath`, `deliveryId`, `ownerToken`, `generation`, `worktreePath`.
- Snapshots are bound to owner generation, worktree, and base commit. Verify reads the registry plus
  tracked/untracked/deleted/renamed files and ignored generated outputs where detectable; it
  distinguishes the delivery patch from incoming target commits. No claim that undeclared ignored
  overwrites are universally detectable.
- Before a write-producing step: validate the command's planned outputs and ownership. After:
  verify changed authored paths. Violations yield BLOCKED and preserve work.
- No new CLI subcommand: the workflow documents invoking the exported verifier through a local Node
  ESM wrapper, so the six-command CLI contract is retained.
- Baseline input is immutable data, not executable JS. Test baseline invalidation on ownership/base
  changes; recapture only after an explicitly authorized integration review; never silently launder
  existing violations.

### Memory reuse

- Existing `searchMemory({sources, memoryDir, ...})` already supports explicit source relative
  filenames including `deliveries/<id>.ndjson`; do not rewrite the search algorithm or assume
  recursion.
- The CLI currently has no source option: add a minimal repeatable `--source <relative-file>` with
  focused parser tests; keep existing default sources/behavior unchanged; validate relative paths
  against traversal.
- `memory-update.mjs` accepts an explicit `outputPath`; pass the delivery-local file with its
  declared claimed path. Schemas unchanged; shared `.squad/MEMORY.md` written only if claimed.

## Task plan

### T1 — Scope contract and schema (M · owner A · deps: none) — DONE

Files: `distribution/.squad/scripts/delivery-scope.mjs`,
`distribution/.squad/schemas/delivery-session.schema.json`, `tests/delivery-scope.test.mjs`.

- Implement/freeze literal file/tree/root scope, conflict cases, symlink/future/rename path
  coverage; schema states, approval metadata, path bindings.
- Red-green test: `node --test tests/delivery-scope.test.mjs`; schema parse test via Node builtins
  in the same file. No runtime writes to the consumer.

### T2 — Registry transactions (M · owner B · deps: frozen T1 contract for implementation; final
verification depends on T1 artifacts) — DONE

Files: `distribution/.squad/scripts/delivery-registry.mjs`, `tests/delivery-registry.test.mjs`.

- Shared common-dir registry, read-only status primitive, mutex, atomic replace,
  corrupt/crash fail-closed, approval absence produces zero mutations.
- Implementation may proceed in parallel from the frozen contract using an isolated unit stub for
  scope, but the stub is not production code and not final-test evidence; final verification runs
  against the real T1 schema/scope artifacts.
- Test: main + linked worktree see the same registry; barrier test proves no mutex steals.
  `node --test tests/delivery-registry.test.mjs`.

### T3 — Workflow contract docs (M · owner C · deps: none; frozen public contract) — DONE

Files: `distribution/.squad/workflows/concurrent-delivery.md` (new),
`distribution/.squad/workflows/delivery.md`, `distribution/.squad/workflows/parallel-execution.md`,
`distribution/.squad/agents/lead.md`, `distribution/.devin/skills/squad-delivery/SKILL.md`.

- Document approval flow, opt-in with no live-claim bypass, no overlap override, scope checks,
  stopped release, manual inspected mutex recovery, worktree child CWD, exported verifier ESM
  wrapper, explicit authorization boundaries. Draft docs must not claim compatibility.
- Verification: doc review against the approved spec plus `git diff --check` on the five paths.
- While T3 is in flight, owners A/B never touch C's files.

### CHECKPOINT 1 (after T1/T2/T3)

Lead contract/diff review; parser + registry focused tests running the real modules and schema (no
stub evidence); no usable-concurrency claim; user review if the frozen contract needs change. T1
and T2 running in parallel is conditional on the interfaces being frozen before execution — no
competing schema edits; T2's final verification waits for T1 artifacts.

### T4 — Approved acquisition/provisioning (M · owner D · deps: T1, T2)

Files: `distribution/.squad/scripts/delivery-session.mjs`, `tests/delivery-session.test.mjs`,
`tests/fixtures/concurrent-session-worker.mjs` (fixtures dir exists; create the file only).

- CLI stdin/result parser plus `status`/`acquire`; PREPARING reserved before provisioning; Git
  path/exclude collision preflight; explicit locally resolvable base; compatibility helpers check;
  ACTIVE after provisioning; failure reservations retained; original main bytes untouched.
- Acquire with hard overlap creates no worktree/branch; Node tests use a local Git fixture.
  Initial scope includes the delivery-memory file declared in approval — never silently added.
- `node --test tests/delivery-session.test.mjs`. Serial owner D owns the session module through T5.
  Status: done (27/27 focused tests green; same run covers T5).

### T5 — Lifecycle mutations (M · owner D · deps: T4)

Files: `distribution/.squad/scripts/delivery-session.mjs`, `tests/delivery-session.test.mjs`.

- `extend` atomic against acquire with no shrink; `heartbeat` ownership, stale informational.
- `resume`/`release` as lost-token recovery transitions (`deliveryId` + `expectedGeneration` +
  approval + `stoppedConfirmation`, old token not required): `resume` rotates token/generation and
  rejects overlapping active claims; `release` tombstones preserving
  dirty/untracked/worktree/branch; stale `expectedGeneration` yields BLOCKED `OWNER_MISMATCH`;
  post-release stale owner blocked; manual mutex recovery with no implicit auto command.
- Tests: lost-token recovery succeeds with fresh approval + stopped confirmation; simultaneous
  recovery attempts — only one wins.
- `node --test tests/delivery-session.test.mjs`. Owner D — not parallel with T4.
  Status: done (shared 27/27 focused run).

### CHECKPOINT 2 (after T4/T5)

Two-process overlapping acquire yields one winner; disjoint acquires both succeed; crashed
provisioning/mutex preserved; review authority/ownership paths. Core lifecycle is now available for
downstream isolated test fixtures — still not final compatibility.

### T6 — Write verification (M · owner E · deps: T5)

Files: `distribution/.squad/scripts/delivery-verify.mjs`, `tests/delivery-verify.test.mjs`.

- Snapshot binding, pre-step validation, authored diff vs. incoming target changes,
  dirty/untracked/deleted/rename scope checks, ignored-outputs limitation, violations
  preserve/block.
- `node --test tests/delivery-verify.test.mjs`.
- Status: done (10/10 focused tests green; mutation evidence: inverted authored-scope gate fails
  capture/commit/rebase tests, restored byte-identical).

### T7 — Delivery-memory seam (M · owner F · deps: T5)

Files: `distribution/.squad/scripts/memory-search.mjs`, `tests/memory-search.test.mjs`,
`distribution/.squad/workflows/memory-maintenance.md`,
`distribution/.squad/agents/memory-maintainer.md`, `tests/memory-update.test.mjs` (preassigned fifth
file for the narrow delivery-local update test if needed).

- Repeatable `--source` arg/parser/source validation; defaults unchanged; workflow documents
  delivery-local outputs and honest local `UPDATED`/canonical-pending reporting; no unclaimed
  shared writes; schema unchanged.
- `node --test tests/memory-search.test.mjs tests/memory-update.test.mjs`. Assertions: two distinct
  files stay independent; no summary changes.
- Status: done — code seam complete (12/12 focused tests green); lead-authored prompt/workflow
  files were delivered by the lead and left untouched.

### T8 — Two-process protocol fixture (M · owner G · deps: T5)

Files: `tests/concurrent-delivery.test.sh`, `tests/fixtures/concurrent-session-worker.mjs`
(ownership handed off from D after T5).

- Independent processes with barriers, no flaky sleeps; overlap, disjoint, stale-block,
  release-confirmation-preserves-work, shared registry across linked roots. All Git local, no
  network.
- `bash tests/concurrent-delivery.test.sh`. Owner G cannot touch lifecycle tests owned by D.
  Fixture tests may only claim protocol behavior, not real Devin.
- Added test-only driver `tests/fixtures/concurrent-delivery-scenario.mjs` to keep the shell
  wrapper thin.
- Status: done (scenario green, 3 consecutive runs).

### CHECKPOINT 3 (after T6/T7/T8)

Ownership non-overlap; focused combined node tests plus shell fixture; verify no workflow
contradicts memory rules; integrate sequentially — no shared test files modified in parallel.

### T9 — Catalog/distribution wiring (M · owner H · deps: T3, T6, T7, T8)

Files: `distribution/.squad/squad.json`, `distribution/.squad/README.md`,
`distribution/AGENTS.md`, `scripts/validate.sh`, `tests/e2e.test.sh`.

- Register workflow/schema with the existing catalog shape; managed wildcard includes the `.mjs`
  modules; optional entry link in tiny AGENTS only; packaged helpers present; schema and
  integration exports validated. No new ownership class or installer dependency requirement.
- `validate.sh` change is targeted to known-required concurrency files only; do not fix unrelated
  existing validator issues.
- `bash scripts/validate.sh` and `bash tests/e2e.test.sh` once, focused on wiring.
- `tests/upgrade.test.sh` gained a narrow seam (consumer `memory/deliveries/` preservation +
  managed helper presence after upgrade) — file added to this task's ownership list.
- Status: done (validate.sh, e2e, and upgrade tests all green; lead-authored README/AGENTS
  untouched).

### T10 — Consumer guidance (S · owner I · deps: T9)

Files: `README.md`, `CHANGELOG.md`, `docs/ideas/concurrent-delivery.md`.

- Document approval/collision/stale/manual recovery, optional Node feature, limits; mark the old
  brainstorm superseded with a link to the approved spec (not a silent history rewrite). CHANGELOG
  entry under Unreleased as a feature, no version bump.
- `git diff --check -- README.md CHANGELOG.md docs/ideas/concurrent-delivery.md`; compare contract
  manually.
- Status: done (section added to README, Unreleased CHANGELOG entry, brainstorm marked superseded;
  all state pending real-session validation — no compatibility claim).

### T11 — Final automated gate (S · deps: T9, T10 · verification-only, no planned source edits)

- Run once (not executed for this documentation task): the seven separate CONTRIBUTING commands —
  whose `node --test tests/*.test.mjs` glob covers the new focused tests — plus the new shell
  fixture. Capture exit/result artifact per command; failures route to the responsible slice as
  narrow regressions — do not rerun everything per edit.

  ```bash
  bash scripts/validate.sh
  node --test tests/*.test.mjs
  bash tests/install.test.sh
  bash tests/install-pipe.test.sh
  bash tests/install-minimal.test.sh
  bash tests/upgrade.test.sh
  bash tests/e2e.test.sh
  bash tests/concurrent-delivery.test.sh
  ```
- Review the entire diff for security/correctness and authority boundaries. No commit/push/PR
  without explicit user request.
- Owner: integration lead review; delegated mechanical execution.
- Status: done — all 8 commands ran once each, every exit 0 (`node --test tests/*.test.mjs`
  90/90); per-command logs + manifest under `/tmp/xq-concurrent-final-*/`.

### T12 — Actual Devin compatibility (S · deps: T11)

File: `docs/devin-compatibility-report.md` only.

- Two REAL Devin sessions, manual user-authorized fixture scenario: disjoint + overlap +
  interrupted-owner confirmed-stopped/release, child CWD, and memory. `devin doctor` and skills
  list on the installed fixture where those command surfaces are available; collect artifacts.
- If the actual two-session environment is inaccessible, report BLOCKED manual gate — never
  substitute the scripted fixture or claim compatibility.
- The user must approve setup/release/publication actions per scenario; no automatic cleanup of
  user work.
- Owner: manual validation; lead reports.
- Status: **BLOCKED** — manual platform gate; the lead-authored report at
  `docs/devin-compatibility-report.md` records the required authorized exercise. No real sessions
  launched; no compatibility claimed.

### FINAL CHECKPOINT

All spec criteria mapped to evidence; T11 green and T12 recorded — or T12 explicitly blocked so the
feature is not declared ready. Memory outcome for the source work is `UNCHANGED` unless a durable
store genuinely exists; no invented `.squad` root.

## Parallel schedule and ownership

Freeze contracts (lead) → [T1 A ‖ T2 B ‖ T3 C] → checkpoint 1 → T4 D → T5 D → checkpoint 2 →
[T6 E ‖ T7 F ‖ T8 G] → checkpoint 3 → T9 H → T10 I → T11 → T12.

Critical integration files transfer ownership explicitly; no simultaneous writers on the lifecycle
helper, schema, or worker fixture.

## Risks

- Stale mutex availability: a crash while holding the registry mutex blocks claim operations until
  manual confirmed-stop recovery.
- Shared ports/databases are not isolated; affected steps must block or use separate approved
  isolation.
- Wide scopes serialize unrelated deliveries.
- Actual agent compliance is unverified until T12's real-session validation.
- Partial Git artifacts retain claims; no automatic cleanup.
- Mutex contention during acquire's post-reservation window (provisioning or activation) returns
  BLOCKED with a retained claim (`recoveryRequired`); the caller must not blind-retry acquire —
  recovery is the user-confirmed resume/release path.
- A consumer base missing installed squad helpers blocks preflight.
- Each risk maps to the corresponding section of the approved spec.

## Pending implementation details (not license to guess)

- External fixture environment for the manual two-session Devin validation (T12).
- Exact Git capability portability implementation — must meet the constraints without network.
- Code-level algorithms within the frozen contract are left to the executor.

## Final gate

The user approved this plan on 2026-10-24. Implementation and automated verification are complete.
The eight-command full gate passed with 90 Node tests before final-review hardening. After the
review fixes, all 62 affected registry/session/verifier tests and the installed-consumer end-to-end
check passed. A strengthened metadata-preserving content-change regression also passed separately;
the unaffected full gate was not rerun.

Final-review evidence:
- `/tmp/xq-concurrent-review-red.log` — new ownership and hidden-write regressions failed before fixes.
- `/tmp/xq-concurrent-review-green.log` — 62 affected tests passed after fixes.
- `/tmp/xq-concurrent-review-e2e.log` — installed-consumer check passed.
- `/tmp/xq-concurrent-hash-regression.log` — Git-stat-cache regression passed without suppression flags.

T12 remains blocked, not waived: no real two-session Devin exercise or release is claimed.
