# Spec: Concurrent Squad Delivery Isolation

Status: **Approved by the user on 2026-10-24.** The implementation plan was subsequently approved;
implementation and automated checks are complete. Real two-session Devin validation passed 2026-10-25
(see `docs/devin-compatibility-report.md`).
Sections marked *Proposed* record the approved technical design; *Confirmed* restates settled user
requirements.

## Objective

Allow separate Devin sessions to deliver independent squad requests in the same consumer repository
concurrently, without write-scope collisions, while leaving the user's main checkout untouched.

## Confirmed user requirements

- Every concurrent delivery owns an isolated branch and worktree. The main checkout is user-owned
  and remains unchanged.
- The user explicitly approves setup per delivery before any runtime claim, branch, or worktree write.
- Overlapping write scopes hard-block; no override exists. Expanding scope requires checks before
  editing any new path.
- Heartbeats are informational only. Stale claims block forever until explicit user release.
- Release requires the user's explicit confirmation that the previous owner session **and** all its
  write-producing/background commands have stopped. Release preserves branch, worktree, dirty edits.
- Commits, push, PR, and cleanup are each separate authorizations. No silent shared-tree fallback.
- Out of scope: daemon or shared Lead, merge queue or automatic merge, automatic stale
  takeover/cleanup, port/DB/service isolation, semantic-conflict inference. The protocol coordinates
  cooperating squad sessions only; it cannot police manual edits or enforce user ground truth.

## Proposed design

### Assumptions

- The consumer repo lives on a local filesystem with atomic `mkdir` and `rename` semantics; no
  correctness guarantee is made on distributed or network filesystems.
- `baseRef`/`baseCommit` must be an explicit, locally resolvable ref + commit; setup performs no
  implicit network fetch.
- The provisioned worktree must contain compatible installed squad helpers; otherwise preflight
  reports BLOCKED. The protocol never executes downloaded or untrusted code.

### Activation and compatibility

- One integrated capability; no multi-module initiative decomposition.
- Opt-in concurrent workflow for the first release. Existing serial deliveries are unchanged, but
  opting out never bypasses live claims.
- If the main checkout already has active squad or unexplained writes, initial concurrent activation
  blocks until the user establishes a stopped/quiescent baseline. Arbitrary non-squad changes are
  detected and warned on, never prevented.

### Registry and provisioning

- Same physical local Git repository on a shared filesystem only. The registry resolves through the
  Git common directory (`git rev-parse --path-format=absolute --git-common-dir`, or portable
  equivalent) so the main checkout and all linked worktrees share one `<git-common-dir>/squad/run/`.
  Never a per-checkout registry; runtime tokens are never tracked in Git.
- Local Git metadata is written only after setup approval. Git and Node capabilities are detected
  before any mutation. Node >=20 is required for the optional concurrency helpers; the
  dependency-light installers stay unchanged and no new third-party dependencies are added.
- Worktree path `.squad/worktrees/<delivery-id>` under the explicitly recorded main checkout; branch
  `squad/<delivery-id>`. Path/branch collisions are refused, never reused or deleted; delivery IDs
  are restrictive lowercase kebab, traversal/symlink escapes rejected.
- After approval only, add an anchored `/.squad/worktrees/` entry to the common `info/exclude`,
  preserving all existing contents. Read-only preflight stays read-only (Git optional locking
  disabled where needed).

### Scope contract (V1)

- Scope is a list of literal repo-relative POSIX paths: an exact file, or a subtree denoted by a
  trailing `/`. `.` claims the whole repository. No arbitrary globs.
- Rejected: absolute paths, `..` traversal, backslashes, `.git` and internal runtime paths,
  noncanonical forms.
- Overlap detection covers file==file, file-inside-subtree, and subtree ancestor/descendant.
  Comparison is case-folded so case-only collisions block even on Linux.
- Claims reserve rename source and destination, nonexistent future files, and generated outputs
  (tracked or untracked). Symlink ancestors and canonical aliases are resolved; writes escaping the
  worktree and ambiguous aliases are rejected rather than claimed unsafely.
- Read scopes are unclaimed. Broad source scopes can serialize unrelated deliveries — a disclosed
  tradeoff. No scope shrinking while the owner may still write; narrowing only before acquisition or
  after confirmed stop/release.

### Coordination

- A global short-lived atomic `mkdir` mutex in the registry serializes conflict-check + claim
  creation, scope extension, heartbeat ownership check, release, and provisioning transitions. This
  is filesystem coordination, not a daemon or shared Lead.
- A locked, incomplete, corrupt, or unknown-schema registry fails closed as BLOCKED. The mutex is
  never time-stolen; recovering it also requires a confirmed-stopped operation. No automatic lock
  reclaim. Records are replaced atomically. A crash while holding the mutex can block unrelated
  claim operations — a disclosed conservative availability tradeoff.

### Lifecycle

Read-only proposal → user approval → locked atomic reservation → PREPARING → ACTIVE →
user-stopped/awaiting-release → RELEASED tombstone.

- PREPARING reserves scope before the worktree/branch exist; ACTIVE begins once provisioning
  completes. Failed or crashed provisioning leaves RECOVERY_REQUIRED (or remains PREPARING if the
  transition did not persist); partial artifacts are preserved. No unowned-work fallback, no
  artifact-deleting rollback.
- BLOCKED is an operation result, not a lifecycle state. Heartbeats do not revive or expire a claim.
  A completed delivery retains its claim until stopped confirmation plus explicit release.
- Resume requires user approval after the old owner stopped, rotates the owner token/generation
  under the mutex, keeps the same worktree and branch, and invalidates the stale token.
- Every write-producing step and owned child re-checks token, worktree, and scope before starting.
  Release confirmation is required because already-running commands cannot be forcibly fenced. The
  lease token is accidental fencing, not a security boundary.

### Claim record

```json
{
  "schemaVersion": 1, "deliveryId": "fix-login-redirect",
  "ownerToken": "opaque-local-id", "generation": 1, "state": "ACTIVE",
  "repositoryRoot": "/abs/path", "branch": "squad/fix-login-redirect",
  "worktreePath": "/abs/path/.squad/worktrees/fix-login-redirect",
  "baseRef": "main", "baseCommit": "<sha>",
  "scope": ["src/auth/", "docs/login.md"],
  "createdAt": "2025-01-01T00:00:00Z", "heartbeatAt": "2025-01-01T00:05:00Z"
}
```

`state` enumerates `PREPARING`, `ACTIVE`, `RECOVERY_REQUIRED`, `RELEASED`; the `RECOVERY_REQUIRED`
delivery *state* is distinct from the operation result *code*. "User stopped, awaiting release" is a
protocol phase, not a stored state value. `ownerToken` is an opaque local identifier, not a
credential. RELEASED records add `stoppedConfirmedAt`/`releasedAt`; the old token is unusable.
Approval/stop evidence originates in user chat and is recorded by the Lead; CLI flags alone are not
independent proof of human consent.

### Helper CLI — proposed, not yet available

`node .squad/scripts/delivery-session.mjs <subcommand>`:

| Subcommand  | Purpose                                               |
|-------------|-------------------------------------------------------|
| `status`    | Read-only registry view                               |
| `acquire`   | Consume approved ID/base/scope plus approval evidence |
| `extend`    | Owner/generation check plus additional approved scope |
| `heartbeat` | Owner token + generation required                     |
| `resume`    | User approval + stopped confirmation                  |
| `release`   | User approval + stopped confirmation; never cleans up |

Uniform result `{status: "OK"|"BLOCKED"|"ERROR", code, deliveryId?, conflicts?}`; codes `OK`,
`SCOPE_CONFLICT`, `APPROVAL_REQUIRED`, `OWNER_MISMATCH`, `RECOVERY_REQUIRED`, `INVALID_INPUT`; exit
0 OK, 2 BLOCKED, 1 ERROR. On a locked, incomplete, or corrupt registry, `status` must report the
registry as unavailable/indeterminate — it must not imply safe absence of claims. Normal human
`status` output never prints owner token values (not credentials, but printing them would enable
accidental ownership handoffs). Inputs are conceptual fields/JSON; flags unspecified.

### Project structure (proposed)

New consumer-facing files under `distribution/`:

- `.squad/scripts/delivery-session.mjs` — the helper CLI above.
- `.squad/schemas/delivery-session.schema.json` — claim-record schema, alongside
  `memory-record.schema.json`.
- `.squad/workflows/concurrent-delivery.md` — the opt-in workflow.

Additive seams in existing files: `delivery.md`, `parallel-execution.md`, `agents/lead.md`, the
`.devin` `squad-delivery` skill adapter, and `squad.json`. New tests:
`tests/delivery-session.test.mjs` and `tests/concurrent-delivery.test.sh`.

### Code style (proposed)

Follow existing `.mjs` conventions: top-level named Node imports, two-space indent, single quotes,
plain functions, no new dependencies. Style sketch, not an implementation:

```js
import { mkdir } from 'node:fs/promises';

function fail(code, message) { return { status: 'ERROR', code, message }; }
```

### Memory

- Delivery memory is local to its worktree at `.squad/memory/deliveries/<id>.ndjson`, inside the
  claimed scope, and preserves the existing record schema. `.mjs` search tooling may need explicit
  file paths (no assumed recursive discovery).
- Shared `.squad/MEMORY.md` and shared memory files are not written automatically. If needed, exact
  paths are explicitly reserved or extended; overlaps hard-block. Reporting distinguishes local
  `UPDATED` from canonical integration pending. No main-checkout memory writer; reconciliation
  happens later via an authorized integration step with no hidden global writes.
- `.squad/knowledge` reads allowed, writes scoped; consumer-owned paths survive upgrade.

### Integration and write verification

- Integration happens in the delivery worktree only: review changes against claimed scope, preserve
  user changes, refresh the target before an authorized push/PR per the existing delivery contract.
  Fetch, rebase, commit, push, and PR each need explicit authorization; no integration step alters
  the main checkout, index, or HEAD. No automatic merge service.
- New target changes require fresh review/checks; conflict resolution needing new authored paths
  must first expand scope or block.
- Rebase may bring upstream files into the checkout; scope verification compares the
  delivery-authored patch, not all incoming upstream paths. Rebase is never an exemption for
  out-of-scope authored edits.
- Before each write-producing step: check current ownership, correct worktree, and planned output
  scope. After each run: verify tracked changes, deletions, renames, and untracked files (including
  ignored generated outputs where detectable) — not merely `git diff --name-only`.
- Out-of-scope actual writes yield BLOCKED: report and preserve; never silently revert or
  retroactively declare them authorized. Build/test side effects must be local and disjoint; shared
  DBs, ports, or services need separate existing user-approved isolation, else the step blocks.
- Worktrees are not a sandbox or security enforcement; tests verify the cooperating protocol and
  report its limitations. Cleanup is separately requested: inspect dirty/untracked state first; no
  force removal or data deletion without specific approval. Cleanup tooling is not MVP.

## Superseded points from `docs/ideas/concurrent-delivery.md`

The prior brainstorm is not an approved design. This spec replaces:

- **Asymmetric first-in-main** and `main.lock` — every concurrent delivery gets an isolated worktree;
  the main checkout stays user-owned.
- **Heartbeat TTL with stale GC/reclaim** — heartbeats are informational; stale claims block until
  explicit user release.
- **Overlap warns, user decides** — overlaps now hard-block, no override.
- **Claim-time path globs** — literal file/subtree scope language.
- **Per-checkout `.squad/run/` registry** — one registry under the Git common directory.
- **Heartbeat-mtime stale reclaim** (the brainstorm's port of Hub locking) — a short-lived `mkdir`
  mutex whose recovery requires a confirmed-stopped operation; never time-stolen.
- **`git diff --name-only` verification** — pre/post checks covering tracked, deleted, renamed, and
  untracked writes.
- **`memory/projects/<project>.ndjson` + `MEMORY.md` written during main-checkout integration** —
  delivery-local `deliveries/<id>.ndjson`; no main-checkout memory writer.
- **Installer-managed `.gitignore` block** — anchored common `info/exclude` entry, approval-gated.

## Proposed test plan (specification only — nothing run yet)

`node:test` coverage in `tests/delivery-session.test.mjs`:

- Scope overlap: file/tree/ancestor/descendant, case-only collisions, rename pairs, nonexistent
  paths, invalid paths, symlink aliases.
- Child-process barrier: concurrent overlapping acquires yield exactly one winner; disjoint claims
  both succeed. Same registry visible from main checkout and linked worktree; scope extension atomic
  against concurrent acquire.
- Stale claim never auto-releases; stale token fenced on resume/release; release/resume require
  stopped confirmation. Missing approval leaves no claim, branch, worktree, or exclude edit.
- Crash holding mutex and failed provisioning block and preserve artifacts; corrupt registry fails
  closed. Release preserves dirty/untracked files, branch, and worktree; main checkout HEAD/index/
  branch and preexisting tracked/untracked bytes unchanged — only the approved `.squad/worktrees/`
  subtree and `info/exclude` entry may appear.
- Scope violation detected for untracked, deleted, and renamed writes. Delivery memory lands in
  distinct per-delivery files; no summary write without scope.

Shell fixture `tests/concurrent-delivery.test.sh`: two independent scripted sessions — one
overlapping claim blocked, one disjoint claim succeeds. Tests cover the scripted protocol only, not
actual Devin platform behavior; manual validation with two real Devin sessions (approval flow,
working directory, child processes) is required before claiming platform compatibility.

Proposed focused commands once implemented: `node --test tests/delivery-session.test.mjs` and
`bash tests/concurrent-delivery.test.sh`. Full existing gates from CONTRIBUTING run before delivery
(not run for this document task):

```bash
bash scripts/validate.sh
node --test tests/*.test.mjs
bash tests/install.test.sh
bash tests/install-pipe.test.sh
bash tests/install-minimal.test.sh
bash tests/upgrade.test.sh
bash tests/e2e.test.sh
```

No numeric coverage or quality threshold is introduced.

## Success criteria

- Two cooperating sessions deliver disjoint changes concurrently in one consumer repo; the main
  checkout's original HEAD/index/branch and preexisting tracked/untracked bytes are unchanged — only
  the approved worktree subtree and `info/exclude` metadata are added.
- An overlapping acquire returns BLOCKED/`SCOPE_CONFLICT` naming the conflicting paths; no claim,
  branch, or worktree is created.
- A stale claim blocks all conflicting operations until explicit release; released artifacts
  (branch, worktree, dirty edits) are preserved.
- All listed automated tests pass and the manual two-session Devin validation is recorded.

## Boundaries

- Always fail closed on uncertainty; the user owns the main checkout.
- Ask first: initial setup, scope extensions, resume/release stopped confirmation, external resource
  actions, Git publication and cleanup.
- Never: overlap override, stale-timeout freeing, destructive automatic recovery, commit/push/PR
  without authorization.
- Compatibility: opt-in additive workflow is a candidate **minor** change per CONTRIBUTING. Mandatory
  concurrent behavior or incompatible ownership/schema changes require reassessment. No version bump
  now.

## Approved design choices and remaining validation

1. Literal exact-file/subtree scope language (no globs).
2. Registry under the Git common directory; `.squad/worktrees/` placement plus anchored
   `info/exclude` entry.
3. Opt-in concurrent workflow for the first release.
4. Manual validation with two real Devin sessions passed 2026-10-25 — recorded in
   `docs/devin-compatibility-report.md`.

The user approved this specification, including the technical choices above. Manual platform
validation passed; no confirmed user policy remains unresolved.
