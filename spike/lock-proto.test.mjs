// node --test spike/lock-proto.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { append, verify, readTail, hashRecord, genesisPrev, canonicalJson, sanitizeConv, ledgerPathFor } from './lock-proto.mjs';

const tmpLedger = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xq-lock-')), 'conv-1.ndjson');
const read = (l) => fs.readFileSync(l, 'utf8').split('\n').filter(Boolean).map((x) => { try { return JSON.parse(x); } catch { return null; } });
const add = (l, i, opts) => append(l, { type: 'turn.ok', data: { i } }, { conv: 'conv-1', ...opts });

test('genesis is session.open at seq 0 chained to sha256("xq-squad-ledger/v1/" + conv)', () => {
  const l = tmpLedger();
  const r = add(l, 0);
  assert.equal(r.ok, true);
  const [g, first] = read(l);
  assert.equal(g.type, 'session.open');
  assert.equal(g.seq, 0);
  assert.equal(g.prev, crypto.createHash('sha256').update('xq-squad-ledger/v1/conv-1').digest('hex'));
  assert.equal(g.prev, genesisPrev('conv-1'));
  assert.equal(first.seq, 1);
  assert.equal(first.prev, g.hash);
});

test('hash = sha256(prev + "\\n" + canonicalJson(record without hash)); records carry the §9.2 top-level fields', () => {
  const l = tmpLedger();
  for (let i = 0; i < 3; i++) add(l, i);
  for (const rec of read(l)) {
    const { hash, ...rest } = rec;
    assert.equal(hash, crypto.createHash('sha256').update(`${rec.prev}\n${canonicalJson(rest)}`).digest('hex'));
    assert.equal(hash, hashRecord(rec));
    for (const k of ['v', 'seq', 'ts', 'conv', 'gen', 'event', 'type', 'surface', 'mode', 'root', 'cwd', 'delivery', 'rule', 't', 'data', 'prev', 'hash']) assert.ok(k in rec, k);
    assert.equal(rec.v, 1);
  }
  assert.equal(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] }), '{"a":[{"c":3,"d":2}],"b":1}');
  const r = verify(l);
  assert.deepEqual([r.ok, r.records, r.lastSeq, r.forks.length, r.torn], [true, 4, 3, 0, 0]);
});

test('the lock directory and holder.json are removed after each append', () => {
  const l = tmpLedger();
  add(l, 0);
  assert.equal(fs.existsSync(`${l}.lock.d`), false);
});

test('torn tail: a newline is appended first and the record chains to the last complete record', () => {
  const l = tmpLedger();
  for (let i = 0; i < 2; i++) add(l, i);
  const before = read(l).at(-1);
  fs.appendFileSync(l, '{"v":1,"seq":3,"prev":"tor');
  assert.equal(readTail(l).torn, true);
  const r = add(l, 2);
  assert.equal(r.ok, true);
  assert.equal(r.records[0].seq, before.seq + 1);
  assert.equal(r.records[0].prev, before.hash);
  assert.ok(fs.readFileSync(l, 'utf8').includes('"prev":"tor\n'));
  const v = verify(l);
  assert.equal(v.ok, true);
  assert.equal(v.torn, 1);
});

test('a lock younger than 30 s is not broken: the append fails after the 10..320 ms backoff (≤ 650 ms)', () => {
  const l = tmpLedger();
  add(l, 0);
  fs.mkdirSync(`${l}.lock.d`);
  fs.writeFileSync(`${l}.lock.d/holder.json`, '{"nonce":"live"}');
  const t = new Date(Date.now() - 29_000);
  fs.utimesSync(`${l}.lock.d`, t, t);
  const t0 = Date.now();
  const r = add(l, 1);
  const ms = Date.now() - t0;
  assert.deepEqual([r.ok, r.code], [false, 'LOCK_BUSY']);
  assert.ok(ms >= 600 && ms < 1500, `${ms} ms`);
  assert.equal(JSON.parse(fs.readFileSync(`${l}.lock.d/holder.json`, 'utf8')).nonce, 'live');
});

test('a 31 s old lock is broken by rename, removed, and ledger.lock-broken { holder } is appended', () => {
  const l = tmpLedger();
  add(l, 0);
  fs.mkdirSync(`${l}.lock.d`);
  fs.writeFileSync(`${l}.lock.d/holder.json`, '{"nonce":"old","pid":1,"host":"h","hook":"x","ts":"t"}');
  const t = new Date(Date.now() - 31_000);
  fs.utimesSync(`${l}.lock.d`, t, t);
  const r = add(l, 1);
  assert.equal(r.ok, true);
  const recs = read(l);
  assert.deepEqual(recs.map((x) => x.type), ['session.open', 'turn.ok', 'ledger.lock-broken', 'turn.ok']);
  assert.equal(recs[2].data.holder.nonce, 'old');
  assert.deepEqual(fs.readdirSync(path.dirname(l)).filter((n) => n.includes('lock')), []);
  assert.equal(verify(l).ok, true);
});

test('release leaves a lock whose nonce is not ours', async () => {
  const { acquire, release } = await import('./lock-proto.mjs');
  const l = tmpLedger();
  const lock = acquire(l);
  fs.writeFileSync(`${l}.lock.d/holder.json`, '{"nonce":"someone-else"}');
  assert.equal(release(lock), false);
  assert.equal(fs.existsSync(`${l}.lock.d`), true);
});

test('verify reports "fork at seq n" and the first broken seq', () => {
  const l = tmpLedger();
  for (let i = 0; i < 3; i++) add(l, i);
  const recs = read(l);
  const fork = { ...recs[2], data: { i: 'fork' } };
  fork.hash = hashRecord(fork);
  fs.appendFileSync(l, JSON.stringify(fork) + '\n');
  let v = verify(l);
  assert.deepEqual([v.ok, v.forks], [false, [`fork at seq ${fork.seq}`]]);

  const l2 = tmpLedger();
  for (let i = 0; i < 3; i++) add(l2, i);
  const lines = fs.readFileSync(l2, 'utf8').split('\n');
  lines[2] = lines[2].replace('"i":1', '"i":99');
  fs.writeFileSync(l2, lines.join('\n'));
  v = verify(l2);
  assert.deepEqual([v.ok, v.firstBroken], [false, 2]);
});

test('records over 16 KiB are refused', () => {
  const l = tmpLedger();
  const r = append(l, { type: 'turn.ok', data: { big: 'x'.repeat(17_000) } }, { conv: 'c' });
  assert.deepEqual([r.ok, r.code], [false, 'RECORD_TOO_LARGE']);
});

test('ledger path is <C>/squad/enforce/ledger/<sanitized conv>.ndjson', () => {
  assert.equal(sanitizeConv('ab/c d:é'), 'ab_c_d__');
  assert.equal(ledgerPathFor('/r/.git', 'x/y'), '/r/.git/squad/enforce/ledger/x_y.ndjson');
});
