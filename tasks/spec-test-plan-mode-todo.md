# Spec Test Plan Mode — Task List

Status: **Draft planning only.** Feature remains **Draft**. EXECUTION waits on
**G0 = goldfish review + David Châu approval**. No `distribution/` work before G0.

Full contracts, requirement↔test map, and evidence tracker:
[spec-test-plan-mode-plan.md](spec-test-plan-mode-plan.md).

**Product design is not part of this PR.** The product owner merges the draft
design; these `tasks/` files are lead planning artifacts only.

Schedule: `G0 → [I1 ‖ I2] → CP1 → I3 → I4 → CP2 → I5 → CP3 → R1 → R2 → R3`.

## Tasks

1. [ ] **G0 — Design approval gate** (S · owner: David Châu + goldfish · deps: none)
   - Files: none in this repo for planning; product owner owns design merge.
   - Verify: written approval recorded; open questions in the plan answered or
     explicitly deferred with working assumptions kept.
   - Acceptance: EXECUTION unlocked. Status: blocked on review/approval.

2. [ ] **I1 — Tester contracts** (M · owner A · deps: G0) — parallel with I2
   - Files: `distribution/.squad/agents/tester.md`,
     `distribution/.cursor/agents/tester.md`
   - Verify: diff review vs frozen "Spec test plan mode" algorithm + report
     format; Cursor profile allows test-code edits only for named IDs.
   - Acceptance: R1–R4 rules present in both files; legacy no-path path
     unchanged; no invented-case language. Status: not started (waits G0).

3. [ ] **I2 — Lead / skill / workflow handoff** (M · owner B · deps: G0) — parallel
   with I1
   - Files: `distribution/.squad/agents/lead.md`,
     `distribution/.cursor/skills/squad-delivery/SKILL.md`,
     `distribution/.squad/workflows/delivery.md`
   - Verify: INTAKE records named path; VERIFICATION passes path to tester;
     `delivery.md` has one VERIFICATION line; stage graph unchanged.
   - Acceptance: path never invented; unset path keeps v2.0.0 VERIFICATION.
     Status: not started (waits G0).

   **CHECKPOINT 1** — lead contract/diff review of I1‖I2 vs frozen contracts;
   no version bump; no consumer-ready claim; resolve open questions that block
   wording.

4. [ ] **I3 — Fixtures + T-01 / T-07 automation** (M · owner C · deps: CP1)
   - Files: test fixtures under agreed location (open question); automation for
     T-01 (contract grep/assert on tester + lead) and T-07 (`update.sh` from
     v2.0.0, assert no `.squad-upstream` on clean install).
   - Verify: focused automation commands exit 0; evidence tracker rows T-01,
     T-07 updated from NOT RUN.
   - Acceptance: R1–R4 contract presence and R6 clean-upgrade path covered.
     Status: not started.

5. [ ] **I4 — Scenarios T-02…T-06** (M · owner D · deps: I3)
   - Files: scenario fixtures/drivers for usable 3-ID plan, unusable plan, bad
     path, unrunnable ID, and no-spec legacy output.
   - Verify: T-02…T-06 automation green; no extra invented rows on T-05; T-06
     matches v2.0.0 format.
   - Acceptance: R1–R5 integration coverage. Status: not started.

   **CHECKPOINT 2** — automated T-01…T-07 green or failures owned; evidence
   tracker updated; frozen report format confirmed.

6. [ ] **I5 — Version bump / packaging** (S · owner E · deps: CP2)
   - Files: `distribution/.squad/squad.json` (and release/changelog assets per
     repo convention); tag per David answer (open question: v2.1.0?).
   - Verify: packaging/validate gates; R5/R6 still hold after bump.
   - Acceptance: backward-compatible minor ready for CP3. Status: not started.

   **CHECKPOINT 3** — RC gate: contracts + automation + bump reviewed; ready
   for David-owned rollout.

7. [ ] **R1 — Ship minor** (S · owner: David · deps: CP3)
   - Files: release artifacts only as David directs.
   - Verify: published minor; consumers can upgrade.
   - Acceptance: backward compatible release live. Status: not started.

8. [ ] **R2 — Pilot xq-financial-app (T-08)** (M · owner: David · deps: R1)
   - Files: consumer pilot only (out of xq-squad code PR).
   - Verify: T-08 vs PAN spec; evidence recorded.
   - Acceptance: R1+R6 acceptance evidence. Status: not started.

9. [ ] **R3 — Platform / jewy / miniapp** (M · owner: David · deps: R2)
   - xq-platform (T-09), then xq-jewy.
   - xq-exercices-miniapp only after Prettier fix (`.prettierignore` excludes
     `.squad/` and `.cursor/`, 31 managed files restored).
   - Other consumers optional.
   - Verify: T-09 evidence; miniapp gate explicit.
   - Acceptance: rollout complete per David. Status: not started.

## Evidence tracker (mirror)

| Test | Status | Evidence |
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

## Open questions (block crisp G0 wording)

1. Next minor tag = `v2.1.0`?
2. Exact "usable plan" definition?
3. Confirm Cursor tester edit posture (test code only for named IDs)?
4. Where do T-01…T-09 evidence artifacts live?
