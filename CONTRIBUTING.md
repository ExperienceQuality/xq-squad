# Contributing to XQ Squad

## Source vs consumer planes

This repository is the package source. Consumers receive only `distribution/` files through releases.

- Edit consumer-facing behavior in `distribution/`.
- Edit tooling, tests, and docs at the repository root.
- Do not place source-only files like `install.sh`, `tests/`, or `.gitignore` inside `distribution/`.

## Installer portability

`install.sh` and `update.sh` must stay POSIX (`sh`-compatible, pipeable via `curl | sh`) and dependency-light:

- Hard requirements: `git`, `curl`, `tar`, and exactly one SHA-256 tool (`shasum`, `sha256sum`, or `openssl` — detected at runtime via `sha256_file`).
- Node.js is optional for install (POSIX fallbacks cover the AGENTS.md merge and install-state generation) but required for upgrade (`upgrade-managed.mjs`).
- Do not add new tool dependencies to the installers without a POSIX fallback.

## Adding an agent

1. Add portable role contract at `distribution/.squad/agents/<name>.md`.
2. Add Devin native adapter at `distribution/.devin/agents/<name>.md`.
3. Register the agent in `distribution/.squad/squad.json`.
4. Update Lead delegation guidance if relevant.
5. Add tests and run `bash scripts/validate.sh`.

Never add a Lead subagent. The Lead is the main Devin session.

## Adding a skill or rule

- Skills: `distribution/.devin/skills/<name>/SKILL.md`
- Rules: `distribution/.devin/rules/<name>.md`
- Keep `AGENTS.md` small; use skills and workflows for detailed procedures.

## Compatibility

Classify every change:

- **Patch**: typo, clarification, validation fix.
- **Minor**: additive agent/skill/rule, optional field, backward-compatible workflow.
- **Major**: rename/removal, incompatible schema, ownership change, changed required behavior.

## Required checks

```bash
bash scripts/validate.sh
node --test tests/*.test.mjs
bash tests/install.test.sh
bash tests/install-pipe.test.sh
bash tests/install-minimal.test.sh
bash tests/upgrade.test.sh
bash tests/e2e.test.sh
```

The `release` workflow (`.github/workflows/release.yml`) runs these same
checks on every push to `main` before tagging and publishing a release.

Also verify:

- `devin doctor` on an installed fixture.
- `devin skills list` shows `squad-delivery`.
- Custom profiles appear in Devin.

## PR template

Include purpose, changed public contracts, compatibility classification, tests run, upgrade impact, security/permission impact, and CHANGELOG entry.
