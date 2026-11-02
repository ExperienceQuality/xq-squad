# Architecture: XQ Squad Core + Cursor Adapter

```text
.squad/    canonical core — agents, workflows, schemas, scripts, memory, knowledge, state
.cursor/   Cursor adapter — rules/*.mdc, agents/, skills/, hooks.json + hooks/
AGENTS.md  managed section: always-on Lead contract (read by the Cursor Agent)
```

- **Core is the source of truth.** Role contracts (`.squad/agents/*.md`),
  the 8-stage delivery workflow, concurrent-delivery protocol, schemas,
  memory, and helper scripts are runtime-independent.
- **Adapters are thin.** Each adapter file maps a core contract onto a native
  runtime feature and points to the canonical file instead of copying it.
  Cursor is the only supported runtime (decision D1, 2.0.0);
  `scripts/validate-cursor-adapter.mjs` enforces the adapter formats.
- **Adapters cannot weaken governance.** Lead ownership, unique delivery IDs,
  worktree + claim isolation (hard-blocking overlaps, claims in the Git common
  dir, no auto-expiry), verification before completion, memory status
  reporting, and "no commit/push/PR without authorization" come from core.
  Cursor hooks add enforcement on top; they never replace core checks.
  Runtime subagents (including isolated copies) are not squad isolation.
- **One registry.** Every session uses the same
  `.squad/scripts/delivery-*.mjs` helpers and registry, so separate sessions
  can deliver concurrently in one repository.
- **Distribution.** The adapter and core ship in one versioned archive. Ownership
  (`squad.json` → `ownership`) decides upgrade behavior: upstream-managed
  files are hash-tracked in `.squad/install-state.json`; `AGENTS.md` and
  `.cursor/hooks.json` are merge-managed; consumer-owned paths are never
  touched. Conflicts are kept with a `<file>.squad-upstream` sidecar. Files no longer
  shipped are listed in `.squad/retired.json` and handled as retired files.
