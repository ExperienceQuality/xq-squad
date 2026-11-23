# Two-session concurrent-delivery check

- **Date (Asia/Saigon):** 2026-11-23, ~23:27–23:28
- **Squad version / commit under test:** v2.1.0 distribution packaged from `main` @ `652b666d53c7f1e599ea755886018a0e34798b9a` (post #33)
- **Consumer repo path:** `/tmp/xq-concurrent-check` (scratch install via `install.sh --archive` of packaged `squad-v2.1.0.tar.gz`)
- **Procedure:** [`docs/two-session-concurrent-delivery-check.md`](two-session-concurrent-delivery-check.md)
- **Operator:** Agent Lead (Cloud Agent), with Release Manager setup approval recorded as `lead-approval-session-{a,b}-2026-11-23-xq-30`
- **Sessions:** two independent Cursor Agent sessions (not a single dual-task chat)
  - Session A agent id: `bc-f54228fb-2fad-5e3c-a54a-7801e12ed05e`
  - Session B agent id: `bc-128e0c18-32e5-5bf5-9f3b-259cb0f16d78`
- **Result:** **pass**
- **Draft PR #16:** left open and unmerged (unchanged)

## Session A summary

- Acquired `session-a` with scope `docs/session-a.md` (+ delivery memory paths).
- Worktree: `.squad/worktrees/session-a` on branch `squad/session-a`.
- Wrote and committed `docs/session-a.md` (`session-a was here`) as `9cef7eac258248db769e5b2c7e1ec5bbb21fffb0`.
- Heartbeat OK; release → `RELEASED` generation 2.
- Did not touch Session B paths.

## Session B summary

- After a short wait, status showed Session A **ACTIVE**.
- **Overlap probe** (`session-b-overlap` claiming `docs/session-a.md`): **BLOCKED** `SCOPE_CONFLICT` / overlaps claim `session-a` (exit 2). No worktree created.
- Disjoint acquire `session-b` with scope `docs/session-b.md`: **OK**.
- Worktree: `.squad/worktrees/session-b` on branch `squad/session-b`.
- Wrote and committed `docs/session-b.md` (`session-b was here`) as `c3fed84dca5fce39695b40532c7268a6f58b47e2`.
- Heartbeat OK; release → `RELEASED` generation 2.
- Did not write `docs/session-a.md`.

## Pass criteria

| Criterion | Result |
| --- | --- |
| Session B cannot take Session A’s claimed paths | **pass** — `SCOPE_CONFLICT` on overlap probe |
| Each session’s worktree / claim visible via delivery helpers | **pass** — `status` listed both claims; worktrees on distinct branches |
| Both sessions complete disjoint changes without corrupting each other’s trees | **pass** — each worktree has only its own `docs/session-*.md` |
| `xq-squad-git-guard` (or documented approval) governs commit/push/PR if exercised | **not exercised** — commits stayed local in worktrees; no push/PR attempted |
| No unexplained unlock/release of the other session’s claim | **pass** — each session released only its own delivery |

## Evidence (command output excerpts)

Overlap probe (Session B):

```json
{"status":"BLOCKED","code":"SCOPE_CONFLICT","message":"overlaps claim session-a",
 "conflicts":[{"left":"docs/session-a.md","right":"docs/session-a.md"}],
 "conflictingDeliveryId":"session-a"}
```

Final registry status (both `RELEASED`, generation 2):

```json
{"status":"OK","code":"OK","records":[
  {"deliveryId":"session-a","generation":2,"state":"RELEASED","branch":"squad/session-a",
   "worktreePath":"/tmp/xq-concurrent-check/.squad/worktrees/session-a",
   "scope":[".squad/memory/deliveries/.session-a.ndjson.tmp",".squad/memory/deliveries/session-a.ndjson","docs/session-a.md"]},
  {"deliveryId":"session-b","generation":2,"state":"RELEASED","branch":"squad/session-b",
   "worktreePath":"/tmp/xq-concurrent-check/.squad/worktrees/session-b",
   "scope":[".squad/memory/deliveries/.session-b.ndjson.tmp",".squad/memory/deliveries/session-b.ndjson","docs/session-b.md"]}
]}
```

Owner tokens were used for heartbeat/release and are **not** copied into this report.

## Notes

- This run satisfies the “run once successfully” bar for the current concurrent-delivery protocol shape on Cursor Agent sessions.
- Re-run when contracts, hooks, or delivery registry/worktree helpers change again.
- Shell fixture `tests/concurrent-delivery.test.sh` remains the CI protocol check; this report does not replace it.
