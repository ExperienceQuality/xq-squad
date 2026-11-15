# Goldfish draft review 1: tester-spec-test-plan.md

- Gate: draft review (EGM feature-spec standard)
- Reviewer: fresh, context-free reviewer; read only the spec, referenced source files at main, and EGM README / feature-spec-standard / egm-review skill
- Date: 2026-11-15
- Verdict: NOT CLEAN (2 Blocker, 9 Major, 4 Minor, 1 Nit)

| ID | Severity | Section | Finding (short) | Status |
|---|---|---|---|---|
| F1 | Blocker | whole spec | No Alternatives section; auto-discovery rejection has no reason. Consider: auto-lookup, Lead maps test IDs to acceptance criteria, separate spec-verifier profile, implementer writes spec tests and tester only runs them | Open |
| F2 | Blocker | §2 files, R5 | Tester write permission not scoped to spec mode; "test code" undefined; canonical vs Cursor tester conflict unresolved | Open |
| F3 | Major | §2 step 4, R4, T-05 | "No extra cases" vs repo checks: say repo checks still run under their own section; no non-spec test code | Open |
| F4 | Major | §2 steps 1-2, R2/R3 | "Usable test plan" undefined; needs a mechanical check (heading, Test ID + Level columns, >=1 row, duplicates, partial rows) | Open |
| F5 | Major | §2 spec path | Trigger for "naming" a spec undefined; multiple paths, out-of-repo paths, spec not in delivery worktree | Open |
| F6 | Major | §2 compat | Mixed versions (new lead.md, conflicted old tester.md) fail silently; Lead should verify the spec section in the tester result; cover Lead-only fallback | Open |
| F7 | Major | §2 report | Status vocabulary clashes with v2.0.0 (passed/failed/skipped, OK/BLOCKED/FAILED); where BLOCKED goes; evidence = command + output summary | Open |
| F8 | Major | §2 Lead/workflow | DELIVERY report not updated; spec IDs vs INTAKE acceptance criteria; squad-delivery skill delegates tester in Execution | Open |
| F9 | Major | §3 traceability | Missing requirements/tests for Lead path pass-through, tester write scope, report format, no auto-pickup; T-01 not mechanical and misses 2 files | Open |
| F10 | Major | §3 method | LLM behavior tests need defined sample repo, runtimes, run count, baseline; R5 "matches v2.0.0" untestable as written | Open |
| F11 | Major | §3 edge cases | Missing tests: empty plan, duplicate IDs, FAIL rows, failing added tests, out-of-scope writes, tester editing spec, multiple/outside paths, mixed versions, Lead fallback, worktree | Open |
| F12 | Major | §2 compat, R6, T-07 | Upgrade test weak (exit code, install-state version, other files); baseline tag vs main unstated; other upgrade sources | Open |
| F13 | Major | §4 rollout | No release gate, stop rule or rollback; xq-jewy untested; PAN spec unnamed; FAIL ignored in close rule | Open |
| F14 | Minor | §4 risks | Missing: self-graded tests, bulk NOT RUN for manual levels, spec as untrusted command input, scope claims, F6 | Open |
| F15 | Minor | §2 steps 1-2 | Stop semantics inconsistent; effect on repo checks and workflow state | Open |
| F16 | Nit | header/wording | Owner should be a person; pin version; level glossary; restore source for miniapp files | Open |
