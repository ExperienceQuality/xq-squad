# Spec Test Plan Mode — Lead Implementation Plan

Status: **Draft planning only.** Feature status remains **Draft**. EXECUTION of
distribution changes waits on **goldfish review + David Châu approval (G0)**.

Product design owner: Elephant (xq-squad). Approver: David Châu.
Target: next xq-squad **minor** release after v2.0.0 (current:
`distribution/.squad/squad.json` → `2.0.0` / `v2.0.0`).
Repo: https://github.com/ExperienceQuality/xq-squad

**This PR / these `tasks/` files do not land the product design.** The product
owner merges the draft design into `docs/designs/**` (or equivalent). Do not
create, commit, or pretend to merge any design-spec file as part of this
breakdown. Source of truth for contracts below is the draft provided by the
product owner until goldfish + David approve.

Task list: [tasks/spec-test-plan-mode-todo.md](spec-test-plan-mode-todo.md).

## Objective

When a delivery request **names a spec path**, the tester runs that spec's
V-model test plan and reports against its test IDs and levels. With **no path
named**, behavior stays identical to v2.0.0 so all consumers can upgrade safely.

## Scope and constraints

- Planning artifacts only in this breakdown PR (`tasks/` only).
- No `distribution/` edits until G0.
- No automatic lookup of specs under `docs/designs/`.
- No spec review, drafting, or test design inside xq-squad.
- No vendored EGM, no `.squad/egm.json`, no analyst or memory-maintainer changes.
- David names the path in the delivery request; xq-squad never invents or guesses it.
- Stages in `delivery.md` do not change; VERIFICATION gains one line about the path.

## Managed files the feature will change (do not edit until G0)

| Path | Change summary |
|---|---|
| `distribution/.squad/agents/tester.md` | New "Spec test plan mode" section (only when Lead passes a path). |
| `distribution/.cursor/agents/tester.md` | Same mode; may add **test code required by named spec test IDs**; must not edit any other source. (Today: "Do not edit source files".) |
| `distribution/.squad/agents/lead.md` | INTAKE: record named path; VERIFICATION: pass path to tester. |
| `distribution/.cursor/skills/squad-delivery/SKILL.md` | Same INTAKE / VERIFICATION path handoff. |
| `distribution/.squad/workflows/delivery.md` | One VERIFICATION line about the named spec path. |

Plus later (I5 / release): version bump / changelog / release assets as required
for the minor — not in this planning PR.

## Frozen contracts (implementers implement against these as written)

Frozen for human review at G0. Executors must not invent alternate behavior.

### Path authority

- Spec path is an optional string on the delivery request, recorded at **INTAKE**.
- Absent / empty / unset → **legacy mode** (v2.0.0 tester behavior and report).
- Present → **spec test plan mode**. Never invent, guess, or search for a path.

### Spec test plan mode — tester algorithm

1. **Missing file** → `Status: BLOCKED`; name the path; stop. Do not invent cases.
2. **Missing or unusable plan** (no parseable test IDs) → `Status: BLOCKED`; stop.
   Do not invent cases. ("Usable plan" definition is an open question for
   David/goldfish — see below; until answered, treat "has at least one test ID"
   as the working contract.)
3. For **each** test ID in the plan: run an existing check or add only the test
   code required by that ID; record **Level**, **Status**
   (`PASS` | `FAIL` | `NOT RUN`), and **Evidence**.
4. Every test ID starts as **NOT RUN** until there is observed evidence.
5. Never invent extra cases. Unrunnable IDs stay `NOT RUN` with a reason.
6. Then emit the unchanged v2.0.0 **Repo checks** table (legacy section still
   present in the same report).

### Cursor edit posture (tester profile)

When path is named: tester **may** add/update test code required by named spec
test IDs; tester **must not** edit any other source files.
When path is not named: keep today's posture ("Do not edit source files") unless
G0 changes it (open question).

### Report format (spec mode)

```markdown
## Spec test plan: docs/designs/<feature>.md
| Test ID | Level | Status | Evidence |
|---|---|---|---|
| … | … | PASS \| FAIL \| NOT RUN | … |

## Repo checks
| Check | Command | Status |
|---|---|---|
| … | … | …   # v2.0.0 table unchanged
```

Legacy mode (no path): output identical to v2.0.0 (no Spec test plan section).

### Lead / skill / workflow handoff

- **INTAKE** (`lead.md`, `squad-delivery/SKILL.md`): if the request names a spec
  path, record it on the delivery context; otherwise leave unset.
- **VERIFICATION** (`lead.md`, skill, `delivery.md`): when a path is recorded,
  pass it to the tester and require the spec-mode report; when unset, invoke
  tester with no path (v2.0.0).
- Workflow stage graph unchanged.

### Compatibility / upgrade

- No path → byte-for-contract v2.0.0 behavior.
- `update.sh` from v2.0.0: clean upgrade; no `.squad-upstream` for unmodified
  managed files.
- Local edits to tester/lead → usual `.squad-upstream` conflict (documented risk).

## Requirements

| ID | Requirement |
|---|---|
| R1 | Named usable plan → one report row per test ID with level, status, evidence. |
| R2 | Named unusable plan (no test IDs) → BLOCKED; stop; no invented cases. |
| R3 | Named missing file → BLOCKED and name the path. |
| R4 | No invented cases; unrunnable ID → NOT RUN + reason; no extra rows. |
| R5 | No path named → v2.0.0 output format and behavior. |
| R6 | Upgrade from v2.0.0 works cleanly (`update.sh`; no spurious `.squad-upstream`). |

## Spec tests (all NOT RUN until execution)

| Test | Covers | Intent |
|---|---|---|
| T-01 | R1–R4 | Contract: both tester files + `lead.md` contain the new rules. |
| T-02 | R1 | Integration: sample + 3-ID spec → 3 rows with evidence. |
| T-03 | R2 | Integration: no usable plan → BLOCKED. |
| T-04 | R3 | Integration: bad path → BLOCKED + names path. |
| T-05 | R4 | Integration: unrunnable ID → NOT RUN + reason; no extra rows. |
| T-06 | R5 | Integration: no spec → v2.0.0 format. |
| T-07 | R6 | Upgrade: `update.sh` from v2.0.0; no `.squad-upstream`. |
| T-08 | R1, R6 | Acceptance: xq-financial-app pilot vs PAN spec. |
| T-09 | R5, R6 | Regression: xq-platform upgrade + no-spec delivery. |

## Requirement ↔ test map

| Requirement | Tests |
|---|---|
| R1 | T-01, T-02, T-08 |
| R2 | T-01, T-03 |
| R3 | T-01, T-04 |
| R4 | T-01, T-05 |
| R5 | T-06, T-09 |
| R6 | T-07, T-08, T-09 |

## Evidence tracker

| Test | Status | Evidence location |
|---|---|---|
| T-01 | NOT RUN | — |
| T-02 | NOT RUN | — |
| T-03 | NOT RUN | — |
| T-04 | NOT RUN | — |
| T-05 | NOT RUN | — |
| T-06 | NOT RUN | — |
| T-07 | NOT RUN | — |
| T-08 | NOT RUN | — |
| T-09 | NOT RUN | — |

Evidence location convention is an open question (see below). Until decided,
implementers record paths under a lead-chosen `tasks/` or `tests/` artifact and
update this table at CP2/CP3.

## Schedule

```text
G0 → [I1 ‖ I2] → CP1 → I3 → I4 → CP2 → I5 → CP3 → R1 → R2 → R3
```

| Gate / slice | Meaning | Deps |
|---|---|---|
| **G0** | Goldfish review + David Châu approval of the design; EXECUTION unlocked. | — |
| **I1** | Tester contracts (`.squad` + `.cursor` tester.md). | G0 |
| **I2** | Lead / skill / workflow path handoff. | G0 |
| **CP1** | Lead reviews I1‖I2 diffs vs frozen contracts; no version bump; no consumer claim. | I1, I2 |
| **I3** | Fixtures + automate T-01 and T-07. | CP1 |
| **I4** | Scenario automation T-02…T-06. | I3 |
| **CP2** | All automated T-01…T-07 green or failures owned; evidence table updated. | I3, I4 |
| **I5** | Version bump / release packaging for the minor (compat with R5/R6). | CP2 |
| **CP3** | Release candidate gate: contracts + automation + bump reviewed. | I5 |
| **R1** | Ship new minor (backward compatible). | CP3; David |
| **R2** | Pilot xq-financial-app (T-08). | R1; David |
| **R3** | xq-platform (T-09), then xq-jewy; xq-exercices-miniapp only after Prettier fix (`.prettierignore` excludes `.squad/` and `.cursor/`, 31 managed files restored). Other consumers optional. | R2; David |

David owns each rollout step (R1–R3). Parallelism: **I1 ‖ I2** only after G0;
I3 before I4; I5 after CP2.

## Risks

| Risk | Mitigation |
|---|---|
| Local tester/lead edits → `.squad-upstream` on upgrade | Document; R6/T-07 assert clean path for unmodified installs. |
| Specs without IDs → BLOCKED | Intended (R2); open question sharpens "usable plan". |
| Tester writing test code blurs implementer role | Limited to test code for **named** IDs; Cursor profile text must say so. |
| Execution before G0 | Hard stop: this plan forbids `distribution/` edits until G0. |

## Open questions for David Châu / goldfish

1. **Version tag:** Is the next minor `v2.1.0`, or a different tag?
2. **Usable plan definition:** Minimum structure for "usable" (heading names,
   table shape, required Level field, ID regex)? Working assumption: ≥1 test ID.
3. **Cursor edit posture:** Confirm tester may edit **test code only** for named
   IDs in spec mode; confirm legacy mode keeps "Do not edit source files".
4. **Evidence location:** Where should T-01…T-09 artifacts live
   (`tests/`, `tasks/`, release notes, pilot repos)?
5. **xq-exercices-miniapp Prettier gate:** Confirm R3 blocker ownership and that
   the 31-file restore + `.prettierignore` is out of this feature's code PR.
6. **Design merge path:** Confirm product owner merges the design; xq-squad
   planning PRs must not add `docs/designs/**` for this feature.

## Non-goals (restate)

- Spec review / drafting / test design inside xq-squad.
- Auto-discovery of `docs/designs/`.
- EGM / `.squad/egm.json` / analyst / memory-maintainer changes.
- Landing the product design in this planning PR.
