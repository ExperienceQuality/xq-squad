<!-- Use this template for version-bump / release PRs (#29). -->

## Release

- **Version:** vX.Y.Z
- **Semver class:** patch | minor | major
- **Why this class:** (map to CONTRIBUTING consumer-impact rules — patch = typo/clarification/validation; minor = additive/optional; major = rename/removal, incompatible schema, ownership change, or changed required behavior)
- **Do not repeat 1.0.4:** required-behavior changes are not a patch.

## Files in this PR (required together)

- [ ] `distribution/.squad/squad.json` — `version` + `release_tag` bumped together
- [ ] `CHANGELOG.md` — this version’s section; **breaking / required-behavior** called out if any
- [ ] `README.md` and `distribution/.squad/README.md` — every `vX.Y.Z` pin matches `release_tag`

## Consumer impact

- Upgrade impact: none | optional opt-in | required behavior | migration needed
- Migration notes (or “none”):

## Checks

- [ ] CI green (`validate-and-test`)
- [ ] (If concurrent-delivery protocol touched) two-session Cursor check report linked — see `docs/two-session-concurrent-delivery-check.md`

## References

- Playbook: `docs/release-process.md`
- Issue: ExperienceQuality/xq-squad#29
