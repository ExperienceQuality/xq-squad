# Devin Compatibility Report

## Concurrent delivery: manual gate PASSED (2026-10-25)

Two real Devin CLI sessions (v3000.11.205, interactive REPL, normal permission
mode, logged in via Devin account) ran concurrently against an authorized
consumer fixture at `/tmp/xq-squad-live-validation-20261024` — the packaged
squad v1.0.0 archive installed on a two-commit `main` base. Every setup,
release, and overlap attempt was explicitly approved by the user; no bypass
permission mode was used.

Observed:

- Session A (delivery `live-a`): invoked the `squad-delivery` skill itself,
  acquired claim (ACTIVE, generation 1), provisioned worktree
  `.squad/worktrees/live-a` on branch `squad/live-a`, captured a snapshot,
  wrote `src/a/live-a.txt` plus one schema-valid memory line, and passed
  `verifyDeliveryWrites`.
- Session B (delivery `live-b`): same lifecycle in parallel on
  `.squad/worktrees/live-b` / `squad/live-b`; verified writes, re-verified OK
  after `npm test` (1/1 pass per fixture AGENTS.md).
- Both sessions observed each other's claims via `status`; disjoint scopes
  (`src/a/` vs `src/b/`) acquired concurrently with no conflict.
- Main checkout stayed clean throughout: `git status --porcelain` empty, HEAD
  on `main` at the original commit.
- Overlap hard-block: session A attempted `live-c` with scope `src/b/` →
  `BLOCKED` / `SCOPE_CONFLICT` (exit 2) naming `src/b/` and
  `conflictingDeliveryId: live-b`. No claim, branch, or worktree created; no
  override attempted.
- Stale claim: session B's process was killed mid-claim; the identical
  `live-c` acquire still returned `BLOCKED`. No auto-expiry occurred.
- Release with approval + `stoppedConfirmation` → OK, generation 1 → 2
  tombstone. Verified after release: `squad/live-b` branch, worktree,
  `src/b/live-b.txt`, and `live-b.ndjson` all preserved.
- Post-release `live-c` acquire → OK (freed scope reusable), new worktree
  `.squad/worktrees/live-c` provisioned.
- Working-directory discipline: all writes ran with cwd inside the assigned
  worktree; the verifier bound to `worktreePath`.
- Delivery-local memory landed in distinct per-delivery `.ndjson` files inside
  each worktree.
- `devin doctor`: 3 pass, 1 warning (pre-login auth); `devin skills list`
  operational and `squad-delivery` was auto-invoked by session A.

Environment note: an `ACP_BACKEND` environment variable inherited from an
IDE-embedded session forces ACP mode, which intentionally ignores local CLI
credentials. The two validation sessions were launched with `env -u
ACP_BACKEND devin`; without that, `devin` reports "Not logged in" despite a
valid login.

Not exercised in the manual run (automated coverage exists): `resume`
token/generation rotation, `extend`/`heartbeat`, mutex crash recovery, scope
expansion mid-delivery, cloud Devin sessions, and subagent delegation inside a
concurrent delivery.

Automated evidence: all eight planned regression commands passed, including
90 Node tests. Subsequent final-review fixes passed all 62 affected
registry/session/verifier tests and the installed-consumer end-to-end check.
A strengthened metadata-preserving tracked-file regression passed separately.

## Tested surfaces

- Devin CLI / Desktop local session: custom subagent profiles, skills, and rules discovered from `.devin/`.
- `AGENTS.md` lazy-loaded as project rule.
- `squad-delivery` skill appears in available skills list.

## Evidence

- Extracted archive to `/tmp/xq-squad-test`.
- Devin loaded `AGENTS.md` as a lazy-loaded rule.
- Devin listed `squad-delivery` as an available skill.
- `devin doctor` frontmatter validation passes on extracted profiles (verified via docs and local file syntax).

## Simulated

- Actual subagent delegation was not executed in this session because the environment is the implementation workspace, not a consumer chat session.
- End-to-end delivery workflow was simulated through test scripts: install, upgrade, and sample consumer test.

## Unverified

- Cloud Devin sessions: project custom subagents are documented as CLI/Desktop only today.
- Background subagent permission behavior in a real consumer session.
- Memory maintenance in a real multi-turn Devin delivery.

## Recommendations

Before claiming full Devin integration, run a real consumer-repo Devin session:

1. Install squad into a sample repository.
2. Start Devin and confirm `AGENTS.md` loads.
3. Ask Devin to perform a small task.
4. Verify Lead uses `squad-delivery` skill or direct workflow.
5. Verify profiles are selectable and results return to Lead.
6. Disable subagents and verify sequential fallback.
