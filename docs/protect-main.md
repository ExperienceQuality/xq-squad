# Protect `main` (optional)

[Issue #27](https://github.com/ExperienceQuality/xq-squad/issues/27) (enforce branch protection) was **cancelled**. CI on every PR/push already lives on `main` ([#32](https://github.com/ExperienceQuality/xq-squad/pull/32)). Dedicated release PRs remain **required process** — see [`docs/release-process.md`](release-process.md) — even without a ruleset.

Use this page only if an org owner later chooses to turn on GitHub enforcement.

## Goal (if enabling)

- Humans cannot push directly to `main` (PR required)
- `CI / validate-and-test` is a required status check
- One approving review is required
- Admin bypass of the required check is off for normal use (or any bypass is explicit)

## GitHub UI

1. Open **Settings → Rules → Rulesets** (preferred) or **Branches → Branch protection rules**.
2. Confirm whether a ruleset or classic protection already covers `main`.
3. Create or edit a ruleset targeting `main`:
   - Restrict updates / require a pull request before merging
   - Required approvals: **1**
   - Required status checks: **`validate-and-test`** (workflow job name from `.github/workflows/ci.yml`)
   - Do not allow administrators to bypass required checks in normal use
4. Save and verify in the branch settings page.

## Verify

- Direct `git push origin main` is rejected for a non-exempt actor
- A PR with failing CI cannot merge
- A PR that only bumps `squad.json` cannot merge until CI is green

## Note

Repository administration API access may be unavailable to automation; an org owner applies these settings in the UI once CI has produced the check name on a PR.
