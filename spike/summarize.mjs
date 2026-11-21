#!/usr/bin/env node
// Spike-0 helper: one line per probe log record.
//   node summarize.mjs [log.ndjson ...] [--grep <regex>] [--json]
// Default log: ~/xq-probe/<today>.ndjson. --json prints the selected full records.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const gi = args.indexOf('--grep');
const grep = gi >= 0 ? new RegExp(args.splice(gi, 2)[1]) : null;
const json = args.includes('--json');
const files = args.filter((x) => x !== '--json');
const d = new Date();
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
if (!files.length) files.push(path.join(os.homedir(), 'xq-probe', `${today}.ndjson`));

const INTERESTING = /exit|interrupt|status|loop|error|duration|permission|parent_conversation|subagent|model/i;
for (const file of files) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    if (grep && !grep.test(line)) continue;
    const r = JSON.parse(line);
    if (json) { console.log(JSON.stringify(r, null, 2)); continue; }
    const s = r.stdin && typeof r.stdin === 'object' ? r.stdin : {};
    const ti = s.tool_input && typeof s.tool_input === 'object' ? s.tool_input : {};
    const target = s.command ?? ti.command ?? ti.file_path ?? ti.path ?? ti.target_file ?? s.file_path ?? (s.prompt != null ? `prompt=${JSON.stringify(s.prompt).slice(0, 60)}` : '');
    const extra = Object.entries(s).filter(([k]) => INTERESTING.test(k)).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
    const ms = (Number(BigInt(r.hrtimeEnd) - BigInt(r.hrtimeStart)) / 1e6).toFixed(1);
    const resp = r.script?.mode ? `mode=${r.script.mode}` : JSON.stringify(r.script?.respond);
    const git = r.git?.commonDirWritable == null ? 'C=?' : r.git.commonDirWritable ? `C=w${r.git.ledger ? ` seq=${r.git.ledger.seq}` : ''}` : 'C=ro';
    console.log([r.wallStart.slice(11, 23), r.source ?? 'project', r.event, s.tool_name ?? '', String(target).slice(0, 80),
      `conv=${String(s.conversation_id ?? '-').slice(0, 8)}`, `tuid=${String(s.tool_use_id ?? '-').slice(0, 10)}`, ...extra, `→ ${resp}`, git, `${ms}ms`].join(' | '));
  }
}
