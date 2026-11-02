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

## Concurrency

Cursor subagents share the parent checkout. Separate deliveries must use
`.squad/workflows/concurrent-delivery.md` (one approved worktree + claim per
delivery), like every squad session. Open each delivery's worktree as its own
Cursor workspace so the scope guard applies.
