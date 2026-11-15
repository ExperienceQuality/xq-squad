# Spec test plan mode — Implementation Plan

Status: **Draft intake complete. Waiting on goldfish review + David Châu approval
before EXECUTION.** Spec remains Draft until then.

Approved / source spec: [docs/designs/tester-uses-spec-test-plan.md](../docs/designs/tester-uses-spec-test-plan.md)
Task list: [tasks/spec-test-plan-mode-todo.md](spec-test-plan-mode-todo.md)

Target release: next minor after `v2.0.0` (expected `v2.1.0`). Baseline today:
`distribution/.squad/squad.json` → `2.0.0`.

## Objective

When a delivery request names a spec path, the Lead records it and the tester
runs that spec's V-model test plan (test IDs + levels), reporting PASS / FAIL /
NOT RUN with evidence — never inventing cases. With no path named, behavior and
report format stay identical to v2.0.0.

## Scope and constraints

**In scope (managed files under `distribution/` only):**

| File | Change |
|---|---|
| `.squad/agents/tester.md` | New "Spec test plan mode" section |
| `.cursor/agents/tester.md` | Same rules; allow test-code edits for named test IDs only |
| `.squad/agents/lead.md` | INTAKE: record named path; VERIFICATION: pass path to tester |
| `.cursor/skills/squad-delivery/SKILL.md` | Mirror Lead INTAKE + VERIFICATION |
| `.squad/workflows/delivery.md` | One VERIFICATION line about the named spec path |

**Out of scope (non-goals from the spec):**

- Spec review / drafting / test design inside xq-squad
- Auto-discovery under `docs/designs/`
- Vendored EGM, `.squad/egm.json`
- Analyst or memory-maintainer changes
- Stage order changes in the delivery workflow

**Compatibility:** no-spec path must match v2.0.0 output. Clean `update.sh` from
v2.0.0 on an unmodified consumer (T-07). Locally edited tester/lead files still
get the usual `.squad-upstream` conflict.

## Frozen contracts (for implementer + tester)

Do not invent beyond these. Goldfish review may amend them before EXECUTION.

### Spec path authority

- Only the delivery request may name the path (example: ``implement `docs/designs/budget-alerts.md` ``).
- Lead records it at INTAKE when present; never guesses or searches.
- Lead passes the exact path to the tester at VERIFICATION.
- Absence of a path ⇒ v2.0.0 tester behavior only.

### Tester — Spec test plan mode (named path only)

1. Missing file → `BLOCKED`, name the path, stop.
2. Missing / empty test plan (no test IDs) → `BLOCKED`, stop.
3. For each test ID: run existing check or add the test code that ID requires;
   record Level, Status (`PASS` \| `FAIL` \| `NOT RUN`), Evidence.
4. Never add cases not in the plan. Unrunnable IDs stay `NOT RUN` with a reason.
5. May edit **test code only** when required by a named test ID; must not edit
   other source files. (Cursor adapter today says "Do not edit source files" —
   that line must be narrowed, not deleted for no-spec mode.)

### Report format (spec mode)

```markdown
## Spec test plan: docs/designs/<feature>.md
| Test ID | Level | Status | Evidence |
|---|---|---|---|
| T-01 | Unit | PASS | `npm test -- foo` output |

## Repo checks
(v2.0.0 table, unchanged)
```

No-spec mode keeps the existing `## Checks run` / skipped / failures tables only.

### Lead / skill / workflow deltas

- **INTAKE:** if the request names a spec path, record it as a delivery field;
  do not invent one.
- **VERIFICATION:** if a path was recorded, pass it to the tester and require the
  spec-mode report; otherwise unchanged.
- **delivery.md:** one sentence under Verification — pass named path through;
  stages unchanged.

## Requirement ↔ test map (from the spec)

| Req | Meaning | Covered by |
|---|---|---|
| R1 | Named usable plan → one row per test ID | T-01, T-02, T-08 |
| R2 | Unusable plan → BLOCKED | T-01, T-03 |
| R3 | Missing file → BLOCKED + path | T-01, T-04 |
| R4 | No invented cases; unrunnable → NOT RUN + reason | T-01, T-05 |
| R5 | No path → v2.0.0 output | T-06, T-09 |
| R6 | Clean upgrade from v2.0.0 | T-07, T-08, T-09 |

Every requirement has ≥1 test; every test maps to a requirement. Dev issue closes
only when each T-ID is PASS with evidence, or David accepts NOT RUN.

## Task schedule

```text
G0 (gate: goldfish + David)
  -> [I1 ‖ I2] contract edits
  -> CP1 (T-01 contract assert)
  -> I3 fixtures + automated checks (T-01, T-07)
  -> I4 integration scenarios (T-02…T-06)
  -> CP2 (all automated + scenario evidence)
  -> I5 version bump + CHANGELOG + package validate
  -> CP3 (release candidate)
  -> R1 pilot xq-financial-app (T-08)   [David-gated]
  -> R2 xq-platform (T-09), then xq-jewy
  -> R3 xq-exercices-miniapp (after Prettier fix)
```

Parallel: I1 (tester contracts) and I2 (lead/skill/workflow) touch different
files and may run in parallel after G0.

## Tasks

### G0 — Gate: draft → approved (Lead / David / goldfish)

- **Owner:** Lead + goldfish reviewers; **approver:** David Châu
- **Acceptance:** Spec status leaves Draft; coverage table reviewed; EXECUTION
  authorized. Until then, no managed-file edits for this feature.
- **Deps:** none
- **Evidence:** review notes / approval message (not code)

### I1 — Tester contracts (Implementer)

- **Files:**
  - `distribution/.squad/agents/tester.md`
  - `distribution/.cursor/agents/tester.md`
- **Acceptance:**
  - "Spec test plan mode" section exists; applies only when Lead passes a path.
  - Rules cover missing file, unusable plan, per-ID execution, NOT RUN + reason,
    no invented cases, and the dual report sections.
  - Cursor adapter allows test-code edits for named test IDs only; other sources
    still forbidden. No-spec wording still forbids unrelated source edits.
- **Verify:** feeds T-01
- **Deps:** G0

### I2 — Lead, skill, workflow wiring (Implementer)

- **Files:**
  - `distribution/.squad/agents/lead.md`
  - `distribution/.cursor/skills/squad-delivery/SKILL.md`
  - `distribution/.squad/workflows/delivery.md`
- **Acceptance:**
  - INTAKE records a named path when present; never invents.
  - VERIFICATION passes the recorded path to the tester.
  - `delivery.md` gains exactly one Verification line; stage list unchanged.
- **Verify:** feeds T-01
- **Deps:** G0

### CP1 — Contract checkpoint (Lead + Tester)

- Assert both tester files + `lead.md` (+ skill/workflow as needed) contain the
  new rules (T-01). No usable-concurrency / release claims.
- **Deps:** I1, I2

### I3 — Fixtures + automated contract/upgrade checks (Implementer + Tester)

- **Files (expected):**
  - `tests/fixtures/sample-consumer/docs/designs/` — sample specs:
    - usable plan with 3 test IDs
    - spec with no test plan / no IDs
  - Contract assert test (extend existing test suite or add focused check) for
    T-01 string/rule presence in managed files
  - Upgrade path for T-07: `update.sh` from packaged v2.0.0 → new minor on an
    unmodified sample consumer; assert no `.squad-upstream` for the five managed
    files this feature changes
- **Acceptance:** T-01 and T-07 have reproducible commands and evidence paths
- **Deps:** CP1

### I4 — Integration scenarios T-02…T-06 (Tester, Lead-driven)

Prompt-level behavior. Run against fixtures (or a throwaway consumer install of
the candidate distribution). Capture transcripts / report tables as evidence.

| ID | Scenario | Expected |
|---|---|---|
| T-02 | Spec with 3 IDs | Exactly 3 rows; each has evidence |
| T-03 | Spec without usable plan | BLOCKED |
| T-04 | Bad / missing path | BLOCKED and path named |
| T-05 | One ID unrunnable | That row NOT RUN + reason; no extra rows |
| T-06 | No path named | Report matches v2.0.0 `Checks run` shape |

- **Deps:** I3
- **Note:** Do not fake PASS. Unrunnable scenario stays NOT RUN until observed.

### CP2 — Verification gate (Lead)

- All of T-01…T-07 either PASS with evidence or David-accepted NOT RUN.
- Diff limited to intended managed files (+ tests/fixtures/docs as needed).
- `bash scripts/validate.sh` and relevant automated tests green.
- **Deps:** I4

### I5 — Minor release packaging (Implementer)

- Bump `distribution/.squad/squad.json` version / `release_tag` to next minor.
- `CHANGELOG.md` entry: Spec test plan mode; backward compatible; list managed
  file behavior.
- Package + validate release assets.
- **Deps:** CP2 + David approval to cut the minor

### CP3 — Release candidate (Lead + David)

- Tag/publish per existing release workflow only when David authorizes.
- **Deps:** I5

### R1 — Pilot T-08 (Lead / consumer owners; David-gated)

- Consumer: `xq-financial-app` (PAN). One real delivery that names a PAN spec.
- Evidence: delivery report with Spec test plan table.
- **Deps:** CP3

### R2 — Platform regression T-09, then xq-jewy (David-gated)

- Upgrade `xq-platform`; run a no-spec delivery; confirm v2.0.0-shaped output.
- Then `xq-jewy` per rollout list.
- **Deps:** R1 (or David reorders)

### R3 — xq-exercices-miniapp (deferred)

- Only after: `.prettierignore` excludes `.squad/` and `.cursor/`, and the 31
  managed files are restored.
- **Deps:** Prettier fix (outside this plan's code) + David

## Ownership

| Slice | Role |
|---|---|
| G0, CP*, R* | Lead (+ David / goldfish as named) |
| I1, I2, I3, I5 | Implementer |
| I3 asserts, I4, evidence for T-* | Tester |
| Review of managed-file diffs | Reviewer (after CP1 / before CP3) |

No analyst or memory-maintainer work. Memory update on close of the xq-squad
delivery only if conventions changed enough to warrant it.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Consumers with local tester/lead edits → `.squad-upstream` | Document; resolve per repo; T-07 proves clean path |
| Specs without test IDs → BLOCKED in the field | Intended; brief product elephants before pilot |
| Tester writing test code blurs implementer role | Hard limit: only code required by named test IDs |
| Draft changes after goldfish review | Re-freeze contracts; re-run T-01 before I3 |
| Integration T-02…T-06 hard to automate fully | Fixture + observed agent runs; honest NOT RUN |

## Open questions for David / goldfish (before G0 closes)

1. Confirm next minor tag is `v2.1.0`.
2. Confirm "usable test plan" = presence of at least one test ID (table or
   equivalent), not a stricter schema.
3. Confirm Cursor tester may add/update **test files only** when a path is named;
   no-spec mode keeps today's "do not edit source files" posture (or should
   no-spec also allow discretionary test updates as the squad tester.md already
   implies?).
4. Where should T-02…T-06 evidence live (issue comments vs `docs/` note)?

## Explicit non-work

- Do not change analyst, memory-maintainer, reviewer contracts.
- Do not add EGM / `.squad/egm.json`.
- Do not auto-scan `docs/designs/`.
- Do not start consumer rollouts before the minor is cut and David approves each step.
