// node --test spike/probe.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENTS, neutralResponse } from './probe.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROBE = path.join(HERE, 'probe.mjs');

function sandbox(script) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xq-probe-home-'));
  if (script) {
    fs.mkdirSync(path.join(home, 'xq-probe'));
    fs.writeFileSync(path.join(home, 'xq-probe', 'script.json'), JSON.stringify(script));
  }
  return home;
}

function run(home, event, input, { env = {}, cwd = home } = {}) {
  const stdin = typeof input === 'string' ? input : JSON.stringify(input ?? {});
  const baseEnv = { PATH: process.env.PATH, HOME: home };
  return spawnSync(process.execPath, [PROBE, event], { input: stdin, cwd, env: { ...baseEnv, ...env }, encoding: 'utf8' });
}

function logLines(home) {
  const dir = path.join(home, 'xq-probe');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ndjson'));
  assert.equal(files.length, 1);
  assert.match(files[0], /^\d{4}-\d{2}-\d{2}\.ndjson$/);
  return fs
    .readFileSync(path.join(dir, files[0]), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

test('hooks.json registers the probe for every Spike-0 event', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(HERE, 'hooks.json'), 'utf8'));
  assert.equal(cfg.version, 1);
  assert.deepEqual(Object.keys(cfg.hooks).sort(), [...EVENTS].sort());
  for (const [event, entries] of Object.entries(cfg.hooks)) {
    assert.equal(entries.length, 1);
    assert.equal(entries[0].command, `node .cursor/xq-probe/probe.mjs ${event}`);
  }
});

test('default is the neutral response for every event, one valid JSON object, exit 0', () => {
  const home = sandbox();
  for (const event of EVENTS) {
    const r = run(home, event, { hook_event_name: event });
    assert.equal(r.status, 0, `${event}: ${r.stderr}`);
    assert.deepEqual(JSON.parse(r.stdout), neutralResponse(event));
    assert.equal(r.stdout.trim().split('\n').length, 1);
  }
  assert.deepEqual(neutralResponse('preToolUse'), { permission: 'allow' });
  assert.deepEqual(neutralResponse('beforeSubmitPrompt'), { continue: true });
  assert.deepEqual(neutralResponse('stop'), {});
  const lines = logLines(home);
  assert.deepEqual(lines.map((l) => l.event), EVENTS);
});

test('script.json match/respond, first matching rule wins, non-match is neutral', () => {
  const home = sandbox({
    preToolUse: [
      { match: { tool_name: 'Write' }, respond: { permission: 'deny', agent_message: 'probe-deny' } },
      { match: { 'tool_input.command': { regex: '^git\\s' } }, respond: { permission: 'deny' } },
    ],
  });
  assert.deepEqual(JSON.parse(run(home, 'preToolUse', { tool_name: 'Write' }).stdout), {
    permission: 'deny',
    agent_message: 'probe-deny',
  });
  assert.deepEqual(JSON.parse(run(home, 'preToolUse', { tool_name: 'Shell', tool_input: { command: 'git push' } }).stdout), {
    permission: 'deny',
  });
  assert.deepEqual(JSON.parse(run(home, 'preToolUse', { tool_name: 'Read' }).stdout), { permission: 'allow' });
  assert.deepEqual(JSON.parse(run(home, 'stop', {}).stdout), {});
  const lines = logLines(home);
  assert.deepEqual(lines.map((l) => l.script.rule), [0, 1, null, null]);
});

const MODES = [
  ['crash', (r) => { assert.equal(r.status, 1); assert.equal(r.stdout, ''); assert.match(r.stderr, /probe-crash/); }],
  ['exit:2', (r) => { assert.equal(r.status, 2); assert.deepEqual(JSON.parse(r.stdout), { permission: 'deny', agent_message: 'x' }); }],
  ['exit:0', (r) => { assert.equal(r.status, 0); assert.deepEqual(JSON.parse(r.stdout), { permission: 'deny', agent_message: 'x' }); }],
  ['stdout:hello world', (r) => { assert.equal(r.status, 0); assert.equal(r.stdout, 'hello world'); }],
  ['nostdout', (r) => { assert.equal(r.status, 0); assert.equal(r.stdout, ''); }],
  ['invalidjson', (r) => { assert.equal(r.status, 0); assert.throws(() => JSON.parse(r.stdout)); }],
  ['sleep:300', (r) => { assert.equal(r.status, 0); assert.deepEqual(JSON.parse(r.stdout), { permission: 'deny', agent_message: 'x' }); }],
];

for (const [mode, check] of MODES) {
  test(`failure mode ${mode}`, () => {
    const home = sandbox({ preToolUse: { mode, respond: { permission: 'deny', agent_message: 'x' } } });
    const t0 = Date.now();
    const r = run(home, 'preToolUse', { tool_name: 'Write' });
    check(r);
    const [line] = logLines(home);
    assert.equal(line.script.mode, mode);
    if (mode.startsWith('sleep:')) {
      assert.ok(Date.now() - t0 >= 300);
      assert.ok(BigInt(line.hrtimeEnd) - BigInt(line.hrtimeStart) >= 300_000_000n);
    }
  });
}

test('log line records stdin, allow-listed env, process facts and timings', () => {
  const home = sandbox();
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'xq-probe-repo '));
  execFileSync('git', ['init', '-q', repo]);
  const r = run(home, 'beforeShellExecution', { command: 'ls', cwd: repo }, {
    cwd: repo,
    env: {
      CURSOR_PROJECT_DIR: repo,
      CURSOR_VERSION: '9.9.9',
      XQ_FOO: 'bar',
      PWD: repo,
      SECRET_THING: 'leak-me',
      GITHUB_TOKEN: 'ghp_abcdefghijklmnop',
      CLAUDE_PROJECT_DIR: repo,
    },
  });
  assert.equal(r.status, 0, r.stderr);
  const [l] = logLines(home);
  assert.equal(l.event, 'beforeShellExecution');
  assert.equal(l.stdinFormat, 'json');
  assert.deepEqual(l.stdin, { command: 'ls', cwd: repo });
  assert.deepEqual(Object.keys(l.env).sort(), ['CURSOR_PROJECT_DIR', 'CURSOR_VERSION', 'HOME', 'PATH', 'PWD', 'XQ_FOO']);
  assert.equal(l.cwd, fs.realpathSync(repo));
  assert.equal(l.platform, process.platform);
  assert.equal(l.node, process.version);
  assert.ok(Number.isInteger(l.pid) && Number.isInteger(l.ppid));
  assert.ok(BigInt(l.hrtimeEnd) >= BigInt(l.hrtimeStart));
  assert.ok(Date.parse(l.wallEnd) >= Date.parse(l.wallStart));
  assert.equal(l.git.commonDir, path.join(fs.realpathSync(repo), '.git'));
  assert.equal(l.git.commonDirWritable, true);
  const text = JSON.stringify(l);
  assert.ok(!text.includes('leak-me') && !text.includes('ghp_') && !text.includes('CLAUDE_PROJECT_DIR'));
});

test('raw stdin is kept as a string; outside git commonDir is null', () => {
  const home = sandbox();
  const r = run(home, 'stop', 'not json {');
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), {});
  const [l] = logLines(home);
  assert.equal(l.stdinFormat, 'raw');
  assert.equal(l.stdin, 'not json {');
  assert.equal(l.git.commonDir, null);
  assert.equal(l.git.commonDirWritable, null);
});

test('token-like values are redacted everywhere in the log', () => {
  const home = sandbox();
  const secrets = ['ghp_AAAA1111', 'gho_BBBB', 'ghs_CCCC', 'ghu_DDDD', 'ghr_EEEE', 'github_pat_11ABC_def', 'sk-proj-XYZ123', 'Bearer abc.def.ghi'];
  run(home, 'beforeSubmitPrompt', { prompt: secrets.join(' and ') }, { env: { CURSOR_X: 'token ghp_ZZZZ9999' } });
  const raw = fs.readFileSync(path.join(home, 'xq-probe', fs.readdirSync(path.join(home, 'xq-probe'))[0]), 'utf8');
  for (const s of [...secrets, 'ghp_ZZZZ9999']) assert.ok(!raw.includes(s), s);
  assert.ok(raw.includes('[REDACTED]'));
});

test('every log line is valid JSON across concurrent invocations', async () => {
  const home = sandbox();
  const { spawn } = await import('node:child_process');
  const big = 'x'.repeat(20000);
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      new Promise((resolve, reject) => {
        const c = spawn(process.execPath, [PROBE, 'afterFileEdit'], { env: { PATH: process.env.PATH, HOME: home } });
        c.on('error', reject);
        c.on('close', resolve);
        c.stdin.end(JSON.stringify({ i, content: big }));
      }),
    ),
  );
  const lines = logLines(home);
  assert.equal(lines.length, 20);
  assert.deepEqual(lines.map((l) => l.stdin.i).sort((a, b) => a - b), [...Array(20).keys()]);
});

test('no npm dependencies and no network APIs', () => {
  assert.ok(!fs.existsSync(path.join(HERE, 'package.json')));
  for (const f of fs.readdirSync(HERE).filter((n) => n.endsWith('.mjs'))) {
    const src = fs.readFileSync(path.join(HERE, f), 'utf8');
    for (const m of src.matchAll(/\bfrom\s+'([^']+)'|import\('([^']+)'\)/g)) {
      const spec = m[1] || m[2];
      assert.ok(spec.startsWith('node:') || spec.startsWith('./'), `${f} imports ${spec}`);
      assert.ok(!/^node:(http|https|http2|net|tls|dgram|dns)$/.test(spec), `${f} imports ${spec}`);
    }
    if (!f.endsWith('.test.mjs')) assert.ok(!/\bfetch\s*\(|WebSocket/.test(src), `${f} uses the network`);
  }
});

test('SPEC §9.6 secret forms are redacted; promptSha256 is taken before redaction', () => {
  const home = sandbox();
  const secrets = ['hunter2', 'xyz.bearer', 'pass123', 'Secret9', 'eyJhbGc.eyJzdWI.sig', 'AKIAABCDEFGHIJKLMNOP', 'xoxb-1-2-abc', 'sk_live_abc123', 'glpat-abcdefghijklmnopqrst'];
  const prompt = `--password hunter2 Authorization: Bearer xyz.bearer https://u:pass123@h.example mysql -u r -pSecret9 ${secrets.slice(4).join(' ')}`;
  run(home, 'beforeSubmitPrompt', { prompt });
  const raw = fs.readFileSync(path.join(home, 'xq-probe', fs.readdirSync(path.join(home, 'xq-probe'))[0]), 'utf8');
  for (const s of secrets) assert.ok(!raw.includes(s), s);
  const [rec] = logLines(home);
  assert.equal(rec.promptSha256, crypto.createHash('sha256').update(prompt).digest('hex'));
  assert.match(rec.stdinSha256, /^[0-9a-f]{64}$/);
});

test('"<event>@<source>" rules apply to that source only; "*" matches anywhere in stdin', () => {
  const home = sandbox({
    'preToolUse@user': { respond: { permission: 'deny', agent_message: 'user-deny' } },
    preToolUse: { match: { '*': { regex: 'probe-star' } }, respond: { permission: 'deny', agent_message: 'star-deny' } },
  });
  const call = (source, input) =>
    JSON.parse(spawnSync(process.execPath, [PROBE, 'preToolUse', ...(source ? [source] : [])], {
      input: JSON.stringify(input), cwd: home, env: { PATH: process.env.PATH, HOME: home }, encoding: 'utf8',
    }).stdout);
  assert.equal(call('user', { tool_name: 'Read' }).agent_message, 'user-deny');
  assert.deepEqual(call(null, { tool_name: 'Read' }), { permission: 'allow' });
  assert.equal(call(null, { tool_name: 'Shell', tool_input: { command: 'echo probe-star' } }).agent_message, 'star-deny');
  assert.deepEqual(logLines(home).map((r) => r.source), ['user', 'project', 'project']);
});

test('with the <C>/xq-probe-ledger marker, each call writes <C> and appends to the conversation ledger', async () => {
  const { verify } = await import('./lock-proto.mjs');
  const home = sandbox();
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'xq-probe-repo-'));
  execFileSync('git', ['init', '-q', repo]);
  const env = { CURSOR_PROJECT_DIR: repo };
  run(home, 'preToolUse', { conversation_id: 'c1', tool_name: 'Write' }, { env });
  assert.equal(fs.existsSync(path.join(repo, '.git', 'squad')), false);
  fs.writeFileSync(path.join(repo, '.git', 'xq-probe-ledger'), '');
  await Promise.all([1, 2, 3, 4].map((i) => new Promise((resolve) => {
    const c = spawn(process.execPath, [PROBE, 'preToolUse'], { cwd: home, env: { PATH: process.env.PATH, HOME: home, ...env } });
    c.on('close', resolve);
    c.stdin.end(JSON.stringify({ conversation_id: 'c1', tool_name: 'Write', tool_use_id: `t${i}` }));
  })));
  const recs = logLines(home);
  assert.equal(recs[0].git.ledger, null);
  assert.ok(recs.every((r) => r.git.commonDirWritable === true));
  assert.ok(recs.slice(1).every((r) => r.git.ledger.ok), JSON.stringify(recs.map((r) => r.git.ledger)));
  const v = verify(path.join(fs.realpathSync(repo), '.git', 'squad', 'enforce', 'ledger', 'c1.ndjson'));
  assert.deepEqual([v.ok, v.forks, v.counts], [true, [], { 'session.open': 1, 'probe.event': 4 }]);
});
