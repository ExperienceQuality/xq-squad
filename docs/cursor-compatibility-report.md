# Cursor Compatibility Report (v1.4.0)

## Verified (automated, this repository)

- Every Cursor file checked against the documented formats by
  `scripts/validate-cursor-adapter.mjs`: `.mdc` rules with frontmatter,
  subagent `name`/`description`/`readonly`, skill `name` = folder, hook
  `version: 1`, supported event names, known entry keys, valid matchers,
  existing scripts.
- Hook scripts exercised with sample Cursor stdin payloads
  (`tests/cursor-adapter.test.mjs`): ask/allow, deny/allow, follow-up once.
- Install/upgrade (`tests/install-cursor.test.sh`): fresh install with
  pre-existing consumer `.cursor/` files, upgrade from a Devin-only release,
  hooks.json merge, conflict sidecars, install-state tracking, repeat
  install/update, reproducible archives.
- Devin adapter unchanged; existing suites pass.

## Not verified

- No real Cursor IDE or cloud-agent session was run: rule loading, subagent
  delegation, skill discovery, and hook execution inside Cursor are untested.
- The exact `preToolUse` `tool_input` field names for Write/Delete. The scope
  guard accepts `file_path`, `path`, or `target_file`; if Cursor uses another
  name, the hook allows the write (fail open).

## Recommended manual gate

1. Install into a sample repo; open it in Cursor.
2. Check Settings → Rules shows `xq-squad`, the subagents, and the skills.
3. Ask the Agent to commit; confirm the approval prompt appears.
4. Start a concurrent delivery, open its worktree, write outside the
   scope; confirm denial.
