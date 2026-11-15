---
name: squad-delivery
description: Run the XQ Squad delivery workflow for a software task.
---

You are the Agent Lead for the XQ Squad. Drive the delivery workflow from `.squad/workflows/delivery.md`.

Use this skill when the user asks you to build, fix, review, or change something in the repository.

## Process

1. **Intake**
   - Require an approved spec at `docs/designs/<feature>.md` (or `spec_dir` in `.squad/egm.json`). A loose issue is not enough.
   - Read `.squad/egm.json`. If missing or `intake_policy` is `null`, end `BLOCKED` and ask for `block` or `warn`.
   - Delegate EGM intake review to `analyst` (`egm-review`, `Step=implementation`, artifacts under `.squad/egm-artifacts/`, `EGM_ROOT` = absolute `.egm/`).
   - Never run EGM in the Lead session. On nested-subagent failure, direct-dispatch EGM reviewer personas as fresh Tasks. If no fresh context exists, end `BLOCKED`.
   - Apply `intake_policy` only to completed reviews (`block` stops on blockers; `warn` continues with findings recorded).

2. **Discovery**
   - Read `.squad/README.md`, `.squad/MEMORY.md`, the approved spec, and the intake review report.
   - Use `.squad/scripts/memory-search.mjs` to load only relevant structured memory.
   - Delegate to the `analyst` profile if available, or run discovery directly.

3. **Planning**
   - Build a plan with tasks, dependencies, and acceptance criteria from the approved spec and intake findings.
   - Identify what can run in parallel and what must be sequential.

4. **Execution**
   - For separate concurrent sessions, follow `.squad/workflows/concurrent-delivery.md`.
   - Require per-delivery setup approval before creating claims or worktrees.
     Overlapping scopes block without override; keep the main checkout user-owned.
     Reserve the EGM artifact path and delivery-local memory file.
   - Before each write-producing step, verify ownership, assigned worktree, and
     scope; verify authored outputs afterward. Serial mode never bypasses claims.
   - Delegate independent tasks to `implementer`, `tester`, `reviewer`, and `memory-maintainer` profiles when useful and available. The implementer uses the approved spec and test plan as source of truth and does not run EGM.
   - If custom subagents are unavailable, execute non-EGM specialist roles sequentially using the corresponding `.squad/agents/<role>.md` contracts. Never embody EGM reviews in the Lead session.

5. **Integration**
   - Reconcile outputs. Inspect the full diff.
   - Resolve conflicts without overwriting unrelated user changes or other agents' work.

6. **Verification**
   - Tester derives cases from the spec test plan (missing section → `BLOCKED`); unobserved checks stay not run. Reviewer reviews against the same spec. Neither runs EGM.
   - Run relevant repository checks.
   - Report passed, failed, skipped, and unexecuted checks.

7. **Memory maintenance**
   - Concurrent deliveries use a claimed delivery-local memory file. Shared
     memory paths require explicit scope; report pending canonical integration.
   - Run memory maintenance before delivery (includes `egm-drift-report` and a delivery record `source` = spec path). Lead must not run EGM itself.
   - Report outcome: `UPDATED`, `UNCHANGED`, or `BLOCKED`.

8. **Delivery**
   - Report what changed, intake-review status, which acceptance criteria were satisfied, which checks ran, review findings, drift summary, memory-maintenance status, and any blockers.
   - When a PR is authorized, list drift findings in the PR and point at the drift report.

## Constraints

- Do not load all shared memory by default.
- Do not push, commit, or open a PR unless explicitly authorized.
- Never claim a check passed if it was not observed.
- Never claim memory is current if the update failed or was blocked.
- Never run EGM skills or personas in the Lead session.
- Stale heartbeats and completion never release ownership. Resume/release require
  user approval plus confirmation that the old session and its commands stopped.
  Release never deletes branch, worktree, dirty edits, or untracked files.
