# Release process

Playbook for publishing an xq-squad release. Implements [ExperienceQuality/xq-squad#29](https://github.com/ExperienceQuality/xq-squad/issues/29).

CI on every PR/push and always-on Release tests landed in [#32](https://github.com/ExperienceQuality/xq-squad/pull/32). Enforced branch protection ([#27](https://github.com/ExperienceQuality/xq-squad/issues/27)) and the separate #26 tracking issue were **cancelled**; a dedicated release PR remains **required process**, even without GitHub ruleset enforcement.

## Semver class (source of truth: CONTRIBUTING)

Classify the release by **consumer impact** before bumping the version:

| Class | Meaning |
| --- | --- |
| **Patch** | Typo, clarification, or validation fix. No new required behavior. |
| **Minor** | Additive agent/skill/rule, optional field, or backward-compatible workflow. |
| **Major** | Rename/removal, incompatible schema, ownership change, or **changed required behavior**. |

**Do not repeat 1.0.4:** that release shipped a new required rule (“rebase onto remote target before any authorized push or PR”) as a **patch**. Required-behavior changes are **major**. A reviewer must reject a “patch” PR that changes required behavior.

## Dedicated release PR

A release is **one PR**, not a direct push to `main` (policy):

1. Branch from up-to-date `main`.
2. In the **same** commit/PR, update:
   - `distribution/.squad/squad.json` — `version` and `release_tag` together
   - `CHANGELOG.md` (include any **breaking / required-behavior** callouts in that version’s section)
   - Every `vX.Y.Z` pin in `README.md` and `distribution/.squad/README.md`
3. Open the PR with [`.github/PULL_REQUEST_TEMPLATE/release.md`](../.github/PULL_REQUEST_TEMPLATE/release.md) (or paste its checklist).
4. PR title example: `release: vX.Y.Z (minor)`.
5. PR body **must** state semver class and why, plus consumer upgrade impact.
6. Wait for **CI** (`validate-and-test`) green. Do not merge on a red check.
7. After merge, the Release workflow runs tests again, then tags and publishes if that tag does not already exist.

## GitHub Release notes

The Release workflow does **not** publish `--generate-notes` alone. Notes include:

1. **Upgrade / rollback** — links to the README [Upgrade](../README.md#upgrade) and [Rollback](../README.md#rollback) sections for that tag, plus the pinned `update.sh` command.
2. **Changelog (this release)** — the matching `CHANGELOG.md` section for the version (so breaking / required-behavior text appears **in the GitHub notes**, not only as a link).
3. **Auto-generated changes** — PR list from GitHub’s generate-notes API.

Reviewers treat a missing breaking callout in CHANGELOG (and therefore in the notes) as a release blocker when required behavior changed.

## What CI and Release actually do

- **CI** (`.github/workflows/ci.yml`): every pull request and every push to `main` → `scripts/validate.sh`, `node --test tests/*.test.mjs`, every `tests/*.test.sh`.
- **Release** (`.github/workflows/release.yml`): same checks **always**; package/tag/publish only when the resolved `release_tag` is new. A docs-only push after a release still runs tests; it does not skip them.

## Concurrent-delivery protocol releases

If the release touches concurrent-delivery contracts, hooks, or registry/worktree helpers, also run the real two-session Cursor check described in [`docs/two-session-concurrent-delivery-check.md`](two-session-concurrent-delivery-check.md) ([#30](https://github.com/ExperienceQuality/xq-squad/issues/30)). Unrelated work (for example a new optional skill) does not need that check.

## Checklist (also in the release PR template)

- [ ] Semver class stated and matches CONTRIBUTING consumer-impact rules
- [ ] `squad.json` `version` + `release_tag` bumped together
- [ ] CHANGELOG updated; required/breaking behavior called out if any
- [ ] README and `distribution/.squad/README.md` pins match `release_tag`
- [ ] CI green on the PR
- [ ] (If protocol touched) two-session Cursor check report linked
