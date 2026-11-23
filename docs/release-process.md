# Release process

Playbook for publishing an xq-squad release. Implements [ExperienceQuality/xq-squad#29](https://github.com/ExperienceQuality/xq-squad/issues/29). Branch protection that forces a PR (not a direct push) is [ExperienceQuality/xq-squad#27](https://github.com/ExperienceQuality/xq-squad/issues/27); CI on every PR/push is [ExperienceQuality/xq-squad#26](https://github.com/ExperienceQuality/xq-squad/issues/26).

## Semver class (source of truth: CONTRIBUTING)

Classify the release by **consumer impact** before bumping the version:

| Class | Meaning |
| --- | --- |
| **Patch** | Typo, clarification, or validation fix. No new required behavior. |
| **Minor** | Additive agent/skill/rule, optional field, or backward-compatible workflow. |
| **Major** | Rename/removal, incompatible schema, ownership change, or **changed required behavior**. |

**Do not repeat 1.0.4:** that release shipped a new required rule (“rebase onto remote target before any authorized push or PR”) as a **patch**. Required-behavior changes are **major** (or at least called out as breaking in the notes if the version line is already constrained). A reviewer must reject a “patch” PR that changes required behavior.

## Dedicated release PR

A release is **one PR**, not a direct push to `main`:

1. Branch from up-to-date `main`.
2. In the **same** commit/PR, update:
   - `distribution/.squad/squad.json` — `version` and `release_tag` together
   - `CHANGELOG.md`
   - Every `vX.Y.Z` pin in `README.md` and `distribution/.squad/README.md`
3. PR title example: `release: vX.Y.Z (minor)`.
4. PR body **must** state:
   - Semver class and why (map to the table above)
   - Consumer upgrade impact (none / optional skill / required behavior / migration)
   - Link to CHANGELOG section
5. Wait for **CI** (`validate-and-test`) green. Do not merge on a red check.
6. After merge, the Release workflow runs tests again, then tags and publishes if that tag does not already exist.

## GitHub Release notes

The Release workflow does **not** publish `--generate-notes` alone. Notes include:

1. **Upgrade / rollback** — links to the README Upgrade and Rollback sections for that tag, the pinned `update.sh` command, and a pointer to CHANGELOG for migrations.
2. **Auto-generated changes** — PR list from GitHub’s generate-notes API.

If the release changes **required** consumer behavior or is otherwise breaking, say so explicitly in CHANGELOG **and** ensure the upgrade section / CHANGELOG callout is accurate. Reviewers treat a missing callout as a release blocker.

## What CI and Release actually do

- **CI** (`.github/workflows/ci.yml`): every pull request and every push to `main` → `scripts/validate.sh`, `node --test tests/*.test.mjs`, every `tests/*.test.sh`.
- **Release** (`.github/workflows/release.yml`): same checks **always**; package/tag/publish only when the resolved `release_tag` is new. A docs-only push after a release still runs tests; it does not skip them.

## Concurrent-delivery protocol releases

If the release touches concurrent-delivery contracts, hooks, or registry/worktree helpers, also run the real two-session Cursor check described in [`docs/two-session-concurrent-delivery-check.md`](two-session-concurrent-delivery-check.md) ([#30](https://github.com/ExperienceQuality/xq-squad/issues/30)). Unrelated work (for example a new optional skill) does not need that check.

## Checklist (paste into the release PR)

- [ ] Semver class stated and matches CONTRIBUTING consumer-impact rules
- [ ] `squad.json` `version` + `release_tag` bumped together
- [ ] CHANGELOG updated; required/breaking behavior called out if any
- [ ] README and `distribution/.squad/README.md` pins match `release_tag`
- [ ] CI green on the PR
- [ ] (If protocol touched) two-session Cursor check report linked
