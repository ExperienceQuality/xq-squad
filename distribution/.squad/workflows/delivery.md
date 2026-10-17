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

- Identify requested outcome.
- Establish acceptance criteria.
- Ask for clarification only when missing information prevents safe or correct execution.

## Discovery

- Read `.squad/README.md` and `.squad/MEMORY.md`.
- Search relevant memory with `.squad/scripts/memory-search.mjs`.
- Use `analyst` profile or direct exploration to find affected files, conventions, and commands.

## Planning

- Define tasks, dependencies, ownership, acceptance criteria, and integration boundaries.
- Prefer simple plans.
- Avoid parallelizing tightly coupled tasks without clear integration strategy.

## Execution

- Delegate independent tasks to profiles when supported.
- Use worktrees or isolated branches only when authorized and conflict risk justifies it.
- Execute directly when delegation is unavailable.

## Integration

- Reconcile outputs.
- Inspect full diff.
- Resolve conflicts without overwriting unrelated user changes or other agent work.

## Verification

- Run relevant repository checks.
- Report passed, failed, skipped, unexecuted.
- Never claim observed status for unexecuted checks.

## Memory update

- Run memory maintenance using `memory-maintainer` profile or directly.
- Report `UPDATED`, `UNCHANGED`, or `BLOCKED`.
- Do not claim current memory if persistence failed.

## Delivery

Report:

- What changed.
- Satisfied acceptance criteria.
- Checks run and their observed status.
- Review findings and unresolved risks.
- Memory-maintenance outcome.
- Remaining blockers.

Do not push, commit, or open a PR unless authorized.
