# Contributing to XQ Squad

## Source vs consumer planes

This repository is the package source. Consumers receive only `distribution/` files through releases.

- Edit consumer-facing behavior in `distribution/`.
- Edit tooling, tests, and docs at the repository root.
- Do not place source-only files like `install.sh`, `tests/`, or `.gitignore` inside `distribution/`.

## Installer portability

`install.sh` and `update.sh` must stay POSIX (`sh`-compatible, pipeable via `curl | sh`) and dependency-light:

- Hard requirements: `git`, `curl`, `tar`, and exactly one SHA-256 tool (`shasum`, `sha256sum`, or `openssl` — detected at runtime via `sha256_file`).
- Node.js 22 or newer is optional for install (POSIX fallbacks cover the AGENTS.md merge and install-state generation; without it the Cursor hooks are not installed and the installer warns) but required for upgrade (`upgrade-managed.mjs`); `update.sh` refuses Node <22 before changing anything.
- Do not add new tool dependencies to the installers without a POSIX fallback.

## Adding an agent

1. Add portable role contract at `distribution/.squad/agents/<name>.md`.
2. Add the Cursor subagent at `distribution/.cursor/agents/<name>.md` (it must reference the role contract), unless the role is intentionally goldfish-only (like `reviewer` since 3.0.0).
3. Register the agent in `distribution/.squad/squad.json`.
4. Update Lead delegation guidance if relevant.
5. Add tests and run `bash scripts/validate.sh`.

Never add a Lead subagent. The Lead is the main agent session.

## Adding a skill or rule

- Skills: `distribution/.cursor/skills/<name>/SKILL.md`
- Rules: `distribution/.cursor/rules/<name>.mdc`
- Removing a shipped file: list it (or its prefix) in `distribution/.squad/retired.json` with `since` and `reason`, so upgrades report it as retired instead of leaving it managed.
- Cursor is the only supported runtime; `scripts/validate-cursor-adapter.mjs` rejects other runtimes, `devin_profile`, and `.devin/` paths.
- Keep `AGENTS.md` small; use skills and workflows for detailed procedures.

## Compatibility

Classify every change:

- **Patch**: typo, clarification, validation fix.
- **Minor**: additive agent/skill/rule, optional field, backward-compatible workflow.
- **Major**: rename/removal, incompatible schema, ownership change, changed required behavior.

## Version bumps

- Bump `version` and `release_tag` together in `distribution/.squad/squad.json`.
- In the same change, update every `vX.Y.Z` pin in `README.md` and
  `distribution/.squad/README.md` — release-asset URLs, `--version` flags,
  archive filenames, and the current-release lines. `scripts/validate.sh`
  fails on any pin that does not match `release_tag`, and the release workflow
  runs it before tagging.
- Update `CHANGELOG.md`.

## Required checks

```bash
bash scripts/validate.sh
node --test tests/*.test.mjs
# every shell fixture (CI globs the same way):
for t in tests/*.test.sh; do bash "$t"; done
```

Run them on Node.js 22 (and 24/26 when available).

**CI (`.github/workflows/ci.yml`)** runs `validate.sh`, `node --test tests/*.test.mjs`, and every `tests/*.test.sh` on every pull request and every push to `main`.

**Release (`.github/workflows/release.yml`)** always runs those same checks first. It packages, tags, and publishes only when the resolved `release_tag` does not already exist as a git tag or GitHub Release. A docs-only push after a tag still runs CI and the Release test job; it does not skip tests.

Also verify:

- Install into a sample repository and open it in Cursor: Settings → Rules
  shows `xq-squad`, and the subagents and skills are listed.
- Asking the Agent to commit shows the `xq-squad-git-guard` approval prompt.

## Releases

Every version bump is a **dedicated release PR** (not a direct push to `main`).
Bump `squad.json`, CHANGELOG, and README pins together; state the semver class
from the Compatibility section above. Full playbook:
[`docs/release-process.md`](docs/release-process.md).

If the change touches concurrent-delivery contracts, hooks, or
registry/worktree helpers, run the real two-session Cursor check in
[`docs/two-session-concurrent-delivery-check.md`](docs/two-session-concurrent-delivery-check.md)
and link the report from the PR. Unrelated work (for example a new optional
skill) does not need that check. Keep
`tests/concurrent-delivery.test.sh` in CI either way.

## PR template

Include purpose, changed public contracts, compatibility classification
(patch/minor/major and why), tests run, upgrade impact, security/permission
impact, and CHANGELOG entry. Release PRs also use the checklist in
[`docs/release-process.md`](docs/release-process.md).
