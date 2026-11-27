# Goldfish review

Required change review for every delivery. The reviewer runs in a **new, visible**
Cursor chat that David opens. It does not inherit the Lead's, implementer's, or
tester's conversation.

Precedent: spike #35 (`docs/spike-35-visible-reviewer-chat.md`). Decisions for
#36: no Task subagent, no side chat, no `agent create-chat`, no same-session
review, no Lead fallback as reviewer.

## When

After **Integration** (full diff known), before **Verification** completes the
delivery path. The Lead stops with status `BLOCKED` at review until a goldfish
result returns (or the user declines review).

## Lead obligations

1. Never delegate review to the `reviewer` Task subagent. The `.cursor/agents/reviewer.md`
   profile is retired; do not spawn or resume a reviewer subagent.
2. Never review in the session that produced the change. Never "embody" the
   reviewer role in the Lead chat.
3. Do not use Cursor side chats (`/side`, "Ask in Side Chat", Shift+Cmd+S /
   Shift+Ctrl+S) for review.
4. Build exactly one **paste-ready packet** (format below). Copy the full block
   to the user and instruct them to open a **new** Cursor chat, paste it as the
   first message, and run the review. Each delivery review requires a **new** chat;
   never resume an old reviewer chat.
5. If the user will not open the chat, report `BLOCKED` at review. Do not
   self-review or fall back to a subagent.
6. When the user pastes the review back, include it **verbatim** in the Delivery
   report. Do not edit findings or the overall verdict.

## Packet format

The packet is one markdown block. It must contain **only** these four sections
in this order, plus the opener line that activates the reviewer skill. No other
sections, commentary, or attachments inside the packet.

```markdown
<!-- XQ_SQUAD_GOLDFISH_REVIEW_PACKET -->
Use the `goldfish-review` skill. You are the goldfish reviewer only, not the Agent Lead.

### User request
<verbatim user request for this delivery>

### Acceptance criteria
<verbatim acceptance criteria>

### Diff
<unified diff, diff range, or explicit file list + revision refs the reviewer must read>

### Test commands
<commands the tester ran or should have run; no pass/fail narrative>
```

**Forbidden inside the packet:** implementer or tester notes, plans, commit
messages used as rationale, links to prior chats, "why this is correct"
explanations, subagent transcripts, or evidence that the implementer already
explained away a defect.

The Lead may attach paths for the reviewer to read via the repo, but the packet
body still lists only the four sections.

## Reviewer chat behavior

The new chat loads consumer `AGENTS.md` and `.cursor/rules/xq-squad.mdc`. The
`goldfish-review` skill overrides Lead identity for that session:

- Act only as the reviewer per `.squad/agents/reviewer.md`.
- Do not start intake, delivery, claims, worktrees, commits, pushes, or PRs.
- Read the diff and acceptance criteria from the packet; inspect the repository
  as needed to verify claims.
- Do not trust implementer or tester narrative that is not in the four packet
  fields.
- Prefer read-only work. The `xq-squad-git-guard` hook still applies if the
  reviewer attempts commits. Do not rely on Cursor Ask mode or CLI `--mode ask`
  as a write fence (see spike #35).

## Return format (user pastes back to Lead)

The reviewer ends with this structure (from `.squad/agents/reviewer.md`):

```markdown
## Findings
| Severity | Location | Issue | Fix |
|---|---|---|---|
| ... | ... | ... | ... |

## Review status
- Correctness: ...
- Tests verified: yes / no / partial
- Overall: approve / request changes / cannot complete
```

The Lead treats `request changes` or `cannot complete` like any other review
blocker before Delivery.