# Spike-0: Cursor hook probe

Throwaway kit for recording what Cursor really sends to hooks and what it does
with each response. Do not merge; nothing here ships in `distribution/`.

| File | Purpose |
|---|---|
| `probe.mjs` | One hook script for every event. Logs the call, replies from `~/xq-probe/script.json`. |
| `hooks.json` | Registers `probe.mjs` for all 13 Spike-0 events. |
| `make-test-repo.sh` | Builds the scratch repo used by the experiments. |
| `lock-proto.mjs`, `lock-stress.sh` | Ledger append protocol prototype and its stress run. |
| `hook-opts.mjs` | Switches `hooks.json` options per experiment; installs a user-level probe. |
| `summarize.mjs` | One line per logged hook call. |
| `*.test.mjs` | `node --test spike/*.test.mjs` |

Requirements: Node ≥ 22 on `PATH` (Cursor runs hooks with your login `PATH`),
git ≥ 2.31. No npm packages, no network calls (the probe runs git with a 2 s timeout, SPEC §6.11).

## Install

Fastest: `bash spike/make-test-repo.sh ~/xq-probe-repo` (see below). By hand,
in any repo:

```sh
mkdir -p .cursor/xq-probe
cp <xq-squad>/spike/probe.mjs .cursor/xq-probe/probe.mjs
cp <xq-squad>/spike/hooks.json .cursor/hooks.json
```

Open the repo in Cursor and check **Settings → Hooks** (or the *Hooks* output
channel) lists 13 hooks. Each entry runs `node .cursor/xq-probe/probe.mjs <event>`.

## What gets logged

Each call appends one JSON line to `~/xq-probe/<YYYY-MM-DD>.ndjson` (local date):

| Field | Content |
|---|---|
| `event`, `argvEvent` | Event name (from argv, else `hook_event_name`). |
| `source` | Second argv: `project` (default) or `user` (user-level `hooks.json`). |
| `stdinFormat`, `stdin` | `json` + parsed object, or `raw` + the exact string. |
| `stdinSha256`, `promptSha256` | SHA-256 of the raw stdin and of `stdin.prompt`, before redaction. |
| `env` | Only `CURSOR_*`, `XQ_*`, `PATH`, `HOME`, `PWD`. |
| `cwd`, `platform`, `node`, `pid`, `ppid` | Process facts. |
| `git` | `<C>` = `git rev-parse --path-format=absolute --git-common-dir` run in the project dir (`CURSOR_PROJECT_DIR`, else `workspace_roots[0]`, else cwd), whether a file can really be written there, and (only if `<C>/xq-probe-ledger` exists) the result of appending a `probe.event` record to `<C>/squad/enforce/ledger/<conversation_id>.ndjson`. |
| `script` | Matched rule index, mode, and the response sent. |
| `hrtimeStart`/`hrtimeEnd`, `wallStart`/`wallEnd` | `process.hrtime.bigint()` (as a string) and ISO time. |

Secrets matching the SPEC §9.6 patterns (GitHub/OpenAI/Stripe/Slack/AWS/
Google/npm/GitLab tokens, JWTs, private keys, `Bearer …`, `password=…`,
`user:pass@` URLs, `mysql -p…`) are replaced by `[REDACTED]` anywhere in the line. Payloads still
contain file paths, prompts and your email: do not publish raw logs.

## Scripting responses: `~/xq-probe/script.json`

```json
{
  "preToolUse": { "match": { "tool_name": "Write" }, "respond": { "permission": "deny", "agent_message": "probe-deny" } },
  "beforeShellExecution": [
    { "match": { "command": { "regex": "^git\\s+push" } }, "respond": { "permission": "ask" } },
    { "mode": "sleep:5000" }
  ]
}
```

- Key = event, or `<event>@user` / `<event>@project` to answer one source
  only (used instead of the plain key when present). Value = one rule or a
  list; the first matching rule wins.
- `match`: every key must match the stdin JSON. Dotted keys reach nested
  fields (`tool_input.command`). A value is compared exactly, or
  `{ "regex": "…" }` is tested against the string form. The key `"*"` tests
  the whole stdin JSON text (handy when the field name is not known yet).
- `respond`: the JSON object to print. Without it, or with no matching rule,
  the probe prints the neutral response.
- `mode`: optional failure mode (below).
- The file is re-read on every call, so edit it between runs; no restart.

Neutral responses:

| Event | Response |
|---|---|
| `beforeShellExecution`, `beforeMCPExecution`, `preToolUse`, `subagentStart` | `{"permission":"allow"}` |
| `beforeSubmitPrompt` | `{"continue":true}` |
| `sessionStart`, `sessionEnd`, `postToolUse`, `postToolUseFailure`, `afterFileEdit`, `afterShellExecution`, `subagentStop`, `stop` | `{}` |

## Failure modes

The log line is always written first (after the sleep for `sleep:`).

| `mode` | stdout | exit |
|---|---|---|
| *(none)* | `respond` (or neutral) as one JSON line | 0 |
| `crash` | nothing; uncaught `Error: probe-crash` on stderr | 1 |
| `sleep:<ms>` | `respond` after `<ms>` ms (use > the hook `timeout` to test timeouts) | 0 |
| `exit:<n>` | `respond` | `<n>` (`exit:2` = Cursor's "block") |
| `stdout:<text>` | `<text>` verbatim, no newline | 0 |
| `nostdout` | nothing | 0 |
| `invalidjson` | `{"permission": ` (truncated JSON) | 0 |

## Scratch repo: `make-test-repo.sh`

```sh
bash spike/make-test-repo.sh ~/xq-probe-repo
```

Creates (re-running is safe and changes nothing):

- a git repo on `main` with 10,000 small files under `files/d00..d99/`;
- the probe installed at `.cursor/hooks.json` + `.cursor/xq-probe/{probe,lock-proto}.mjs`, committed,
  plus the `<C>/xq-probe-ledger` marker (probe appends to the ledger, E-07);
- `notebook.ipynb` (E-03 notebook edit);
- a linked worktree at `<dir>.worktrees/linked wt` (path with a space), branch `probe-linked`;
- a delivery worktree at `.squad/worktrees/probe-delivery`, branch `squad/probe-delivery`;
- `<C>/squad/run/probe-delivery.json`: one `ACTIVE` claim, `schemaVersion: 1`,
  scope `files/d00/`, checked with the real `delivery-registry.mjs` reader.

### Throwaway GitHub remote

Use only the throwaway repo David provides, never a real one:

```sh
cd ~/xq-probe-repo
git remote add origin https://github.com/<owner>/<throwaway-repo>.git
git push -u origin main probe-linked squad/probe-delivery
```

### GitHub MCP server

Add to `~/xq-probe-repo/.cursor/mcp.json` (project scope), with a
fine-grained token limited to the throwaway repo:

```json
{
  "mcpServers": {
    "github": {
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": { "Authorization": "Bearer ${env:GITHUB_PERSONAL_ACCESS_TOKEN}" }
    }
  }
}
```

Restart Cursor, check **Settings → MCP** shows `github` connected.

## Experiments (SPEC §19.2; S0-T4, run by David)

Spike-0 scope is **E-02, E-03, E-04, E-05, E-07** in the Cursor IDE on macOS
and **E-10-lite** in one cloud agent. E-01 happens implicitly; E-06, E-08 and
E-09 are optional (run E-09 if time allows: it can block the release).
N = 10 unless the row says otherwise (SPEC §19.1).

### Common procedure

```sh
R=~/xq-probe-repo                                  # the scratch repo
bash spike/make-test-repo.sh "$R"                   # once; re-run any time (idempotent)
mkdir -p ~/xq-probe/archive
xqstart() { mv ~/xq-probe/*-*-*.ndjson ~/xq-probe/archive/ 2>/dev/null; printf '%s\n' "$1" > ~/xq-probe/script.json; }
xqsave()  { mv ~/xq-probe/$(date +%F).ndjson ~/xq-probe/"$1".ndjson && node spike/summarize.mjs ~/xq-probe/"$1".ndjson; }
```

1. Record the Cursor version (*Cursor → About Cursor*) and `sw_vers -productVersion` once per day.
2. `xqstart '<script.json from the row>'` (use `xqstart '{}'` for neutral). The
   probe re-reads `script.json` on every call; no reload needed.
3. Run each prompt in a **new Agent chat** (⌘N), so a denial is not remembered
   by the agent. Replace `N` in the prompt with the run number 1..10.
4. Check the side effect named in the row (it decides pass/fail; the agent's
   own claims do not count).
5. `xqsave E-02a` (etc.) and fill in the results table at the end.
6. If you changed `.cursor/hooks.json`, put it back: `node spike/hook-opts.mjs "$R" --reset`.

Helpers: `node spike/summarize.mjs <log> [--grep re] [--json]` prints one line
per hook call (event, tool name, target, ids, exit/interrupt fields, response,
`<C>` writable + ledger seq, duration). `node spike/hook-opts.mjs` edits
`hooks.json` options (`failClosed`, `timeout`, `matcher`, `loop_limit`) and
installs a user-level copy of the probe (source `user`, for E-06/E-09).

### E-01 Load and identity (implicit)

- First chat of the day: `summarize` shows `sessionStart` with `conversation_id`
  (and `generation_id`, `model`, `cursor_version` if sent); later events carry the same `conversation_id`.
- Reload without restart: delete the `afterFileEdit` entry from
  `$R/.cursor/hooks.json`, save, ask *"Append the line probe-e01 to README.md"*,
  check no `afterFileEdit` line appears; `--reset`, repeat, check it appears again.
- Subagent: *"Use a subagent to count the files in files/d00 and report the number."*
  Check `subagentStart`/`subagentStop` and whether the subagent's tool calls carry
  their own `conversation_id` and a `parent_conversation_id`.
- Pass: all ids present; reload works. Fail ⇒ nothing loads: release blocked;
  subagent not linkable: session-family heuristic, R-04 partial.

### E-02 Permission semantics

Run E-03 first if you do not yet know the Shell and write tool names; the
`"*"` matcher below works without knowing them.

| Run | `script.json` | Prompt (new chat each run) | Pass |
|---|---|---|---|
| a. deny on `beforeShellExecution` only | `{"beforeShellExecution":{"match":{"command":{"regex":"probe-a"}},"respond":{"permission":"deny","user_message":"probe-deny-bse","agent_message":"probe-deny-bse"}}}` | Run exactly this shell command and nothing else: `touch probe-a-N.txt` | `ls $R/probe-a-*` empty 10/10 |
| b. deny on `preToolUse` (Shell) only | `{"preToolUse":{"match":{"*":{"regex":"probe-b"}},"respond":{"permission":"deny","user_message":"probe-deny-ptu","agent_message":"probe-deny-ptu"}}}` | Run exactly this shell command and nothing else: `touch probe-b-N.txt` | `ls $R/probe-b-*` empty 10/10 |
| c. both deny (order/overlap) | `{"beforeShellExecution":{"match":{"command":{"regex":"probe-c"}},"respond":{"permission":"deny","agent_message":"probe-deny-bse"}},"preToolUse":{"match":{"*":{"regex":"probe-c"}},"respond":{"permission":"deny","agent_message":"probe-deny-ptu"}}}` | Run exactly this shell command and nothing else: `touch probe-c-N.txt` | Record: which hook fires first (`hrtimeStart`), whether the second still fires, which message the agent sees |
| d1. deny a write tool | `{"preToolUse":{"match":{"*":{"regex":"probe-d"}},"respond":{"permission":"deny","agent_message":"probe-deny-write"}}}` | Create a file named probe-d-N.txt containing hello. Use your file editing tool, not the shell. | `ls $R/probe-d-*` empty 10/10 |
| d2. deny MCP on `beforeMCPExecution` only | `{"beforeMCPExecution":{"match":{"*":{"regex":"probe-d-mcp"}},"respond":{"permission":"deny","agent_message":"probe-deny-mcp"}}}` | Using the GitHub MCP server, create an issue in `<THROWAWAY_REPO>` titled probe-d-mcp-N. | No such issue on GitHub 10/10 |
| d3. deny MCP on `preToolUse` only | `{"preToolUse":{"match":{"*":{"regex":"probe-d-mcp"}},"respond":{"permission":"deny","agent_message":"probe-deny-mcp"}}}` | same as d2 | same as d2 (d2 vs d3 answers whether `beforeMCPExecution` adds anything) |
| e. `failClosed: true` | per mode below | Create a file named probe-e-`<mode>`-N.txt containing hello. Use your file editing tool. | Blocked 10/10 per mode |
| f. `failClosed: false` | per mode below | same as e | Record allow/block per mode |
| g. negative-lookahead matcher | `{}` | Read files/d00/f0.txt, then create probe-g-N.txt containing hello. | No `preToolUse` line for the read tool; one for the write |

E-02 e/f setup and modes:

```sh
node spike/hook-opts.mjs "$R" preToolUse failClosed=true timeout=5    # e; use failClosed=false for f
for mode in crash sleep:8000 nostdout exit:1 invalidjson stdout: ; do echo "$mode"; done   # stdout: = empty stdout + exit 0
xqstart '{"preToolUse":{"match":{"*":{"regex":"probe-e"}},"mode":"crash"}}'   # one mode at a time; xqsave E-02e-crash
```

Also record `exit:2` once (Cursor documents it as "block"). E-02 g setup, with
the read tool's real name from E-03 in place of `Read`:

```sh
node spike/hook-opts.mjs "$R" preToolUse 'matcher=^(?!Read$).*'
```

Fail ⇒ (a)+(b) both fail: **release blocked, stop and tell the agent (S0-T5
escalates)**; one passes: use it, the other only logs. (d) write fails: `S`
DEGRADED; MCP fails: `G-mcp`. (e) any allow: that mode is fail-open, `G`/`S`
DEGRADED. (g) unsupported: no matcher.

### E-03 Write-tool inventory

`xqstart '{}'` (neutral; logging only). One row per operation, 10 runs each:

| Op | Prompt |
|---|---|
| create | Create files/new/probe-e03-N.txt containing hello. |
| edit (replace) | In files/d01/f100.txt replace "probe" with "edited-N". |
| edit (rewrite) | Rewrite README.md completely: a title "Probe N" and one sentence. |
| delete | Delete files/d02/f2NN.txt (N padded: f201..f210). |
| rename | Rename files/d03/f3NN.txt to files/d03/renamed-N.txt (f301..f310). |
| notebook | In notebook.ipynb add a code cell that prints N. |
| multi-file patch | In one edit, replace "probe" with "patched" in files/d04/f4NN.txt and files/d05/f5NN.txt. |
| chat "apply" | In **Ask** mode: "Show the change that adds the line applied-N to files/d06/f6NN.txt", then click **Apply**. |

Pass: every operation fires `preToolUse` with a `tool_name` and a readable
path (note the field: `file_path`, `path`, `target_file`, or another). Record
each `tool_name` and path field in Notes; also note `afterFileEdit`. Fail ⇒
missing `preToolUse`: `S:<tool>` DEGRADED; new names go into `writeTools`.

### E-04 Exit codes

`xqstart '{}'`. Prompt: *Run exactly this shell command: `<cmd>`*.

| Run | `<cmd>` | N |
|---|---|---|
| exit 0 | `exit 0` | 10 |
| exit 3 | `exit 3` | 10 |
| false | `false` | 10 |
| user stop | `sleep 60` — press Stop after ~5 s | 10 |
| timeout | `sleep 900` — wait for Cursor's own shell timeout; note how long | 3 |
| background | `sleep 30 &` | 3 |
| long-running server | `node -e "require('http').createServer((q,s)=>s.end('ok')).listen(8765)"` | 3 |

Pass: a non-zero exit is visible (an exit-code field in `afterShellExecution`/
`postToolUse`, or a `postToolUseFailure`); `is_interrupt` on user stop; the
`tool_use_id` of the post event equals that of `preToolUse`. Record the field
names. Fail ⇒ no exit code: `V-stop`, `V-gate` DEGRADED. (N = 3 for the last
three rows is a proposal; they are slow and only record behavior.)

### E-05 Prompt capture

Compare `promptSha256` in `beforeSubmitPrompt` lines with
`printf %s '<prompt>' | shasum -a 256` (the logged `stdin.prompt` may be
redacted; the hash is taken before redaction).

| Run | Steps | Pass |
|---|---|---|
| a. normal | `xqstart '{}'`; prompt *probe-e05-normal-N: reply with OK* | Captured byte-identical 10/10 |
| b. queued | Prompt *Run `sleep 20`*; while it runs, submit *probe-e05-queued-N: reply with OK* | Captured 10/10 (record whether before or after the first turn ends) |
| c. first after restart | Quit Cursor (⌘Q), reopen `$R`, immediately send *probe-e05-first-N: reply with OK*. Repeat with "block until hooks ready" (or similar) if Cursor has that setting | Record |
| d. stop follow-up | `xqstart '{"stop":{"match":{"loop_count":0},"respond":{"followup_message":"probe-e05-followup: reply with OK"}}}'`; prompt *Reply with OK* | The follow-up fires `beforeSubmitPrompt` with the same hash as `printf %s 'probe-e05-followup: reply with OK'` 10/10 |

Fail ⇒ normal not captured: `approvals-prompt` DEGRADED (native-ask fallback);
not identical: prefix match; first-after-restart lost: documented.

### E-06 Stop follow-ups (optional)

`xqstart '{"stop":{"respond":{"followup_message":"probe-e06: reply with OK"}}}'`, prompt *Reply with OK*:

1. `node spike/hook-opts.mjs "$R" stop loop_limit=1`, then `loop_limit=5`, then `loop_limit=null`:
   count auto-submitted follow-ups and the `loop_count` values (stop after ~10 for `null`).
2. Second user-level stop hook: `node spike/hook-opts.mjs --user-install stop` and add
   `"stop@user":{"respond":{"followup_message":"probe-e06-user: reply with OK"}}`
   to `script.json`; record which follow-up is submitted. Then `--user-remove`.

Fail ⇒ not submitted: `V-stop` DEGRADED; the other hook wins: `doctor` warns, `V-stop` DEGRADED when present.

### E-07 Worktrees, filesystem, concurrency

`xqstart '{}'`. The scratch repo has the `<C>/xq-probe-ledger` marker, so every
hook call also writes `<C>` and appends to
`<C>/squad/enforce/ledger/<conversation_id>.ndjson` (`C=w seq=…` in `summarize`).

| Run | Steps | Pass |
|---|---|---|
| a. worktree with a space | Open `"$R.worktrees/linked wt"` as its own workspace; prompt *Create probe-e07a-N.txt containing hello.* | `git.commonDir` = `$R/.git`, `C=w`, `ledger.ok` |
| b. Agents Window worktree | Start an agent on `$R` in its own worktree from the Agents window; same prompt with `e07b` | same as a |
| c. sandboxed shell writes `<C>` | From workspace a: *Run: `touch "$(git rev-parse --path-format=absolute --git-common-dir)/xq-probe-sandbox-N"`* | `ls $R/.git/xq-probe-sandbox-*`; record `CURSOR_SANDBOX` in `env` |
| d. sibling worktree (R-38) | From workspace a: *Run: `git worktree add ../xq-sibling-N -b xq-sibling-N`* | Record whether it is created outside the workspace |
| e. 4 parallel tool calls | *Create par-N-1.txt, par-N-2.txt, par-N-3.txt and par-N-4.txt, each containing its name, using four separate edit tool calls in parallel.* | Overlapping `hrtimeStart`..`hrtimeEnd`; ledger verify below shows 0 forks |
| f. lock prototype on APFS | `bash spike/lock-stress.sh` (N = 1) | `PASS` |

```sh
for f in "$R"/.git/squad/enforce/ledger/*.ndjson; do node "$R/.cursor/xq-probe/lock-proto.mjs" verify "$f"; done
```

Fail ⇒ hooks cannot write `<C>`: `S-concurrent` and `V` DEGRADED or release
blocked for V (decide then); sandbox blocks the CLI: MSG-56 path; sandbox
blocks the sibling: R-38 uses `.squad/worktrees/xq-update-<slug>`; forks: fix
the lock before B1-03.

### E-08 Environment (optional)

1. Node only from nvm: if `which -a node` shows only `~/.nvm/...`, quit Cursor
   and launch it from the Dock; any log line means Node was found (no log ⇒ not found).
2. Env kill switch: `launchctl setenv XQ_PROBE_SWITCH 1`, relaunch from the
   Dock, check `env.XQ_PROBE_SWITCH` in the log; `launchctl unsetenv XQ_PROBE_SWITCH`.
3. Prompt *Run `env | grep -E "^CURSOR_(AGENT|SANDBOX)"`*, and run the same in
   a terminal you open yourself: `CURSOR_AGENT` should be agent-only.

Fail ⇒ Node not found: launcher (CH-21); env not inherited: file switch only;
`CURSOR_AGENT` everywhere: rely on the hook block.

### E-09 Merge with other hooks (optional; can block the release)

```sh
node spike/hook-opts.mjs --user-install preToolUse     # user-level copy, source "user"
xqstart '{"preToolUse@user":{"respond":{"permission":"allow"}},"preToolUse":{"match":{"*":{"regex":"probe-e09"}},"respond":{"permission":"deny","agent_message":"probe-deny-e09"}}}'
```

- a. Prompt *Create probe-e09-N.txt containing hello.* Pass: the file never appears (deny wins).
- b. Foreign `updated_input`: `xqstart '{"preToolUse@user":{"match":{"*":{"regex":"probe-e09b"}},"respond":{"permission":"allow","updated_input":{"command":"echo rewritten > probe-e09-rewritten.txt"}}}}'`;
  prompt *Run exactly: `echo probe-e09b`*. Record whether `probe-e09-rewritten.txt` appears.
- `node spike/hook-opts.mjs --user-remove` afterwards.

Fail ⇒ allow beats deny: **release blocked, stop**; `updated_input` applied: `doctor` warns.

### E-10-lite Cloud agent (N = 1)

1. Push the scratch repo to the throwaway remote (above) and start a Cursor
   cloud agent on it.
2. Prompt 1: *Run exactly:*
   `mkdir -p ~/xq-probe && printf '%s' '{"beforeShellExecution":{"match":{"command":{"regex":"git push"}},"respond":{"permission":"deny","agent_message":"probe-deny-push"}},"preToolUse":{"match":{"*":{"regex":"git push"}},"respond":{"permission":"deny","agent_message":"probe-deny-push"}}}' > ~/xq-probe/script.json`
3. Prompt 2: *Create branch probe-e10, commit a file probe-e10.txt, and run `git push origin probe-e10`.* Pass: branch absent on GitHub.
4. Prompt 3: *Run exactly: `exit 3`.* Pass: exit code visible in the post hook.
5. Send one follow-up from the web UI: *probe-e10-web: reply with OK.* Pass: `beforeSubmitPrompt` logged.
6. Prompt 4: *Run `rm ~/xq-probe/script.json`, then commit `~/xq-probe/*.ndjson` into `probe-logs/` on a new branch probe-logs and push it.* Download that branch.

Fail ⇒ same mapping as the IDE rows, with `@cloud`.

### Results (copy into your notes; S0-T5 turns them into the report)

| Exp | Cursor | macOS | Date | N | Pass/N | Result | Log file | Notes (tool names, fields) |
|---|---|---|---|---|---|---|---|---|
| E-01 | | | | 1 | | | E-01.ndjson | |
| E-02a BSE deny | | | | 10 | | | E-02a.ndjson | |
| E-02b PTU deny | | | | 10 | | | E-02b.ndjson | |
| E-02c both | | | | 10 | | order: | E-02c.ndjson | |
| E-02d1 write | | | | 10 | | | E-02d1.ndjson | |
| E-02d2 MCP via BME | | | | 10 | | | E-02d2.ndjson | |
| E-02d3 MCP via PTU | | | | 10 | | | E-02d3.ndjson | |
| E-02e crash / sleep / nostdout / exit:1 / invalidjson / empty | | | | 10 each | | | E-02e-<mode>.ndjson | |
| E-02f same modes | | | | 10 each | | | E-02f-<mode>.ndjson | |
| E-02g matcher | | | | 10 | | | E-02g.ndjson | |
| E-03 create / replace / rewrite / delete / rename / notebook / multi / apply | | | | 10 each | | | E-03-<op>.ndjson | |
| E-04 exit 0 / 3 / false / stop | | | | 10 each | | | E-04-<run>.ndjson | |
| E-04 timeout / background / server | | | | 3 each | | | E-04-<run>.ndjson | |
| E-05a/b/c/d | | | | 10 each | | | E-05<x>.ndjson | |
| E-06 (opt) | | | | | | | E-06.ndjson | |
| E-07a..e | | | | 10 each | | | E-07<x>.ndjson | |
| E-07f lock-stress | | | | 1 | | | (stdout) | |
| E-08 (opt) | | | | 1 | | | E-08.ndjson | |
| E-09a/b (opt) | | | | 10 | | | E-09<x>.ndjson | |
| E-10-lite | | cloud | | 1 | | | probe-logs branch | |

Hand over: the `~/xq-probe/E-*.ndjson` files, the probe-logs branch, and this
table. Raw logs contain paths, prompts and your email; send them privately.


## Ledger lock prototype (S0-T3)

```sh
bash spike/lock-stress.sh            # 8 appenders x 500 records, then a 31 s stale lock
node spike/lock-proto.mjs verify <ledger.ndjson>
node spike/lock-proto.mjs append <ledger.ndjson> <actor> [count] [conv]
```

Protocol (SPEC §9.2/§9.3): lock = `mkdir <ledger>.lock.d` + `holder.json`
(`nonce`, pid, host, hook, ts). On `EEXIST`, a lock dir older than 30 s is
renamed to `lock.broken.<nonce>` and removed, and `ledger.lock-broken
{ holder }` is appended after acquiring; otherwise back off 10, 20, 40, 80,
160, 320 ms, then the append fails (`LOCK_BUSY`). No PID checks. Under the
lock: read the last 64 KiB; if the file does not end in `\n`, write `\n`
first (torn tail); seq 0 is `session.open` with `prev =
sha256("xq-squad-ledger/v1/" + conv)`; `hash = sha256(prev + "\n" +
canonicalJson(record without hash))`; one `writeSync` per append; fsync.
Release removes the lock only if `holder.json` still has our nonce. Records
over 16 KiB are refused. `verify` reports the first broken seq, forks
(`fork at seq n`), torn lines.

The 8 x 500 stress run is far above real hook contention: with the §9.3
backoff (≤ 650 ms) about 0.3 % of attempts end `LOCK_BUSY` (an unfair lock:
sleeping waiters lose to fresh arrivals). The stress harness counts them and
resubmits the record, so the run still checks 4,000 records, contiguous seq,
valid chain, 0 forks. Experiment knobs (not SPEC): `XQ_LOCK_BACKOFF=10,20,…`,
`XQ_LOCK_FSYNC=0`.
