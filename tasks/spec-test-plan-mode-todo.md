# Spec test plan mode — Task List

Status: **draft intake — waiting on goldfish review + David Châu (G0) before
EXECUTION.**

Plan: [spec-test-plan-mode-plan.md](spec-test-plan-mode-plan.md)
Spec: [../docs/designs/tester-uses-spec-test-plan.md](../docs/designs/tester-uses-spec-test-plan.md)

Schedule: G0 → [I1 ‖ I2] → CP1 (T-01) → I3 (T-01, T-07) → I4 (T-02…T-06) → CP2 →
I5 → CP3 → R1 (T-08) → R2 (T-09) → R3 (deferred)

## Gates

- [ ] **G0** — Goldfish review + David approval; leave Draft; authorize EXECUTION

## Implementation

- [ ] **I1** — Tester contracts: `.squad/agents/tester.md` + `.cursor/agents/tester.md`
  - Spec test plan mode; BLOCKED paths; NOT RUN + reason; no invented cases
  - Cursor: test-code only for named IDs
  - Covers: T-01 / R1–R4
- [ ] **I2** — Lead + skill + workflow: record path at INTAKE; pass at VERIFICATION
  - Files: `lead.md`, `squad-delivery/SKILL.md`, `delivery.md` (one Verification line)
  - Covers: T-01 / R1–R4
- [ ] **CP1** — Contract review; T-01 assert green; no release claim
- [ ] **I3** — Fixtures + automated checks
  - Sample designs: 3-ID plan, empty plan
  - Contract assert (T-01); upgrade from v2.0.0 with no `.squad-upstream` (T-07 / R6)
- [ ] **I4** — Integration scenarios with observed evidence
  - [ ] T-02 — 3 IDs → 3 rows + evidence (R1)
  - [ ] T-03 — no usable plan → BLOCKED (R2)
  - [ ] T-04 — missing path → BLOCKED + named path (R3)
  - [ ] T-05 — unrunnable ID → NOT RUN + reason; no extras (R4)
  - [ ] T-06 — no path → v2.0.0 report shape (R5)
- [ ] **CP2** — T-01…T-07 PASS or David-accepted NOT RUN; validate.sh green
- [ ] **I5** — Minor bump (`squad.json` + CHANGELOG) + package validate
- [ ] **CP3** — David authorizes cut / publish of next minor

## Rollout (David approves each step)

- [ ] **R1 / T-08** — xq-financial-app pilot (PAN spec delivery) — R1, R6
- [ ] **R2 / T-09** — xq-platform upgrade + no-spec delivery; then xq-jewy — R5, R6
- [ ] **R3** — xq-exercices-miniapp only after Prettier ignore + managed-file restore

## Spec test IDs (evidence tracker)

| Test ID | Level | Req | Status | Evidence |
|---|---|---|---|---|
| T-01 | Contract | R1–R4 | NOT RUN | |
| T-02 | Integration | R1 | NOT RUN | |
| T-03 | Integration | R2 | NOT RUN | |
| T-04 | Integration | R3 | NOT RUN | |
| T-05 | Integration | R4 | NOT RUN | |
| T-06 | Integration | R5 | NOT RUN | |
| T-07 | Upgrade | R6 | NOT RUN | |
| T-08 | Acceptance | R1, R6 | NOT RUN | |
| T-09 | Regression | R5, R6 | NOT RUN | |
