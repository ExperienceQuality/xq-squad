# Spike #35: Can the Agent Lead open a visible, fresh reviewer chat?

**Date:** 2026-11-25  
**Issue:** [#35](https://github.com/ExperienceQuality/xq-squad/issues/35)  
**CLI version:** `2026.11.22-e9042b2`  
**Account:** logged in (`agent status`)  
**No product contract changes** in this spike.

## Goal

Find whether the Agent Lead can start the reviewer in a **new, empty, visible** Cursor chat (not a Task subagent, not a side chat), as groundwork for the goldfish reviewer story.

## Verdict

**No.** Today the Lead cannot open a chat that is both (1) empty of Lead/implementer/tester history and (2) visible in David's Cursor Agents sidebar / editor tabs.

`agent create-chat` + `agent --resume <id> -p` creates a real, empty CLI session, but it lives in the CLI chat store and does **not** show up in the IDE conversation index. There is still no documented agent API to open a visible editor chat tab ([forum request](https://forum.cursor.com/t/agent-spawned-side-sessions-parallel-tasks-in-a-new-chat-tab-with-fresh-context-optional-worktree/163000), [earlier request](https://forum.cursor.com/t/agent-initiated-new-chat-open-as-new-tab/137339)).

## Answers

### 1. Does a chat from `agent create-chat` + `-p` appear in the Agents sidebar / editor so David can open and read it?

**No** (evidence below; IDE screenshot pending Accessibility / Screen Recording for Computer Use).

Evidence:

| Check | Result |
|---|---|
| Chat created | `f1fc0cf5-9ea3-437c-b5b6-443d745ade3a` (`agent create-chat`) |
| CLI store path | `~/.cursor/chats/7509625802f1414add772c020aa268af/f1fc0cf5-9ea3-437c-b5b6-443d745ade3a/` |
| Meta name | `"New Agent"` |
| Byte search under `~/Library/Application Support/Cursor` for that chat id | **0 hits** |
| Cursor `SearchConversations` for `SPIKE35`, `"New Agent"`, `f1fc0cf5` | **no matching conversations** |
| `cursor-app-control` tools | `rename_chat` / `open_resource` only; **no open-chat-by-id** |

Commands:

```bash
CHAT_ID=$(agent create-chat)
# -> f1fc0cf5-9ea3-437c-b5b6-443d745ade3a
agent --resume "$CHAT_ID" -p --mode ask --trust --workspace /Users/davidchau/Documents/repo/xq-squad \
  "SPIKE35 PROBE. ..."
```

Third-party write-ups also treat CLI chats and editor Agents-window chats as **separate stores**.

### 2. Does that chat start with no Lead / implementer / tester history?

**Yes** for parent conversation history.

The first resumed turn had no prior issue-#35 / Lead / implementer / tester transcript. Probe field `PARENT_HISTORY: no`. Blob dump of the CLI store shows only the system CLI preamble, workspace envelope, and the SPIKE35 probes — not this Lead session's history.

### 3. Do always-on `AGENTS.md` and `xq-squad.mdc` turn it into a second Agent Lead? What minimal reviewer-only entry path would prevent that?

**Yes in a consumer-shaped workspace.** Root `AGENTS.md` + `.cursor/rules/xq-squad.mdc` are injected into a fresh CLI chat and the model adopts Agent Lead.

| Workspace | Injected? | Evidence |
|---|---|---|
| `xq-squad` repo root (no root `AGENTS.md`; rule lives under `distribution/`) | Lead contract **not** in context | Blob search: `Agent Lead` / `XQ Squad` absent from the large user envelope |
| Temp consumer root with copied `AGENTS.md` + `xq-squad.mdc` | **Yes** | Chat `271272d4-47aa-46eb-98d1-93b76e1e251a`; store blob contains `You are the **Agent Lead** for this repository...` |

Self-report from the first probe (`AGENTS_MD_PRESENT: yes`) was **wrong** when checked against the store. Prefer store / prompt inspection over the model's claim.

**Minimal reviewer-only entry path (recommendation for the later story, not shipped here):**

1. Do not start the reviewer via a default workspace that loads Lead `AGENTS.md` / always-on Lead `xq-squad.mdc` as the session identity.
2. Prefer a reviewer-only seed: dedicated rule or skill that says "you are the reviewer only; do not run delivery / Lead workflow", activated by an explicit prompt prefix or a reviewer-only workspace overlay.
3. Or keep the reviewer as a Cursor subagent with `readonly: true` and a reviewer system prompt (current shape) — clean context, but not a new visible tab.

### 4. Does `--mode ask` keep it read-only (no writes, no claims, no delivery start)?

**No — not a reliable write fence.**

Docs describe `ask` as Q&A / read-only. In this session:

1. First probe answered `CAN_WRITE: no`.
2. Follow-up asked the agent to create `/tmp/xq-spike35-ask-write-should-fail.txt`.
3. The Write tool **succeeded**; file exists with contents `SPIKE35`.

So `--mode ask` must not be treated as the goldfish reviewer's isolation boundary. Use `readonly` subagents, hooks, or explicit deny rules if writes must be blocked.

### 5. What happens when the CLI is missing, unauthenticated, or headless is disabled?

| Condition | Observed / documented |
|---|---|
| `agent` not on `PATH` | `command not found: agent` — Lead cannot create or resume chats |
| Invalid `--api-key` on `create-chat` | Still printed a new chat id (local id allocation); auth is not required to mint an id |
| Invalid `--api-key` on `--resume … -p` | Warning: `The provided API key is invalid.` — run does not proceed as a normal authenticated session |
| Team policy **Disable CLI headless mode** | Documented: `agent -p` / `--print` exits with an error before sending the prompt; interactive CLI still works ([headless docs](https://cursor.com/docs/cli/headless)) — not reproduced against a team that has the flag on |
| `--force` / Run Everything disabled by team | Documented: `--force` exits with an error when team admin disables Run Everything |

### 6. Any other documented way for the Lead to start a visible fresh chat?

**No documented, agent-callable way today.**

| Mechanism | Visible editor tab? | Fresh (no parent history)? | Agent-started? |
|---|---|---|---|
| Task / `.cursor/agents/reviewer` subagent | No (sub-session of parent) | Yes (clean context window) | Yes |
| Side chat (`/side`) | Yes | **No** — parent history is hidden model context ([docs](https://cursor.com/help/ai-features/side-chats)) | User-initiated from parent |
| Fork chat | Yes | No (copies parent) | User |
| Manual New Chat | Yes | Yes | **User**, not Lead |
| `agent create-chat` + `--resume -p` | No (CLI store only) | Yes | Yes |
| Cloud Agents | Separate UI | Yes | Yes, but not the local Agents sidebar tab David asked for |
| Forum "spawn side session" / "open as new tab" | Desired | Desired | **Not shipped** |

`cursor-app-control` in this environment exposes `rename_chat`, `open_resource`, workspace moves — not "create and focus a new Agents tab".

## Recommendation for the goldfish reviewer story

1. **Do not build goldfish on `agent create-chat` for David's visibility requirement.** It gives a fresh CLI session and printable transcript, not an Agents-sidebar chat he can click.
2. **If visibility is mandatory:** the Lead should hand David a one-line seed (reviewer skill / prompt) and ask him to open a **manual New Chat**, paste/run it. That is the only path that is empty + visible today. Pair it with a reviewer-only entry (skill or non-Lead rule) so `AGENTS.md` / `xq-squad.mdc` do not re-promote him to Agent Lead.
3. **If automation beats visibility:** keep the existing readonly `reviewer` subagent (clean context, Lead-delegated). Accept that it stays nested under the Lead chat.
4. **Do not use side chats** for goldfish: hidden parent history violates the goldfish constraint.
5. **Do not rely on `--mode ask` as a write lock.**
6. Track Cursor product gaps (agent-opened visible tab with fresh context). Until that ships, product contracts should not promise Lead-spawned visible reviewer tabs.

## Evidence appendix

### Chat ids

- Source-repo probe: `f1fc0cf5-9ea3-437c-b5b6-443d745ade3a`
- Consumer-shaped probe: `271272d4-47aa-46eb-98d1-93b76e1e251a`

### Commands run (summary)

```bash
agent --version   # via agent about
agent status
agent create-chat
agent --resume <id> -p --mode ask --trust "SPIKE35 PROBE..."
agent --resume <id> -p --mode ask --trust "SPIKE35 WRITE TEST..."
PATH=/usr/bin:/bin agent create-chat          # missing binary
agent --api-key invalid-key --resume <id> -p --mode ask --trust "ping"
# consumer temp root with AGENTS.md + xq-squad.mdc:
agent create-chat && agent --resume <id> -p --mode ask --trust --workspace <tmp> "SPIKE35 CONSUMER PROBE..."
```

### Screenshot status

Computer Use required Accessibility + Screen Recording; both were denied in this session (`ax=false`, `screenRecording=false`). David should confirm once that Agents sidebar / conversation search does not list `New Agent` / `f1fc0cf5…`, matching `SearchConversations` and Application Support scans above.

## Acceptance criteria checklist

- [x] Q1–Q6 answered yes/no with evidence (commands, chat ids, store paths, SearchConversations). Screenshot of Agents sidebar still needs David's one-time visual confirm or Computer Use permissions.
- [x] Written recommendation: visible agent-started chat not available; use manual New Chat + reviewer-only seed, or keep readonly subagent.
- [x] No product contract changes shipped from this spike.
