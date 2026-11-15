# Tester uses the spec's test plan

- Status: Draft (not yet goldfish-reviewed)
- Owner: Elephant - xq-squad; approver: David Châu
- Target: next xq-squad minor release after v2.0.0
- Repo: https://github.com/ExperienceQuality/xq-squad

## 1. Problem, goals, non-goals

### Problem
The xq-squad tester picks whichever repo checks it thinks are relevant, so its results can't be traced back to a spec. Product elephants now write specs at `docs/designs/<feature>.md` in consumer repos, each with a V-model test plan (test IDs, levels). Nothing connects that plan to the verification xq-squad does.

### Goals
- When the delivery request names a spec path, the tester runs that spec's test plan and reports against its test IDs and levels.
- Every test ID stays NOT RUN until there is observed evidence.
- A named spec with no usable test plan, or a named spec file that doesn't exist, gives BLOCKED. The tester never invents cases.
- With no spec named, behavior is identical to v2.0.0, so all consumers can upgrade safely.

### Non-goals
- No spec review, spec drafting or test design inside xq-squad (it stays pure implementation).
- No automatic lookup of specs in `docs/designs/`.
- No vendored EGM, no `.squad/egm.json`, and no changes to the analyst or memory-maintainer.

## 2. Design

### Who defines the spec path
David names the spec path in the delivery request he gives his Cursor (for example "implement `docs/designs/budget-alerts.md`"). The product elephant creates the file through a spec PR that David merges. xq-squad never invents or guesses a path.

### Files that change (all under `distribution/`)
- `.squad/agents/tester.md`: new "Spec test plan mode" section. It applies only when the Lead passes a spec path.
- `.cursor/agents/tester.md`: same rule. The tester may add test code required by spec test IDs and may not edit any other source files.
- `.squad/agents/lead.md` and `.cursor/skills/squad-delivery/SKILL.md`: at INTAKE, record the spec path if the request names one; at VERIFICATION, pass it to the tester.
- `.squad/workflows/delivery.md`: one line in VERIFICATION about the spec path. The stages don't change.

### Tester behavior when a spec path is named
1. If the file doesn't exist, report BLOCKED and name the missing path.
2. Read the spec's test plan. If it's missing or has no test IDs, report BLOCKED and stop.
3. For each test ID, run the existing check or add the test code it requires. Record its level, status (PASS / FAIL / NOT RUN) and evidence.
4. Never add cases that aren't in the spec. Anything that can't be run stays NOT RUN with a reason.

### Report format (spec mode)
```markdown
## Spec test plan: docs/designs/<feature>.md
| Test ID | Level | Status | Evidence |
|---|---|---|---|
| T-01 | Unit | PASS | `npm test -- foo` output |

## Repo checks
(v2.0.0 table, unchanged)
```

### Compatibility
With no path named, none of the new sections run and the output matches v2.0.0. Only managed files change, so `update.sh` upgrades them cleanly. A consumer that has edited these files locally gets the usual `.squad-upstream` conflict.

## 3. Test plan (V-model)
Every test starts as NOT RUN and moves to PASS or FAIL only with real evidence.

### Requirements
- R1: When a spec is named and it has a test plan, the tester reports one row per test ID.
- R2: When the named spec has no usable plan, the tester reports BLOCKED.
- R3: When the named spec file is missing, the tester reports BLOCKED and names the path.
- R4: The tester never adds cases beyond the spec, and anything it can't run stays NOT RUN with a reason.
- R5: With no spec named, the output matches v2.0.0.
- R6: Upgrading from v2.0.0 works cleanly.

### Tests
| Test ID | Level | Covers | Check | Status |
|---|---|---|---|---|
| T-01 | Contract | R1–R4 | Both tester files and `lead.md` contain the new rules | NOT RUN |
| T-02 | Integration | R1 | Sample repo plus a spec with 3 test IDs gives 3 rows with evidence | NOT RUN |
| T-03 | Integration | R2 | Spec without a test plan gives BLOCKED | NOT RUN |
| T-04 | Integration | R3 | Bad spec path gives BLOCKED and names the path | NOT RUN |
| T-05 | Integration | R4 | A test ID that can't be run gives NOT RUN with a reason; no extra rows | NOT RUN |
| T-06 | Integration | R5 | No spec gives the same output format as v2.0.0 | NOT RUN |
| T-07 | Upgrade | R6 | `update.sh` from v2.0.0 on the sample repo; no `.squad-upstream` files | NOT RUN |
| T-08 | Acceptance | R1, R6 | xq-financial-app pilot: one real delivery against a PAN spec | NOT RUN |
| T-09 | Regression | R5, R6 | xq-platform upgrade plus a no-spec delivery behaves as before | NOT RUN |

### Coverage
Every requirement maps to at least one test, and every test maps to a requirement. Goldfish reviewers check this at the draft and readiness gates. The dev issue closes only when each test ID is PASS with evidence or David explicitly accepts it as NOT RUN.

## 4. Rollout and risks

### Rollout (David approves each step)
1. Release a new minor version (backward compatible).
2. Pilot: xq-financial-app (PAN), covering T-08.
3. xq-platform (T-09), then xq-jewy.
4. xq-exercices-miniapp only after its Prettier fix: `.prettierignore` excludes `.squad/` and `.cursor/`, and the 31 managed files are restored first.
5. All other consumers are optional.

### Risks
- Consumers with locally edited tester or lead files get `.squad-upstream` conflicts, which are resolved per repo.
- Product specs that lack test IDs will cause BLOCKED. That's intended, and the product elephants should know before the pilot.
- The tester writing test code blurs a little into the implementer's role. That's limited to test code tied to spec test IDs.
