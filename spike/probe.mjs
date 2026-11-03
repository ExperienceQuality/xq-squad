#!/usr/bin/env node
// Spike-0 Cursor hook probe. Throwaway: records what Cursor sends to a hook
// and replies with a scripted response. Usage: node probe.mjs <event> [source]
// (source labels the hooks.json that registered it: project (default) or user).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const EVENTS = [
  'sessionStart', 'sessionEnd', 'beforeSubmitPrompt', 'beforeShellExecution', 'preToolUse',
  'beforeMCPExecution', 'postToolUse', 'postToolUseFailure', 'afterFileEdit', 'afterShellExecution',
  'subagentStart', 'subagentStop', 'stop',
];

const NEUTRAL = {
  beforeSubmitPrompt: { continue: true },
  beforeShellExecution: { permission: 'allow' },
  preToolUse: { permission: 'allow' },
  beforeMCPExecution: { permission: 'allow' },
  subagentStart: { permission: 'allow' },
};
export const neutralResponse = (event) => ({ ...(NEUTRAL[event] || {}) });

const ENV_KEEP = /^(CURSOR_|XQ_)|^(PATH|HOME|PWD)$/;
// SPEC §9.6 patterns, plus the shorter token forms from the Spike-0 brief.
const SECRETS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[REDACTED]'],
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@"']+:[^\s/@"']+@/gi, '$1[REDACTED]@'],
  [/\b(mysql|mysqldump)\b([^\n]*?\s)-p\S+/g, '$1$2-p[REDACTED]'],
  [/--password[= ]\S+/g, '--password=[REDACTED]'],
  [/https:\/\/hooks\.slack\.com\/services\/\S+/g, '[REDACTED]'],
  [/\bgh[pousr]_[A-Za-z0-9]+|\bgithub_pat_[A-Za-z0-9_]+|\bsk-[A-Za-z0-9_-]+|\b[sr]k_(?:live|test)_[A-Za-z0-9]+/g, '[REDACTED]'],
  [/\bxox[baprs]-[A-Za-z0-9-]+|\bAKIA[0-9A-Z]{16}|\bAIza[0-9A-Za-z_-]{35}|\bnpm_[A-Za-z0-9]{36}|\bglpat-[A-Za-z0-9_-]{20}/g, '[REDACTED]'],
  [/\b(authorization\s*[:=]\s*)?bearer\s+[^\s"']+/gi, '$1[REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED]'],
  [/\b(token|secret|password|passwd|api[_-]?key|authorization|bearer)(?![:=\s]*\[REDACTED\])(\s*[:=]?\s*)[^\s"']+/gi, '$1$2[REDACTED]'],
];

export function redact(value) {
  if (typeof value === 'string') return SECRETS.reduce((str, [re, to]) => str.replace(re, to), value);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v)]));
  }
  return value;
}

export function pickEnv(env) {
  return Object.fromEntries(Object.keys(env).filter((k) => ENV_KEEP.test(k)).sort().map((k) => [k, env[k]]));
}

function parseStdin(raw) {
  try {
    return { stdinFormat: 'json', stdin: JSON.parse(raw) };
  } catch {
    return { stdinFormat: 'raw', stdin: raw };
  }
}

// A match value is a literal (deep-equal via JSON) or { "regex": "<re>" }
// tested against the string form. Dotted keys reach into nested objects;
// the key "*" tests the whole stdin as JSON text.
function matches(match, input) {
  if (!match || typeof match !== 'object') return true;
  return Object.entries(match).every(([key, want]) => {
    const got = key === '*' ? input : key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), input);
    if (want && typeof want === 'object' && typeof want.regex === 'string') {
      return got !== undefined && new RegExp(want.regex).test(typeof got === 'string' ? got : JSON.stringify(got));
    }
    return JSON.stringify(got) === JSON.stringify(want);
  });
}

// script.json: { "<event>[@<source>]": rule | [rule, ...] }, rule = { match?, respond?, mode? }.
// "<event>@<source>" is used instead of "<event>" when present. The first
// matching rule wins; no match means the neutral response.
export function chooseRule(script, event, input, source = 'project') {
  const entry = script?.[`${event}@${source}`] ?? script?.[event];
  const rules = Array.isArray(entry) ? entry : entry ? [entry] : [];
  const rule = rules.find((r) => r && typeof r === 'object' && matches(r.match, input));
  return {
    rule: rule ? rules.indexOf(rule) : null,
    respond: rule && rule.respond !== undefined ? rule.respond : neutralResponse(event),
    mode: rule && typeof rule.mode === 'string' ? rule.mode : null,
  };
}

function readScript(dir) {
  const file = path.join(dir, 'script.json');
  try {
    return { script: JSON.parse(fs.readFileSync(file, 'utf8')), scriptError: null };
  } catch (e) {
    return { script: {}, scriptError: e.code === 'ENOENT' ? null : String(e.message) };
  }
}

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

// E-07: can this hook resolve and really write <C> (the git common dir)?
// The ledger append runs only in a scratch repo (make-test-repo.sh creates
// <C>/xq-probe-ledger), so running the tests never writes a real repo's ledger.
async function gitCommonDir(dir, stdin, event) {
  const out = { dir, commonDir: null, commonDirWritable: null, error: null, ledger: null };
  try {
    out.commonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
    }).trim();
    const probeFile = path.join(out.commonDir, `xq-probe-write.${process.pid}`);
    fs.writeFileSync(probeFile, 'x');
    fs.unlinkSync(probeFile);
    out.commonDirWritable = true;
  } catch (e) {
    if (out.commonDir) out.commonDirWritable = false;
    out.error = String(e.code || e.status || e.message).slice(0, 200);
  }
  if (out.commonDirWritable && fs.existsSync(path.join(out.commonDir, 'xq-probe-ledger'))) {
    try {
      const { append, ledgerPathFor } = await import(new URL('./lock-proto.mjs', import.meta.url));
      const conv = (stdin && typeof stdin === 'object' && stdin.conversation_id) || 'unknown';
      const data = { tool_name: stdin?.tool_name ?? null, tool_use_id: stdin?.tool_use_id ?? null, pid: process.pid };
      const r = append(ledgerPathFor(out.commonDir, conv), { type: 'probe.event', data: { event, ...data } }, { conv, hook: event });
      out.ledger = { ok: r.ok, code: r.code ?? null, seq: r.ok ? r.records.at(-1).seq : null, lockAttempts: r.lockAttempts ?? null };
    } catch (e) {
      out.ledger = { ok: false, code: String(e.code || e.message).slice(0, 200) };
    }
  }
  return out;
}

const localDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function readAll(stream) {
  let raw = '';
  stream.setEncoding('utf8');
  for await (const chunk of stream) raw += chunk;
  return raw;
}

async function main() {
  const hrStart = process.hrtime.bigint();
  const wallStart = new Date();
  const dir = path.join(os.homedir(), 'xq-probe');
  const raw = await readAll(process.stdin);
  const { stdinFormat, stdin } = parseStdin(raw);
  const event = process.argv[2] || (stdin && typeof stdin === 'object' && stdin.hook_event_name) || 'unknown';
  const { script, scriptError } = readScript(dir);
  const source = process.argv[3] || 'project';
  const choice = chooseRule(script, event, stdin, source);
  const projectDir =
    process.env.CURSOR_PROJECT_DIR || (Array.isArray(stdin?.workspace_roots) && stdin.workspace_roots[0]) || process.cwd();

  const sleep = /^sleep:(\d+)$/.exec(choice.mode || '');
  if (sleep) await new Promise((r) => setTimeout(r, Number(sleep[1])));

  const record = {
    event,
    argvEvent: process.argv[2] ?? null,
    source,
    stdinFormat,
    stdinSha256: sha256(raw),
    promptSha256: typeof stdin?.prompt === 'string' ? sha256(stdin.prompt) : null,
    stdin,
    env: pickEnv(process.env),
    cwd: process.cwd(),
    platform: process.platform,
    node: process.version,
    pid: process.pid,
    ppid: process.ppid,
    git: await gitCommonDir(projectDir, stdin, event),
    script: { rule: choice.rule, mode: choice.mode, respond: choice.respond, error: scriptError },
    hrtimeStart: hrStart.toString(),
    wallStart: wallStart.toISOString(),
  };
  record.hrtimeEnd = process.hrtime.bigint().toString();
  record.wallEnd = new Date().toISOString();
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, `${localDate(wallStart)}.ndjson`), JSON.stringify(redact(record)) + '\n');

  const mode = choice.mode || '';
  const body = JSON.stringify(choice.respond);
  if (mode === 'crash') throw new Error('probe-crash');
  if (mode === 'nostdout') return 0;
  if (mode === 'invalidjson') {
    process.stdout.write('{"permission": \n');
    return 0;
  }
  if (mode.startsWith('stdout:')) {
    process.stdout.write(mode.slice('stdout:'.length));
    return 0;
  }
  process.stdout.write(body + '\n');
  const exit = /^exit:(\d+)$/.exec(mode);
  return exit ? Number(exit[1]) : 0;
}

const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();
if (isMain) {
  process.exitCode = await main();
}
