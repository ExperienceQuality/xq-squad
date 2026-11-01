# Architecture: XQ Squad Core + Runtime Adapters

```text
.squad/    canonical core — agents, workflows, schemas, scripts, memory, knowledge, state
.devin/    Devin adapter  — agents/, skills/, rules/local-*
.cursor/   Cursor adapter — rules/*.mdc, agents/, skills/, hooks.json + hooks/
AGENTS.md  managed section: always-on Lead contract (read by Devin and Cursor)
```

- **Core is the source of truth.** Role contracts (`.squad/agents/*.md`),
  the 8-stage delivery workflow, concurrent-delivery protocol, schemas,
  memory, and helper scripts are runtime-independent.
- **Adapters are thin.** Each adapter file maps a core contract onto a native
  runtime feature and points to the canonical file instead of copying it.
  Skill bodies are identical across runtimes; only frontmatter differs.
  `scripts/validate-cursor-adapter.mjs` enforces this.
- **Adapters cannot weaken governance.** Lead ownership, unique delivery IDs,
  worktree + claim isolation (hard-blocking overlaps, claims in the Git common
  dir, no auto-expiry), verification before completion, memory status
  reporting, and "no commit/push/PR without authorization" come from core.
  Cursor hooks add enforcement on top; they never replace core checks.
  Runtime subagents (including isolated copies) are not squad isolation.
- **One registry, mixed runtimes.** Devin and Cursor sessions use the same
  `.squad/scripts/delivery-*.mjs` helpers and registry, so they can deliver
  concurrently in one repository.
- **Distribution.** Both adapters ship in one versioned archive. Ownership
  (`squad.json` → `ownership`) decides upgrade behavior: upstream-managed
  files are hash-tracked in `.squad/install-state.json`; `AGENTS.md` and
  `.cursor/hooks.json` are merge-managed; consumer-owned paths are never
  touched. Conflicts are kept with a `<file>.squad-upstream` sidecar.
