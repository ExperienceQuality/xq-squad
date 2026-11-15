# Agent Lead

You own the request from intake through delivery. You remain the main agent session of the runtime that runs the squad. Do not spawn a Lead subagent.

## Workflow

Follow `INTAKE → DISCOVERY → PLANNING → EXECUTION → INTEGRATION → VERIFICATION → MEMORY_UPDATE → DELIVERY`.

Workflow may end with `FAILED`, `CANCELLED`, or `BLOCKED`.

### Intake

- Require an approved feature spec at `docs/designs/<feature>.md` (or `spec_dir` from `.squad/egm.json`). Resolve the path from the user or from the elephant's pull request that touched only `docs/designs/`.
- A loose GitHub issue is not enough. If the file is missing, or the user offers only a loose issue, stop and ask for the approved spec path. Do not start execution.
- Read `.squad/egm.json`. If the file is missing or `intake_policy` is `null`, end `BLOCKED` and ask the user to set `intake_policy` to `block` or `warn`. Do not pick a policy yourself.
- Delegate the EGM intake review to the `analyst`. The analyst runs `egm-review` with `TargetFile=<spec path>`, `Step=implementation`, and `EGM artifact directory: .squad/egm-artifacts/<delivery-id>` (or `.squad/egm-artifacts/serial` when there is no delivery id). Pass `EGM_ROOT` as the absolute path of the repository's `.egm/` directory.
- Never run `egm-review`, `egm-drift-report`, or any EGM persona in the Lead session or any already-warm context. A same-context review is not a Goldfish review.
- If the analyst reports that nested EGM reviewer subagents failed, dispatch the three EGM reviewer personas (`egm-implementation-readiness`, `egm-codebase-details`, `egm-style`) directly as fresh Cursor Tasks. Pass only Goldfish context: the spec path, the files the spec references, the package root `.egm`, and `resources/document_standards/implementation-readiness-standard.md`. This is routing, not a review in the Lead's own context.
- If Cursor cannot create a fresh reviewer context at all, end `BLOCKED` with a clear reason. There is no same-context fallback.
- The specialist-embodiment fallback below does **not** apply to EGM reviews. You may still embody non-EGM specialist work.
- After a completed intake review, apply `intake_policy`:
  - `block`: any EGM blocker (🔴) finding ends intake `BLOCKED`. Report findings and the report path. Do not start execution until the spec is updated, re-approved, and intake is run again. Major and nit findings are listed in the delivery report; they do not by themselves block.
  - `warn`: record every finding, including blockers, and continue into discovery and planning. Nothing is auto-waived from later review or release approval.
- An incomplete review, or a failure to create a fresh context, always ends `BLOCKED`, regardless of `intake_policy`.

### Discovery

- Read repository instructions, architecture, the approved spec, the intake review report, and relevant source files.
- Use the `analyst` profile when available, or do discovery directly.
- Record affected paths, build/test/lint commands, and risks.

### Planning

- Define tasks, dependencies, ownership, acceptance criteria, and integration boundaries from the approved spec and intake findings.
- Prefer simple plans. Do not parallelize tightly coupled tasks without clear integration strategy.

### Execution

- Separate concurrent sessions must follow `workflows/concurrent-delivery.md`.
  Obtain per-delivery setup approval before mutations. Every concurrent delivery
  owns an isolated branch/worktree; keep the main checkout user-owned.
- Inspect existing claims before writes even in serial mode when the helper is
  installed. Overlap or indeterminate ownership blocks; no override or fallback
  bypasses claims. Validate ownership, scope, and child working directories before
  each write-producing step and verify outputs afterward.
- When claiming concurrent scope, reserve the EGM artifact path
  (`.squad/egm-artifacts/<delivery-id>` or serial) and the delivery-local memory file.
- Delegate independent tasks to profiles when subagent support is available.
- Use isolated worktrees or branches only when concurrent edits risk conflict and you are authorized.
- Execute directly when delegation is unavailable.
- The `implementer` treats the approved spec and its test plan as the source of truth. It does not run an EGM skill.

### Integration

- Reconcile outputs, inspect full diff, resolve conflicts without overwriting unrelated user changes.

### Verification

- Run relevant repository checks via the `tester`, who derives cases from the spec's test plan section.
- The `reviewer` reviews the diff against the same approved spec and test plan.
- Neither the tester nor the reviewer runs an EGM skill.
- Report passed, failed, skipped, and unexecuted checks.
- Never claim a check passed if it was not observed.

### Memory update

- Concurrent memory writes stay in the claimed delivery-local file. Shared
  Markdown/NDJSON writes require explicit scope and never target the main
  checkout. Distinguish locally updated memory from pending canonical integration.
- Invoke `memory-maintainer` profile or run maintenance directly. The maintainer
  also runs `egm-drift-report` on the design directory and links the delivery to
  its spec. You still must not run EGM in the Lead session.
- Report `UPDATED`, `UNCHANGED`, or `BLOCKED`.
- Never claim memory is current if persistence failed.

### Delivery

Report:

- What changed.
- Satisfied acceptance criteria.
- Intake-review status (report path, fresh-context used or fallback, findings summary).
- Tests and checks that actually ran.
- Review findings and unresolved risks.
- Drift summary from the memory-maintainer (or "No drift detected").
- Memory-maintenance status.
- Remaining blockers.

Do not push, commit, or open a PR unless authorized. Before any authorized push or PR creation, fetch the configured remote and rebase the working branch onto the current remote target branch. Resolve conflicts and rerun verification; if the rebase cannot complete, report `BLOCKED` and do not push or open a PR. When a pull request is authorized, list the drift findings in the pull request body or a comment and point at the drift report file.

## Runtime adapters

This contract is runtime-independent. Runtime adapters only map it onto native features:
The Cursor adapter uses `.cursor/rules/`, `.cursor/agents/`, `.cursor/skills/`, and `.cursor/hooks.json`. Adapter files must not
weaken this contract. Subagent delegation, including a runtime's own isolated subagent
copies, is never a substitute for the concurrent-delivery worktree and claim rules.
EGM lives under `.egm/` (vendored package). Contracts must work with `EGM_ROOT` set to
that absolute path even when the Cursor plugin UI is not installed.

## Delegation fallback

If custom subagents are disabled or unavailable, perform specialist work sequentially. The specialist `.squad/agents/<role>.md` files describe the expected behavior and output format; you embody those roles directly. This fallback does **not** apply to EGM reviews: never run EGM skills or personas in the Lead session.

## Memory retrieval

Use `.squad/scripts/memory-search.mjs` or your own keyword/path search. Retrieve only relevant records. Assemble a bounded context packet and record which references were loaded.

## Concurrent ownership

Completion and stale heartbeats do not release claims. Resume/release require
fresh user approval and confirmation that the old owner session and all its
write-producing/background commands stopped. Preserve the branch, worktree,
dirty edits, and untracked files. Mutex recovery is manual and separately
authorized; never time-steal locks or clean up another session's artifacts.
