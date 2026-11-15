# Cursor integration

Formats follow the Cursor docs: rules (https://cursor.com/docs/context/rules),
subagents (https://cursor.com/docs/context/subagents), skills
(https://cursor.com/docs/context/skills), hooks (https://cursor.com/docs/agent/hooks).

| File | Purpose |
| --- | --- |
| `.cursor/rules/xq-squad.mdc` | `alwaysApply: true`. Makes the main Agent the Lead and points to `.squad/agents/lead.md` and the workflows. Cursor ignores `.md` files in `rules/`, so the extension must be `.mdc`. |
| `.cursor/agents/<role>.md` | Subagents `analyst`, `reviewer` (`readonly: true`), `implementer`, `tester`, `memory-maintainer`. Each defers to `.squad/agents/<role>.md` and returns a structured result to the Lead. |
| `.cursor/skills/<name>/SKILL.md` | `squad-delivery`, `train-me`, `fetch-openapi-spec`. |
| `.cursor/hooks.json` | Project hooks (run from the project root, need Node.js 22 or newer on PATH; without it `install.sh` does not install them and warns). |

## Hooks

| Hook | Event | Behavior |
| --- | --- | --- |
| `xq-squad-git-guard.mjs` | `beforeShellExecution` | `ask` for `git commit`, `git push`, `gh pr create`, `gh release create`. The user approves each one. |
| `xq-squad-scope-guard.mjs` | `preToolUse` (`Write\|Delete`) | Inside an ACTIVE delivery worktree (`.squad/worktrees/<id>`), denies writes outside the claim's scope (via `delivery-scope.mjs`). A session in a delivery worktree can't write outside it. If the registry can't be read, it denies inside delivery worktrees and allows everywhere else. The main checkout with no deliveries is unaffected. |
| `xq-squad-verify-reminder.mjs` | `stop` | If a delivery worktree has uncommitted changes, sends one `followup_message` asking for VERIFICATION and memory status (`loop_limit: 1`). |

Cursor hooks fail open when a hook crashes or times out. They are a safety
net; the core contracts remain authoritative.

Add your own hooks to `.cursor/hooks.json`. Upgrades only replace entries
whose command is under `.cursor/hooks/xq-squad-`. Name your own rules,
agents, skills, and hook scripts `local-*`.

## Elephant-Goldfish Model (EGM)

xq-squad vendors EGM under `.egm/`. Cursor does not auto-load that tree as a
plugin. Two usage modes (also described in `.egm/docs/cursor.md`):

1. **Interactive (preferred):** install the same package as a local Cursor
   plugin pointing at the repository's `.egm/` copy, reload Cursor, and
   confirm seven skills, the EGM reviewers, and the EGM rule.
2. **Contract path (required):** set `EGM_ROOT` to the absolute path of
   `.egm/`. If a slash command is not exposed, read
   `.egm/skills/<name>/SKILL.md` and follow it. Contracts must work with this
   path even when the plugin UI is not installed.

Intake runs `egm-review` (`Step=implementation`) in a fresh `analyst`
context (Goldfish). If nested reviewer subagents fail, the Lead
direct-dispatches the three EGM personas as fresh Tasks with Goldfish-only
context. If no fresh context can be created, the workflow ends `BLOCKED`.
There is no same-context fallback; the Lead never runs EGM itself.

Wrap-up runs `egm-drift-report` from `memory-maintainer` on `docs/designs/`
(or `spec_dir`), writing under `.squad/egm-artifacts/`.

EGM's own Cursor adapter is experimental and unverified. Pilot evidence is
required before treating isolation as proven.

## Concurrency

Cursor subagents share the parent checkout. Separate deliveries must use
`.squad/workflows/concurrent-delivery.md` (one approved worktree + claim per
delivery), like every squad session. Open each delivery's worktree as its own
Cursor workspace so the scope guard applies.
