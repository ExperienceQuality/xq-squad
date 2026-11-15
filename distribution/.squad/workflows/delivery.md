# Delivery Workflow

Default workflow for every XQ Squad task.

```text
INTAKE
  -> DISCOVERY
  -> PLANNING
  -> EXECUTION
  -> INTEGRATION
  -> VERIFICATION
  -> MEMORY_UPDATE
  -> DELIVERY
```

Workflow may terminate with `FAILED`, `CANCELLED`, or `BLOCKED`.

## Intake

- Require an approved feature spec at `docs/designs/<feature>.md` (or `spec_dir` from `.squad/egm.json`). A loose GitHub issue is not enough; ask for the spec path and stop if it is missing.
- Read `.squad/egm.json`. If missing or `intake_policy` is `null`, end `BLOCKED` and ask the user to set `block` or `warn`. Do not choose a policy.
- Delegate the EGM intake review to the `analyst` with `TargetFile=<spec>`, `Step=implementation`, `EGM_ROOT` = absolute `.egm/`, and artifacts under `.squad/egm-artifacts/<delivery-id>` (or `serial`).
- Never run EGM skills or personas in the Lead session. If nested subagents fail, the Lead direct-dispatches the three EGM reviewers as fresh Tasks with Goldfish-only context. If no fresh context can be created, end `BLOCKED`.
- Apply `intake_policy` only to a completed review: `block` stops on any blocker finding; `warn` records findings and continues. Incomplete reviews always `BLOCKED`.

## Discovery

- Read `.squad/README.md`, `.squad/MEMORY.md`, the approved spec, and the intake review report.
- Search relevant memory with `.squad/scripts/memory-search.mjs`.
- Use `analyst` profile or direct exploration to find affected files, conventions, and commands.

## Planning

- Define tasks, dependencies, ownership, acceptance criteria, and integration boundaries from the approved spec and intake findings.
- Prefer simple plans.
- Avoid parallelizing tightly coupled tasks without clear integration strategy.

## Execution

- For separate concurrent sessions, follow `concurrent-delivery.md`: obtain
  setup approval, acquire a non-overlapping claim, and work only in the assigned
  worktree. Main checkout remains user-owned. Reserve the EGM artifact path and
  delivery-local memory file in the claim scope.
- Serial mode never bypasses existing claims. When installed, inspect the
  delivery-session helper before writes; overlapping or indeterminate ownership
  blocks. Missing helpers in an opted-in concurrent delivery also block.
- Delegate independent tasks to profiles when supported. The `implementer` uses
  the approved spec and its test plan as source of truth and does not run EGM.
- Use worktrees or isolated branches only when authorized and conflict risk justifies it.
- Execute directly when delegation is unavailable (non-EGM work only).

## Integration

- Reconcile outputs.
- Inspect full diff.
- Resolve conflicts without overwriting unrelated user changes or other agent work.

## Verification

- The `tester` derives cases from the spec's test plan section; missing section → `BLOCKED`. Unobserved checks stay not run.
- The `reviewer` reviews the diff against the same spec and test plan.
- Neither runs an EGM skill.
- Run relevant repository checks.
- Report passed, failed, skipped, unexecuted.
- Never claim observed status for unexecuted checks.

## Memory update

- In concurrent mode, write delivery-local memory only within claimed scope.
  Shared memory requires its own scope; never write a main-checkout summary.
  Reserve the EGM artifact path before drift-report writes.
- Run memory maintenance using `memory-maintainer` profile or directly. That
  step includes `egm-drift-report` and a delivery record whose `source` is the
  spec path. The Lead must not run EGM itself.
- Report `UPDATED`, `UNCHANGED`, or `BLOCKED`.
- Do not claim current memory if persistence failed.

## Delivery

Report:

- What changed.
- Satisfied acceptance criteria.
- Intake-review status and findings summary.
- Checks run and their observed status.
- Review findings and unresolved risks.
- Drift summary (and path to the drift report).
- Memory-maintenance outcome.
- Remaining blockers.

Do not push, commit, or open a PR unless authorized. Before any authorized push or PR creation, fetch the configured remote and rebase the working branch onto the current remote target branch. Resolve conflicts and rerun verification; if the rebase cannot complete, report `BLOCKED` and do not push or open a PR. When a pull request is authorized, list drift findings in the PR body or a comment and point at the drift report file.

Concurrent completion retains its claim. Release requires explicit user approval
and confirmation that the owner session and its commands stopped; it never
removes the branch, worktree, or dirty edits.
