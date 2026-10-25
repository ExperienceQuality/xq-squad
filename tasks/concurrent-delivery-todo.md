# Concurrent Delivery — Task List

Status: **approved 2026-10-24 — all tasks done (T1–T12). Automated gate green (8/8 commands);
T12 real two-session Devin validation PASSED 2026-10-25** (see
`docs/devin-compatibility-report.md`). Full details and frozen interfaces:
[concurrent-delivery-plan.md](concurrent-delivery-plan.md). Approved spec:
[../docs/spec-concurrent-delivery.md](../docs/spec-concurrent-delivery.md).

Schedule: freeze contracts → [T1 ‖ T2 ‖ T3] → CP1 → T4 → T5 → CP2 → [T6 ‖ T7 ‖ T8] → CP3 →
T9 → T10 → T11 → T12.

## Tasks

1. [x] **T1 — Scope contract and schema** (M · owner A · deps: none) — DONE
   - Files: `distribution/.squad/scripts/delivery-scope.mjs`,
     `distribution/.squad/schemas/delivery-session.schema.json`, `tests/delivery-scope.test.mjs`
   - Verify: `node --test tests/delivery-scope.test.mjs`
   - Acceptance: literal file/tree/root scope + conflict cases frozen; symlink/future/rename path
     coverage; schema states/approval metadata/path bindings parse via Node builtins. No runtime
     writes to consumer. Status: done (20/20 focused tests green).

2. [x] **T2 — Registry transactions** (M · owner B · deps: frozen T1 contract; final verification
   waits for T1 artifacts) — DONE
   - Files: `distribution/.squad/scripts/delivery-registry.mjs`, `tests/delivery-registry.test.mjs`
   - Verify: `node --test tests/delivery-registry.test.mjs`
   - Acceptance: shared common-dir registry + read-only status; mutex/atomic replace, corrupt/crash
     fail-closed; zero mutations without approval; main+linked worktree same registry, no mutex
     steals. Implementation parallel from frozen contract; scope stub is not final-test evidence.
     Status: done (17 registry tests green, including final-review foreign-binding regression).

3. [x] **T3 — Workflow contract docs** (M · owner C · deps: none) — DONE
   - Files: `distribution/.squad/workflows/concurrent-delivery.md`,
     `distribution/.squad/workflows/delivery.md`,
     `distribution/.squad/workflows/parallel-execution.md`, `distribution/.squad/agents/lead.md`,
     `distribution/.devin/skills/squad-delivery/SKILL.md`
   - Verify: doc review vs. approved spec + `git diff --check` on the five paths
   - Acceptance: approval flow, opt-in no-bypass, no overlap override, stopped release, manual
     mutex recovery, child CWD, verifier ESM wrapper documented; no compatibility claims. A/B do
     not touch C files while in flight. Status: done (lead-authored; whitespace check clean).

   **CHECKPOINT 1** — lead contract/diff review; parser+registry focused tests; no
   usable-concurrency claim; user review if frozen contract changes.

4. [x] **T4 — Approved acquisition/provisioning** (M · owner D · deps: T1, T2)
   - Files: `distribution/.squad/scripts/delivery-session.mjs`, `tests/delivery-session.test.mjs`,
     `tests/fixtures/concurrent-session-worker.mjs`
   - Verify: `node --test tests/delivery-session.test.mjs`
   - Acceptance: CLI parser + status/acquire; PREPARING→provisioning→ACTIVE with preflight,
     resolvable base, helpers check; overlap acquire creates nothing; failure reservations
     retained; main bytes untouched. Status: done (29 session tests green after final review).

5. [x] **T5 — Lifecycle mutations** (M · owner D · deps: T4)
   - Files: `distribution/.squad/scripts/delivery-session.mjs`, `tests/delivery-session.test.mjs`
   - Verify: `node --test tests/delivery-session.test.mjs`
   - Acceptance: extend atomic/no-shrink; heartbeat ownership; resume/release as lost-token recovery
     transitions (deliveryId + expectedGeneration + approval + stoppedConfirmation) — resume rotates
     token/generation, release tombstones preserving work, stale expected generation BLOCKED
     OWNER_MISMATCH; manual mutex recovery only; tests cover lost-token recovery and
     one-winner simultaneous recoveries. Status: done (same 29-test session run).

   **CHECKPOINT 2** — two-process overlap one winner; disjoint both succeed; crash artifacts
   preserved; authority/ownership review. Lifecycle usable for downstream fixtures only.

6. [x] **T6 — Write verification** (M · owner E · deps: T5)
   - Files: `distribution/.squad/scripts/delivery-verify.mjs`, `tests/delivery-verify.test.mjs`
   - Verify: `node --test tests/delivery-verify.test.mjs`
   - Acceptance: snapshot bound to owner/generation/worktree/base; authored patch vs. target
     changes incl. untracked/deleted/renamed + ignored-outputs limitation; violations
     BLOCKED+preserve. Status: done (16 verifier tests green incl. index-only staged changes,
     in-scope deletions, gitlinks, `__proto__` keys; scope-gate mutation evidence captured, file
     restored byte-identical).

7. [x] **T7 — Delivery-memory seam** (M · owner F · deps: T5)
   - Files: `distribution/.squad/scripts/memory-search.mjs`, `tests/memory-search.test.mjs`,
     `distribution/.squad/workflows/memory-maintenance.md`,
     `distribution/.squad/agents/memory-maintainer.md`, `tests/memory-update.test.mjs`
   - Verify: `node --test tests/memory-search.test.mjs tests/memory-update.test.mjs`
   - Acceptance: repeatable `--source` validated, defaults unchanged; delivery-local outputs with
     honest UPDATED/canonical-pending reporting; no unclaimed shared writes, schema unchanged.
     Status: done — code seam complete (13/13 focused tests green incl. broken-symlink/EACCES
     fail-closed, NFC/case-folded `.git` rejection, strict `--budget` lexical validation);
     lead-authored prompt files untouched.

8. [x] **T8 — Two-process protocol fixture** (M · owner G · deps: T5; worker file handoff from D)
   - Files: `tests/concurrent-delivery.test.sh`,
     `tests/fixtures/concurrent-delivery-scenario.mjs` (test-only driver added),
     `tests/fixtures/concurrent-session-worker.mjs`
   - Verify: `bash tests/concurrent-delivery.test.sh`
   - Acceptance: barrier-based independent processes (no sleeps): overlap blocked, disjoint
     succeed, stale blocks, release preserves work, shared registry across linked roots; local Git
     only; claims protocol behavior, not real Devin. Status: done (scenario green; deterministic
     winner-recovery path — post-reservation BLOCKEDs resolved via simulated user resume, exactly
     one active claim asserted).

   **CHECKPOINT 3** — ownership non-overlap; combined focused node tests + shell fixture; no
   workflow contradicts memory rules; sequential integration.

9. [x] **T9 — Catalog/distribution wiring** (M · owner H · deps: T3, T6, T7, T8)
   - Files: `distribution/.squad/squad.json`, `scripts/validate.sh`, `tests/e2e.test.sh`,
     `tests/upgrade.test.sh` (narrow addition — consumer memory preservation + managed helpers)
   - Verify: `bash scripts/validate.sh`, `bash tests/e2e.test.sh`, `bash tests/upgrade.test.sh`
   - Acceptance: workflow/schema registered in existing catalog shape; managed wildcard covers
     `.mjs` modules; packaged helpers validated; targeted validate.sh change only. Status: done
     (all three green; lead-authored README/AGENTS left untouched).

10. [x] **T10 — Consumer guidance** (S · owner I · deps: T9)
    - Files: `README.md`, `CHANGELOG.md`, `docs/ideas/concurrent-delivery.md`
    - Verify: `git diff --check -- README.md CHANGELOG.md docs/ideas/concurrent-delivery.md`
    - Acceptance: approval/collision/stale/manual recovery + optional Node feature + limits
      documented; brainstorm marked superseded with spec link; Unreleased feature entry, no version
      bump. Status: done (whitespace clean; pending-validation caveat stated, not compatibility).

11. [x] **T11 — Final automated gate** (S · deps: T9, T10 · verification-only)
    - Files: none planned (verification only)
    - Verify: 8 commands once — the 7 CONTRIBUTING commands (glob covers new node tests) plus
      `bash tests/concurrent-delivery.test.sh`; per-command exit/result artifacts
    - Acceptance: all gates green or failures routed to owning slice; entire diff reviewed for
      security/correctness/authority; no commit/push/PR without user request. Status: done —
      all 8 commands exited 0 in one pass (logs `/tmp/xq-concurrent-final-*/`,
      node suite 90/90 before final-review hardening). After review fixes, 62 affected tests and
      installed-consumer e2e passed; the strengthened stat-cache regression passed separately.
      See the plan's final-review logs. No production compatibility claimed.

12. [x] **T12 — Actual Devin compatibility** (S · deps: T11) — DONE 2026-10-25
    - Files: `docs/devin-compatibility-report.md`
    - Verify: two real Devin sessions, user-authorized scenario (disjoint + overlap +
      stopped/release), artifacts collected
    - Acceptance: report records results. Status: done — two Devin CLI sessions
      (v3000.11.205, normal permissions) delivered `live-a`/`live-b` concurrently in
      `/tmp/xq-squad-live-validation-20261024`; overlap `live-c` blocked with
      SCOPE_CONFLICT; stale claim blocked until user-confirmed release; tombstone
      preserved branch/worktree/files; freed scope re-acquirable; main checkout
      untouched. Reports: `/tmp/xq-report-a.txt`, `/tmp/xq-report-b.txt`.
      Not exercised manually: `resume`, `extend`, `heartbeat`, mutex crash
      recovery, cloud sessions, subagent delegation (automated coverage exists).
      See `docs/devin-compatibility-report.md`.

**FINAL CHECKPOINT** — all spec criteria mapped to evidence; T11 green; T12 recorded or explicitly
blocked (feature not declared ready). Memory outcome `UNCHANGED` unless a durable store genuinely
exists.
