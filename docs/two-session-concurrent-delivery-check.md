# Real two-session Cursor check (concurrent delivery)

Manual release check for changes that touch the **concurrent-delivery** protocol. Implements [ExperienceQuality/xq-squad#30](https://github.com/ExperienceQuality/xq-squad/issues/30).

This does **not** replace `tests/concurrent-delivery.test.sh` (protocol fixture in CI). It covers real Cursor Agent sessions, which the shell fixture and the old Devin CLI evidence do not.

Draft [PR #16](https://github.com/ExperienceQuality/xq-squad/pull/16) (Spike-0 hook probe) stays open and unmerged; this procedure does not close, merge, or change that PR.

## When it is required

| Change type | Required? |
| --- | --- |
| Concurrent-delivery contracts, workflows, hooks, or `.squad/scripts/delivery-*.mjs` / worktree/registry helpers | **Yes** — attach a pass report before calling the release (or protocol PR) done |
| Unrelated work (e.g. new optional skill, docs-only, typo) | **No** |

## Prerequisites

- Cursor desktop (or Cloud Agent) with Agent mode available
- Node.js 22+
- Git 2.36+ (worktrees)
- A clean throwaway **consumer-style** checkout (sample fixture or a dedicated scratch repo), not the xq-squad source tree as the delivery target

## Procedure

### 1. Prepare the consumer repo

```bash
# Example: install current main/distribution or a release into a scratch repo
mkdir -p /tmp/xq-concurrent-check && cd /tmp/xq-concurrent-check
git init
# Install squad (pick one):
#   bash /path/to/xq-squad/install.sh --target . --version vX.Y.Z
#   or copy from a packaged release
git add -A && git commit -m "chore: baseline for two-session check"
```

Confirm `.squad/workflows/concurrent-delivery.md` and delivery helpers are present.

### 2. Open two Cursor Agent sessions

In the **same** consumer repo root:

1. **Session A** — start a concurrent delivery for a small, isolated change (e.g. add `docs/session-a.md`). Follow the concurrent-delivery workflow: setup approval, worktree, scope claim.
2. **Session B** — in a second Agent chat/window on the same repo, start a **disjoint** delivery (e.g. add `docs/session-b.md`). It must not write Session A’s paths.

Do not use a single session with two tasks as a substitute.

### 3. Pass criteria

Record **pass** only if all of the following hold:

- [ ] Session B cannot take Session A’s claimed paths (blocked or redirected per workflow)
- [ ] Each session’s worktree / claim is visible via the delivery helpers (`status` / registry as documented)
- [ ] Both sessions can complete their disjoint changes without corrupting each other’s trees
- [ ] `xq-squad-git-guard` (or documented approval) still governs commit/push/PR if exercised
- [ ] No unexplained unlock/release of the other session’s claim

Record **fail** if claims are ignored, worktrees collide destructively, or a session writes outside its claim without a hard block.

### 4. Report

Attach a short report to the protocol PR or release PR:

```markdown
## Two-session concurrent-delivery check

- Date (Asia/Saigon):
- Squad version / commit under test:
- Consumer repo path:
- Session A summary:
- Session B summary:
- Result: pass | fail
- Evidence (logs, screenshots, or command output):
- Operator:
```

Keep logs small; redact secrets. One successful run of this procedure satisfies the “run once” bar for the current protocol shape; re-run when the protocol surface changes again.

## Related

- Fixture: `tests/concurrent-delivery.test.sh`
- Workflow: `distribution/.squad/workflows/concurrent-delivery.md`
- Release playbook: [`docs/release-process.md`](release-process.md)
