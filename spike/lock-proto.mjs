#!/usr/bin/env node
// Spike-0 prototype of the ledger append protocol (SPEC §9.2-§9.4, ADR-03).
// Throwaway; only node: built-ins.
//   node lock-proto.mjs append <ledger.ndjson> <actor> [count] [conv]
//   node lock-proto.mjs verify <ledger.ndjson>
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const STALE_MS = 30_000;
export const BACKOFF_MS = [10, 20, 40, 80, 160, 320];
export const MAX_RECORD_BYTES = 16 * 1024;
const TAIL_BYTES = 64 * 1024;
const ALWAYS_FSYNC = /^(approval\.|override\.|killswitch)/;

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

export const genesisPrev = (conv) => sha256(`xq-squad-ledger/v1/${conv}`);
export function hashRecord(rec) {
  const { hash, ...rest } = rec;
  return sha256(`${rec.prev}\n${canonicalJson(rest)}`);
}

export const sanitizeConv = (conv) => String(conv).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128) || '_';
export const ledgerPathFor = (commonDir, conv) =>
  path.join(commonDir, 'squad', 'enforce', 'ledger', `${sanitizeConv(conv)}.ndjson`);

const lockPaths = (ledger) => ({ dir: `${ledger}.lock.d`, holder: path.join(`${ledger}.lock.d`, 'holder.json') });

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// §9.3 steps 2-3. Never breaks by PID; age of the lock directory only.
export function acquire(ledger, { hook = 'probe', now = Date.now, backoff = BACKOFF_MS } = {}) {
  const lp = lockPaths(ledger);
  const nonce = crypto.randomBytes(12).toString('hex');
  const broken = [];
  for (let attempt = 0; ; ) {
    try {
      fs.mkdirSync(lp.dir, { mode: 0o700 });
      fs.writeFileSync(lp.holder, JSON.stringify({ nonce, pid: process.pid, host: os.hostname(), hook, ts: new Date().toISOString() }), { mode: 0o600 });
      return { ok: true, ledger, nonce, broken, attempts: attempt + 1 };
    } catch (e) {
      if (e.code !== 'EEXIST') return { ok: false, code: e.code || 'LOCK_ERROR', broken };
    }
    let st = null;
    try {
      st = fs.statSync(lp.dir);
    } catch {}
    if (st && now() - st.mtimeMs > STALE_MS) {
      const holder = readJson(lp.holder);
      const tomb = path.join(path.dirname(ledger), `lock.broken.${nonce}`);
      try {
        fs.renameSync(lp.dir, tomb); // atomic: only one breaker moves this directory
        fs.rmSync(tomb, { recursive: true, force: true });
        broken.push({ holder, ageMs: Math.round(now() - st.mtimeMs) });
      } catch {}
      continue; // retry immediately, without consuming a backoff step
    }
    if (!st) continue; // released between mkdir and stat
    if (attempt >= backoff.length) return { ok: false, code: 'LOCK_BUSY', broken };
    sleepSync(backoff[attempt++]);
  }
}

// §9.3 step 9: remove only if the nonce is ours.
export function release(lock) {
  const lp = lockPaths(lock.ledger);
  if (readJson(lp.holder)?.nonce !== lock.nonce) return false;
  fs.rmSync(lp.holder, { force: true });
  fs.rmdirSync(lp.dir);
  return true;
}

// §9.3 step 4: last complete record within the last 64 KiB, and whether the
// file ends mid-line (torn tail).
export function readTail(ledger) {
  let fd;
  try {
    fd = fs.openSync(ledger, 'r');
  } catch (e) {
    if (e.code === 'ENOENT') return { last: null, torn: false, size: 0 };
    throw e;
  }
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString('utf8');
    const torn = size > 0 && !text.endsWith('\n');
    const lines = text.split('\n');
    lines.pop(); // the torn fragment, or '' after the final newline
    if (start > 0) lines.shift(); // may be a partial line
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const rec = JSON.parse(lines[i]);
        if (rec && typeof rec.hash === 'string' && Number.isInteger(rec.seq)) return { last: rec, torn, size };
      } catch {}
    }
    if (size > TAIL_BYTES) throw Object.assign(new Error('no complete record in the last 64 KiB'), { code: 'TAIL_UNREADABLE' });
    return { last: null, torn, size };
  } finally {
    fs.closeSync(fd);
  }
}

function base(fields, conv) {
  return {
    v: 1,
    ts: new Date().toISOString(),
    conv,
    gen: null,
    event: 'probe',
    surface: 'unknown',
    mode: 'enforce',
    root: null,
    cwd: process.cwd(),
    delivery: null,
    rule: null,
    t: { boot: 0, decide: 0, ledger: 0, total: 0 },
    data: {},
    ...fields,
  };
}

// Append one record (plus genesis and lock-broken records when needed).
// Returns { ok, records, code?, lock }.
export function append(ledger, fields, { conv = 'cli', hook = 'probe', fsync = true, now, backoff } = {}) {
  const t0 = process.hrtime.bigint();
  fs.mkdirSync(path.dirname(ledger), { recursive: true, mode: 0o700 });
  const lock = acquire(ledger, { hook, now, backoff });
  if (!lock.ok) return { ok: false, code: lock.code, records: [] };
  try {
    const { last, torn } = readTail(ledger);
    const out = [];
    let prev = last;
    const next = (f) => {
      const rec = base(f, conv);
      rec.seq = prev ? prev.seq + 1 : 0;
      rec.prev = prev ? prev.hash : genesisPrev(conv);
      rec.hash = hashRecord(rec);
      const line = JSON.stringify(rec) + '\n';
      if (Buffer.byteLength(line) > MAX_RECORD_BYTES) throw Object.assign(new Error('record over 16 KiB'), { code: 'RECORD_TOO_LARGE' });
      out.push({ rec, line });
      prev = rec;
    };
    if (!last) next({ type: 'session.open', data: { cursorVersion: null, xqVersion: 'spike-0', platform: process.platform } });
    for (const b of lock.broken) next({ type: 'ledger.lock-broken', data: { holder: b.holder, ageMs: b.ageMs } });
    next(fields);
    const needSync = fsync || out.some(({ rec }) => ALWAYS_FSYNC.test(rec.type) || (rec.type === 'decision' && rec.data?.verdict === 'deny'));
    const fd = fs.openSync(ledger, 'a', 0o600);
    try {
      fs.writeSync(fd, (torn ? '\n' : '') + out.map((o) => o.line).join('')); // one write (§9.3 step 6)
      if (needSync) fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return { ok: true, records: out.map((o) => o.rec), torn, brokeLock: lock.broken.length, lockAttempts: lock.attempts, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
  } catch (e) {
    return { ok: false, code: e.code || 'APPEND_FAILED', message: e.message, records: [] };
  } finally {
    release(lock);
  }
}

// §9.4: first broken seq, forks, torn records.
export function verify(ledger) {
  const text = fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8') : '';
  const lines = text.split('\n');
  const tornTail = lines.at(-1) !== '';
  if (!tornTail) lines.pop();
  const seen = new Map(); // hash -> record
  const forks = [];
  const torn = [];
  const counts = {};
  let firstBroken = null;
  let prev = null;
  let records = 0;
  lines.forEach((line, i) => {
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      torn.push(i + 1);
      return;
    }
    records++;
    counts[rec.type] = (counts[rec.type] || 0) + 1;
    const hashOk = rec.hash === hashRecord(rec);
    const expectSeq = prev ? prev.seq + 1 : 0;
    const expectPrev = prev ? prev.hash : genesisPrev(rec.conv);
    if (hashOk && rec.seq === expectSeq && rec.prev === expectPrev) {
      // linked
    } else if (hashOk && seen.has(rec.prev) && rec.seq === seen.get(rec.prev).seq + 1) {
      forks.push(rec.seq);
    } else if (firstBroken === null) {
      firstBroken = rec.seq ?? null;
    }
    seen.set(rec.hash, rec);
    prev = rec;
  });
  return {
    ok: firstBroken === null && forks.length === 0,
    records,
    lastSeq: prev ? prev.seq : null,
    firstBroken,
    forks: forks.map((s) => `fork at seq ${s}`),
    torn: torn.length,
    tornTail,
    counts,
  };
}

const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  // Experiment knobs (not SPEC): XQ_LOCK_BACKOFF=10,20,... and XQ_LOCK_FSYNC=0.
  const BACKOFF = process.env.XQ_LOCK_BACKOFF ? process.env.XQ_LOCK_BACKOFF.split(',').map(Number) : BACKOFF_MS;
  const [cmd, ledger, actor, count, conv] = process.argv.slice(2);
  if (cmd === 'append' && ledger && actor) {
    const n = Number(count || 1);
    let failed = 0;
    let busy = 0;
    let maxAttempts = 0;
    // A LOCK_BUSY append is a failed append under §9.3; the stress harness
    // counts it and resubmits the same record so every record lands.
    for (let i = 0; i < n; i++) {
      let r;
      do {
        r = append(ledger, { type: 'turn.ok', data: { actor, i } }, { conv: conv || 'stress', hook: actor, fsync: process.env.XQ_LOCK_FSYNC !== '0', backoff: BACKOFF });
        if (!r.ok && r.code === 'LOCK_BUSY') busy++;
      } while (!r.ok && r.code === 'LOCK_BUSY');
      if (!r.ok) failed++;
      else maxAttempts = Math.max(maxAttempts, r.lockAttempts);
    }
    console.log(JSON.stringify({ actor, appended: n - failed, busy, failed, maxAttempts }));
    process.exitCode = failed ? 1 : 0;
  } else if (cmd === 'verify' && ledger) {
    const r = verify(ledger);
    console.log(JSON.stringify(r));
    process.exitCode = r.ok ? 0 : 1;
  } else {
    console.error('usage: lock-proto.mjs append <ledger> <actor> [count] [conv] | verify <ledger>');
    process.exitCode = 64;
  }
}
