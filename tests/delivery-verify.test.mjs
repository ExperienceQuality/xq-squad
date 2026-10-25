import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  cpSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  readFileSync,
} from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSessionCommand } from '../distribution/.squad/scripts/delivery-session.mjs';
import {
  captureDeliverySnapshot,
  verifyDeliveryWrites,
} from '../distribution/.squad/scripts/delivery-verify.mjs';

const SQUAD_SRC = fileURLToPath(new URL('../distribution/.squad', import.meta.url));
const APPROVAL = { confirmed: true, reference: 'setup' };
const STOPPED = { confirmed: true, reference: 'stopped' };

function git(args, cwd) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

// A consumer repo with the full installed .squad committed plus a .gitignore.
function setupConsumer() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'xq-verify-')));
  git(['init', '-b', 'main'], dir);
  writeFileSync(join(dir, 'keep.txt'), 'tracked-bytes');
  writeFileSync(join(dir, '.gitignore'), 'ignored-dir/\n*.tmp\n');
  mkdirSync(join(dir, '.squad', 'scripts'), { recursive: true });
  mkdirSync(join(dir, '.squad', 'schemas'), { recursive: true });
  for (const f of readdirSync(join(SQUAD_SRC, 'scripts'))) {
    if (f.endsWith('.mjs')) cpSync(join(SQUAD_SRC, 'scripts', f), join(dir, '.squad', 'scripts', f));
  }
  for (const f of readdirSync(join(SQUAD_SRC, 'schemas'))) {
    if (f.endsWith('.json')) cpSync(join(SQUAD_SRC, 'schemas', f), join(dir, '.squad', 'schemas', f));
  }
  git(['add', '-A'], dir);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init'], dir);
  return { dir, baseCommit: git(['rev-parse', 'HEAD'], dir) };
}

async function acquireOwned(dir, over = {}) {
  const r = await runSessionCommand('acquire', {
    repositoryPath: dir,
    deliveryId: 'demo',
    mainCheckoutPath: dir,
    baseRef: 'main',
    scope: ['src/', '.squad/memory/deliveries/demo.ndjson'],
    approval: APPROVAL,
    ...over,
  });
  assert.equal(r.status, 'OK', JSON.stringify(r));
  return {
    repositoryPath: dir,
    deliveryId: 'demo',
    ownerToken: r.ownerToken,
    generation: r.generation,
    worktreePath: r.worktreePath,
  };
}

test('capture binds claim to a clean snapshot; verify accepts in-scope edits', async () => {
  const { dir } = setupConsumer();
  const ctx = await acquireOwned(dir);
  const cap = await captureDeliverySnapshot(ctx);
  assert.equal(cap.status, 'OK', JSON.stringify(cap));
  const snap = cap.snapshot;
  assert.equal(snap.version, 1);
  assert.equal(snap.deliveryId, 'demo');
  assert.equal(snap.generation, 1);
  assert.equal(snap.worktreePath, ctx.worktreePath);
  assert.ok(snap.head && snap.resolvedTarget && snap.baseCommit);
  assert.ok(snap.files['keep.txt']);
  assert.equal(snap.ownerToken, undefined);
  assert.equal(JSON.stringify(snap).includes(ctx.ownerToken), false);

  // In-scope authored edits verify clean.
  mkdirSync(join(ctx.worktreePath, 'src'), { recursive: true });
  writeFileSync(join(ctx.worktreePath, 'src', 'new.ts'), 'x');
  mkdirSync(join(ctx.worktreePath, '.squad', 'memory', 'deliveries'), { recursive: true });
  writeFileSync(join(ctx.worktreePath, '.squad', 'memory', 'deliveries', 'demo.ndjson'), 'entry\n');
  const v = await verifyDeliveryWrites(ctx, snap);
  assert.equal(v.status, 'OK', JSON.stringify(v));
});

test('context and baseline validation is strict', async () => {
  const { dir } = setupConsumer();
  const ctx = await acquireOwned(dir);
  for (const bad of [
    {},
    { ...ctx, ownerToken: '' },
    { ...ctx, generation: 0 },
    { ...ctx, generation: 'x' },
    { ...ctx, worktreePath: 'relative' },
    { ...ctx, surprise: 1 },
  ]) {
    const r = await captureDeliverySnapshot(bad);
    assert.equal(r.status, 'ERROR');
    assert.equal(r.code, 'INVALID_INPUT');
  }
  const cap = await captureDeliverySnapshot(ctx);
  const goodFp = { t: 'f', h: 'a'.repeat(64) };
  for (const badBaseline of [
    {},
    { ...cap.snapshot, version: 2 },
    { ...cap.snapshot, generation: 7 },
    { ...cap.snapshot, files: { 'a.txt': { t: 'f', h: 'x', extra: 1 } } },
    { ...cap.snapshot, head: 'notasha' },
    // Untrusted baseline data: non-canonical keys and malformed fingerprints.
    { ...cap.snapshot, files: { '../escape.txt': goodFp } },
    { ...cap.snapshot, files: { 'a//b.txt': goodFp } },
    { ...cap.snapshot, files: { 'a.txt': { t: 'f', h: 'x' } } },
    { ...cap.snapshot, files: { 'a.txt': { t: 'i', s: -1, m: 5 } } },
    { ...cap.snapshot, files: { 'a.txt': { t: 'i', s: NaN, m: 5 } } },
    { ...cap.snapshot, files: { 'a.txt': { t: 'wat' } } },
    { ...cap.snapshot, files: { 'a.txt': { t: 'missing', extra: 1 } } },
  ]) {
    const r = await verifyDeliveryWrites(ctx, badBaseline);
    assert.equal(r.status, 'ERROR', JSON.stringify(badBaseline).slice(0, 80));
  }
});

test('wrong token, generation, main checkout, or foreign worktree rejected', async () => {
  const { dir } = setupConsumer();
  const ctx = await acquireOwned(dir);
  for (const bad of [
    { ...ctx, ownerToken: 'wrong-token' },
    { ...ctx, generation: 9 },
    { ...ctx, deliveryId: 'ghost' },
    { ...ctx, worktreePath: dir }, // main checkout
    { ...ctx, worktreePath: '/nonexistent/path' },
  ]) {
    const cap = await captureDeliverySnapshot(bad);
    assert.equal(cap.status, 'BLOCKED', JSON.stringify(bad.worktreePath));
  }
  // A linked worktree on another branch is not the claimed worktree.
  const linked = join(dir, 'other-checkout');
  git(['worktree', 'add', linked, '-b', 'other'], dir);
  const cap2 = await captureDeliverySnapshot({ ...ctx, worktreePath: realpathSync(linked) });
  assert.equal(cap2.status, 'BLOCKED');
  // Wrong branch inside the claimed path identity.
  git(['checkout', '-b', 'not-squad'], ctx.worktreePath);
  const cap3 = await captureDeliverySnapshot(ctx);
  assert.equal(cap3.status, 'BLOCKED');
});

test('out-of-scope authored writes fail verify with preserved violations', async () => {
  const { dir } = setupConsumer();
  const ctx = await acquireOwned(dir);
  const cap = await captureDeliverySnapshot(ctx);
  assert.equal(cap.status, 'OK');

  // Tracked delete + untracked + ignored out-of-scope (rename covered below).
  rmSync(join(ctx.worktreePath, 'keep.txt'));
  writeFileSync(join(ctx.worktreePath, 'outside.txt'), 'bad');
  mkdirSync(join(ctx.worktreePath, 'ignored-dir'), { recursive: true });
  writeFileSync(join(ctx.worktreePath, 'ignored-dir', 'out.bin'), 'bad');
  const v = await verifyDeliveryWrites(ctx, cap.snapshot);
  assert.equal(v.status, 'BLOCKED');
  assert.equal(v.code, 'SCOPE_CONFLICT');
  const paths = v.violations.map((x) => x.path);
  assert.ok(paths.includes('keep.txt'), JSON.stringify(paths));
  assert.ok(paths.includes('outside.txt'));
  assert.ok(paths.includes('ignored-dir/out.bin'));
  // Offending bytes are never touched.
  assert.equal(existsSync(join(ctx.worktreePath, 'outside.txt')), true);
});

test('rename source and destination are both checked', async () => {
  const { dir } = setupConsumer();
  writeFileSync(join(dir, 'seed.txt'), 's');
  git(['add', 'seed.txt'], dir);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'seed'], dir);
  const ctx = await acquireOwned(dir);
  const cap = await captureDeliverySnapshot(ctx);
  // Rename an out-of-scope tracked file into scope: source must be flagged.
  mkdirSync(join(ctx.worktreePath, 'src'));
  git(['mv', 'seed.txt', 'src/seed.txt'], ctx.worktreePath);
  const v = await verifyDeliveryWrites(ctx, cap.snapshot);
  assert.equal(v.status, 'BLOCKED');
  const paths = v.violations.map((x) => x.path);
  assert.ok(paths.includes('seed.txt'), JSON.stringify(paths));
});

test('capture refuses to launder pre-existing out-of-scope changes', async () => {
  const { dir } = setupConsumer();
  const ctx = await acquireOwned(dir);
  writeFileSync(join(ctx.worktreePath, 'outside.txt'), 'bad');
  const cap = await captureDeliverySnapshot(ctx);
  assert.equal(cap.status, 'BLOCKED');
  assert.equal(cap.code, 'SCOPE_CONFLICT');
  rmSync(join(ctx.worktreePath, 'outside.txt'));
  const cap2 = await captureDeliverySnapshot(ctx);
  assert.equal(cap2.status, 'OK');
});

test('in-scope commits invalidate the baseline; recapture then verifies', async () => {
  const { dir } = setupConsumer();
  const ctx = await acquireOwned(dir);
  const cap = await captureDeliverySnapshot(ctx);
  mkdirSync(join(ctx.worktreePath, 'src'));
  writeFileSync(join(ctx.worktreePath, 'src', 'a.ts'), 'x');
  git(['add', 'src/a.ts'], ctx.worktreePath);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'work'], ctx.worktreePath);
  const stale = await verifyDeliveryWrites(ctx, cap.snapshot);
  assert.equal(stale.status, 'BLOCKED');
  assert.equal(stale.code, 'RECOVERY_REQUIRED');
  // Authorized review simulated by a fresh capture — then new edits verify.
  const cap2 = await captureDeliverySnapshot(ctx);
  assert.equal(cap2.status, 'OK');
  writeFileSync(join(ctx.worktreePath, 'src', 'b.ts'), 'y');
  const v = await verifyDeliveryWrites(ctx, cap2.snapshot);
  assert.equal(v.status, 'OK');
});

test('target advance + rebase: incoming target files are not delivery edits', async () => {
  const { dir } = setupConsumer();
  const ctx = await acquireOwned(dir);
  // Delivery commits an in-scope file.
  mkdirSync(join(ctx.worktreePath, 'src'));
  writeFileSync(join(ctx.worktreePath, 'src', 'mine.ts'), 'x');
  git(['add', 'src/mine.ts'], ctx.worktreePath);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'mine'], ctx.worktreePath);
  const cap = await captureDeliverySnapshot(ctx);
  assert.equal(cap.status, 'OK');

  // Main advances with an out-of-scope file; delivery rebases onto it.
  writeFileSync(join(dir, 'upstream.txt'), 'target change');
  git(['add', 'upstream.txt'], dir);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'upstream'], dir);
  git(['rebase', 'main'], ctx.worktreePath);

  // Old baseline is stale (HEAD + resolvedTarget both moved).
  const stale = await verifyDeliveryWrites(ctx, cap.snapshot);
  assert.equal(stale.status, 'BLOCKED');
  assert.equal(stale.code, 'RECOVERY_REQUIRED');
  // Fresh authorized capture: upstream.txt is incoming, not a violation.
  const cap2 = await captureDeliverySnapshot(ctx);
  assert.equal(cap2.status, 'OK', JSON.stringify(cap2));
  // An out-of-scope authored write is still caught after rebase.
  writeFileSync(join(ctx.worktreePath, 'violation.txt'), 'bad');
  const cap3 = await captureDeliverySnapshot(ctx);
  assert.equal(cap3.status, 'BLOCKED');
  assert.equal(cap3.code, 'SCOPE_CONFLICT');
});

test('ownership transitions invalidate verification', async () => {
  const { dir } = setupConsumer();
  const ctx = await acquireOwned(dir);
  const cap = await captureDeliverySnapshot(ctx);
  assert.equal(cap.status, 'OK');
  // Lost-token resume rotates token + generation — old context is fenced.
  const res = await runSessionCommand('resume', {
    repositoryPath: dir,
    deliveryId: 'demo',
    expectedGeneration: 1,
    approval: APPROVAL,
    stoppedConfirmation: STOPPED,
  });
  assert.equal(res.status, 'OK');
  const stale = await verifyDeliveryWrites(ctx, cap.snapshot);
  assert.equal(stale.status, 'BLOCKED');
  assert.equal(stale.code, 'OWNER_MISMATCH');
  // New owner + fresh baseline works.
  const ctx2 = { ...ctx, ownerToken: res.ownerToken, generation: res.generation };
  const cap2 = await captureDeliverySnapshot(ctx2);
  assert.equal(cap2.status, 'OK');
  const v = await verifyDeliveryWrites(ctx2, cap2.snapshot);
  assert.equal(v.status, 'OK');
});

test('index-only staged change without worktree bytes is still authored', async () => {
  const { dir } = setupConsumer();
  const ctx = await acquireOwned(dir);
  // In-scope tracked file first so both cases exercise the same shape.
  mkdirSync(join(ctx.worktreePath, 'src'));
  writeFileSync(join(ctx.worktreePath, 'src', 'tracked.ts'), 'v1');
  git(['add', 'src/tracked.ts'], ctx.worktreePath);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'seed'], ctx.worktreePath);
  const cap = await captureDeliverySnapshot(ctx);
  assert.equal(cap.status, 'OK');

  // Out-of-scope: stage new bytes, then restore worktree bytes to HEAD so
  // `git diff HEAD` is empty while the index still differs.
  writeFileSync(join(ctx.worktreePath, 'keep.txt'), 'staged-out-of-scope');
  git(['add', 'keep.txt'], ctx.worktreePath);
  git(['restore', '--worktree', '--source=HEAD', 'keep.txt'], ctx.worktreePath);
  const capBlock = await captureDeliverySnapshot(ctx);
  assert.equal(capBlock.status, 'BLOCKED');
  assert.equal(capBlock.code, 'SCOPE_CONFLICT');
  const vBlock = await verifyDeliveryWrites(ctx, cap.snapshot);
  assert.equal(vBlock.status, 'BLOCKED');
  assert.equal(vBlock.code, 'SCOPE_CONFLICT');
  assert.ok(vBlock.violations.some((x) => x.path === 'keep.txt'), JSON.stringify(vBlock.violations));

  // Scoped analog: identical index-only shape inside scope passes.
  git(['checkout', 'HEAD', '--', 'keep.txt'], ctx.worktreePath);
  writeFileSync(join(ctx.worktreePath, 'src', 'tracked.ts'), 'staged-in-scope');
  git(['add', 'src/tracked.ts'], ctx.worktreePath);
  git(['restore', '--worktree', '--source=HEAD', 'src/tracked.ts'], ctx.worktreePath);
  const cap2 = await captureDeliverySnapshot(ctx);
  assert.equal(cap2.status, 'OK', JSON.stringify(cap2));
  const v2 = await verifyDeliveryWrites(ctx, cap2.snapshot);
  assert.equal(v2.status, 'OK', JSON.stringify(v2));
});

test('in-scope tracked deletion fingerprints as missing and verifies', async () => {
  const { dir } = setupConsumer();
  const ctx = await acquireOwned(dir);
  mkdirSync(join(ctx.worktreePath, 'src'));
  writeFileSync(join(ctx.worktreePath, 'src', 'del.ts'), 'gone');
  git(['add', 'src/del.ts'], ctx.worktreePath);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'seed'], ctx.worktreePath);
  const cap = await captureDeliverySnapshot(ctx);
  assert.equal(cap.status, 'OK');
  assert.equal(cap.snapshot.files['src/del.ts'].t, 'f');

  rmSync(join(ctx.worktreePath, 'src', 'del.ts'));
  const cap2 = await captureDeliverySnapshot(ctx);
  assert.equal(cap2.status, 'OK', JSON.stringify(cap2));
  assert.deepEqual(cap2.snapshot.files['src/del.ts'], { t: 'missing' });
  const v = await verifyDeliveryWrites(ctx, cap2.snapshot);
  assert.equal(v.status, 'OK', JSON.stringify(v));
});

test('gitlink directory fingerprint is accepted and stable', async () => {
  const { dir, baseCommit } = setupConsumer();
  const ctx = await acquireOwned(dir);
  // An uninitialized submodule entry is a directory/gitlink in ls-files.
  git(
    ['update-index', '--add', '--cacheinfo', `160000,${baseCommit},submod`],
    ctx.worktreePath,
  );
  mkdirSync(join(ctx.worktreePath, 'submod'));
  const cap = await captureDeliverySnapshot(ctx);
  // submod is out-of-scope authored state — capture must still refuse it,
  // proving the gitlink is enumerated rather than silently skipped.
  assert.equal(cap.status, 'BLOCKED');
  assert.equal(cap.code, 'SCOPE_CONFLICT');
});

test('__proto__ and unusual filenames fingerprint as own keys', async () => {
  const { dir } = setupConsumer();
  const ctx = await acquireOwned(dir);
  mkdirSync(join(ctx.worktreePath, 'src'));
  writeFileSync(join(ctx.worktreePath, 'src', '__proto__'), 'x');
  writeFileSync(join(ctx.worktreePath, 'src', 'file with spaces & ünicode.txt'), 'y');
  const cap = await captureDeliverySnapshot(ctx);
  assert.equal(cap.status, 'OK', JSON.stringify(cap));
  assert.equal(Object.hasOwn(cap.snapshot.files, 'src/__proto__'), true);
  assert.equal(cap.snapshot.files['src/__proto__'].t, 'f');
  const v = await verifyDeliveryWrites(ctx, cap.snapshot);
  assert.equal(v.status, 'OK', JSON.stringify(v));
});

test('unchanged ignored preexisting files are baseline, not authored edits', async () => {
  const { dir } = setupConsumer();
  const ctx = await acquireOwned(dir);
  mkdirSync(join(ctx.worktreePath, 'ignored-dir'));
  writeFileSync(join(ctx.worktreePath, 'ignored-dir', 'dep.bin'), 'dependency');
  const cap = await captureDeliverySnapshot(ctx);
  assert.equal(cap.status, 'OK', JSON.stringify(cap));
  // Untouched ignored file: verify clean.
  const v = await verifyDeliveryWrites(ctx, cap.snapshot);
  assert.equal(v.status, 'OK', JSON.stringify(v));
});

test('index suppression never hides out-of-scope tracked writes', async () => {
  for (const flag of ['--assume-unchanged', '--skip-worktree']) {
    const { dir } = setupConsumer();
    const ctx = await acquireOwned(dir);
    const cap = await captureDeliverySnapshot(ctx);
    assert.equal(cap.status, 'OK');
    git(['update-index', flag, 'keep.txt'], ctx.worktreePath);
    writeFileSync(join(ctx.worktreePath, 'keep.txt'), 'hidden modification');
    for (const result of [
      await captureDeliverySnapshot(ctx),
      await verifyDeliveryWrites(ctx, cap.snapshot),
    ]) {
      assert.equal(result.status, 'BLOCKED', `${flag}: ${JSON.stringify(result)}`);
      assert.equal(result.code, 'SCOPE_CONFLICT');
    }
    assert.equal(
      readFileSync(join(ctx.worktreePath, 'keep.txt'), 'utf8'),
      'hidden modification',
    );
  }
});

test('baseline content hashes detect metadata-preserving tracked file changes', async () => {
  const { dir } = setupConsumer();
  const ctx = await acquireOwned(dir, {
    scope: ['keep.txt', '.squad/memory/deliveries/demo.ndjson'],
  });
  const cap = await captureDeliverySnapshot(ctx);
  assert.equal(cap.status, 'OK');
  const file = join(ctx.worktreePath, 'keep.txt');
  const before = statSync(file);
  git(['update-index', '--assume-unchanged', 'keep.txt'], ctx.worktreePath);
  writeFileSync(file, 'changed-bytes');
  utimesSync(file, before.atime, before.mtime);
  assert.equal(git(['diff', '--name-only'], ctx.worktreePath), '');
  assert.equal((await verifyDeliveryWrites(ctx, cap.snapshot)).status, 'OK');
  // A valid Git stat cache can hide bytes even without suppression flags.
  // Fingerprint comparison must independently detect that out-of-scope write.
  const outside = await acquireOwned(setupConsumer().dir);
  const hidden = join(outside.worktreePath, 'keep.txt');
  git(['config', 'core.trustctime', 'false'], outside.worktreePath);
  git(['config', 'core.checkStat', 'minimal'], outside.worktreePath);
  const oldTime = new Date('2000-01-01T00:00:00Z');
  utimesSync(hidden, oldTime, oldTime);
  git(['update-index', '--refresh'], outside.worktreePath);
  const initial = await captureDeliverySnapshot(outside);
  assert.equal(initial.status, 'OK');
  writeFileSync(hidden, 'changed-bytes');
  utimesSync(hidden, oldTime, oldTime);
  assert.equal(git(['ls-files', '-v', '--', 'keep.txt'], outside.worktreePath), 'H keep.txt');
  assert.equal(git(['diff', '--name-only'], outside.worktreePath), '');
  const result = await verifyDeliveryWrites(outside, initial.snapshot);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.violations.some((entry) => entry.path === 'keep.txt'));
});
