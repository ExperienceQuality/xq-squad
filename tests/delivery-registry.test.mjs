import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  existsSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import { realpathSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readRegistry, withRegistryLock } from '../distribution/.squad/scripts/delivery-registry.mjs';

const execFileP = promisify(execFile);
const MODULE_URL = pathToFileURL(
  new URL('../distribution/.squad/scripts/delivery-registry.mjs', import.meta.url).pathname,
).href;
const APPROVAL = { confirmed: true, reference: 'user-message-1' };

function git(args, cwd) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

function setupRepo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'xq-reg-repo-')));
  git(['init', '-b', 'main'], dir);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init'], dir);
  const commonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], dir);
  return { dir, commonDir: realpathSync(commonDir), registryPath: join(realpathSync(commonDir), 'squad', 'run') };
}

function makeRecord(root, over = {}) {
  return {
    schemaVersion: 1,
    deliveryId: 'demo',
    ownerToken: 'tok-secret',
    generation: 1,
    state: 'ACTIVE',
    repositoryRoot: root,
    branch: 'squad/demo',
    worktreePath: join(root, '.squad/worktrees/demo'),
    baseRef: 'main',
    baseCommit: 'a'.repeat(40),
    scope: ['src/'],
    createdAt: '2026-10-24T00:00:00Z',
    heartbeatAt: '2026-10-24T00:00:00Z',
    approval: APPROVAL,
    ...over,
  };
}

async function childLock(repositoryPath) {
  const code = `import(${JSON.stringify(MODULE_URL)}).then(m =>
    m.withRegistryLock({ repositoryPath: ${JSON.stringify(repositoryPath)},
      approval: { confirmed: true, reference: 'child' } }, () => ({ ok: true }))
  ).then(r => console.log(JSON.stringify(r))).catch(e => console.log(JSON.stringify({ threw: String(e) })))`;
  const { stdout } = await execFileP(process.execPath, ['--input-type=module', '-e', code]);
  return JSON.parse(stdout.trim());
}

test('readRegistry returns OK empty on a fresh repo', async () => {
  const { dir } = setupRepo();
  const result = await readRegistry({ repositoryPath: dir });
  assert.equal(result.status, 'OK');
  assert.equal(result.code, 'OK');
  assert.deepEqual(result.records, []);
  assert.ok(result.registryPath.endsWith(join('squad', 'run')));
});

test('main checkout and linked worktree resolve the same registry', async () => {
  const { dir, registryPath } = setupRepo();
  const linked = join(dir, 'linked-wt');
  git(['worktree', 'add', linked, '-b', 'linked'], dir);
  const fromMain = await readRegistry({ repositoryPath: dir });
  const fromLinked = await readRegistry({ repositoryPath: linked });
  assert.equal(fromMain.status, 'OK');
  assert.equal(fromLinked.status, 'OK');
  assert.equal(fromMain.registryPath, registryPath);
  assert.equal(fromLinked.registryPath, registryPath);
  assert.equal(fromMain.commonDir, fromLinked.commonDir);
});

test('absent approval produces BLOCKED and zero filesystem mutations', async () => {
  const { dir, registryPath } = setupRepo();
  const result = await withRegistryLock({ repositoryPath: dir }, () => ({}));
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.code, 'APPROVAL_REQUIRED');
  assert.ok(!existsSync(registryPath), 'registry dir must not be created without approval');
  const bad = await withRegistryLock(
    { repositoryPath: dir, approval: { confirmed: false, reference: 'x' } },
    () => ({}),
  );
  assert.equal(bad.code, 'APPROVAL_REQUIRED');
  assert.ok(!existsSync(registryPath));
});

test('lock operation sees raw claims and writeRecord persists atomically', async () => {
  const { dir, registryPath } = setupRepo();
  const rec = makeRecord(dir);
  const result = await withRegistryLock({ repositoryPath: dir, approval: APPROVAL }, async (ctx) => {
    assert.deepEqual(ctx.records, []);
    assert.equal(typeof ctx.writeRecord, 'function');
    const wr = await ctx.writeRecord(rec);
    assert.equal(wr.status, 'OK');
    return { custom: 'returned' };
  });
  assert.deepEqual(result, { custom: 'returned' });
  assert.ok(existsSync(join(registryPath, 'demo.json')));
  assert.deepEqual(readdirSync(registryPath).filter((n) => n.endsWith('.tmp')), []);

  const read = await readRegistry({ repositoryPath: dir });
  assert.equal(read.status, 'OK');
  assert.equal(read.records.length, 1);
  assert.equal(read.records[0].deliveryId, 'demo');
  assert.equal(read.records[0].ownerToken, undefined, 'status output must redact ownerToken');
  assert.deepEqual(read.records[0].approval, { reference: 'user-message-1' });
});

test('records written earlier are visible raw inside the lock callback', async () => {
  const { dir } = setupRepo();
  const rec = makeRecord(dir);
  await withRegistryLock({ repositoryPath: dir, approval: APPROVAL }, (ctx) =>
    ctx.writeRecord(rec),
  );
  await withRegistryLock({ repositoryPath: dir, approval: APPROVAL }, (ctx) => {
    assert.equal(ctx.records.length, 1);
    assert.equal(ctx.records[0].ownerToken, 'tok-secret', 'raw records keep token inside lock');
  });
});

test('live mutex contention returns BLOCKED in-process and across processes', async () => {
  const { dir } = setupRepo();
  let secondResult;
  await withRegistryLock({ repositoryPath: dir, approval: APPROVAL }, async () => {
    secondResult = await withRegistryLock({ repositoryPath: dir, approval: APPROVAL }, () => ({}));
    const during = await readRegistry({ repositoryPath: dir });
    assert.equal(during.status, 'BLOCKED', 'status must not imply empty while locked');
    const child = await childLock(dir);
    assert.equal(child.status, 'BLOCKED', 'child process contender must lose');
  });
  assert.equal(secondResult.status, 'BLOCKED');
  const child = await childLock(dir);
  assert.equal(child.ok, true, 'child acquires after release');
});

test('stale lock with foreign content fails closed and is never stolen', async () => {
  const { dir, registryPath } = setupRepo();
  mkdirSync(join(registryPath, '.lock'), { recursive: true });
  writeFileSync(join(registryPath, '.lock', 'junk'), 'not ours');
  const locked = await withRegistryLock({ repositoryPath: dir, approval: APPROVAL }, () => ({}));
  assert.equal(locked.status, 'BLOCKED');
  assert.equal(locked.code, 'RECOVERY_REQUIRED');
  const read = await readRegistry({ repositoryPath: dir });
  assert.equal(read.status, 'BLOCKED');
  // Manual inspected recovery: operator removes the stale lock after confirmed stop.
  rmSync(join(registryPath, '.lock'), { recursive: true });
  const after = await withRegistryLock({ repositoryPath: dir, approval: APPROVAL }, () => 'ok');
  assert.equal(after, 'ok');
});

test('corrupt, unknown-version, foreign, and oversized records fail closed', async () => {
  const { dir, registryPath } = setupRepo();
  mkdirSync(registryPath, { recursive: true });
  writeFileSync(join(registryPath, 'demo.json'), '{not json');
  let r = await readRegistry({ repositoryPath: dir });
  assert.equal(r.status, 'BLOCKED');
  assert.equal(r.code, 'RECOVERY_REQUIRED');
  let l = await withRegistryLock({ repositoryPath: dir, approval: APPROVAL }, () => ({}));
  assert.equal(l.status, 'BLOCKED');

  writeFileSync(join(registryPath, 'demo.json'), JSON.stringify(makeRecord(dir, { schemaVersion: 99 })));
  r = await readRegistry({ repositoryPath: dir });
  assert.equal(r.status, 'BLOCKED');

  rmSync(join(registryPath, 'demo.json'));
  writeFileSync(join(registryPath, 'intruder.txt'), 'x');
  r = await readRegistry({ repositoryPath: dir });
  assert.equal(r.status, 'BLOCKED');
  rmSync(join(registryPath, 'intruder.txt'));

  writeFileSync(join(registryPath, 'big.json'), ' '.repeat(70 * 1024));
  r = await readRegistry({ repositoryPath: dir });
  assert.equal(r.status, 'BLOCKED');
});

test('writeRecord enforces schema, bounds, and lock ownership', async () => {
  const { dir, registryPath } = setupRepo();
  const good = makeRecord(dir);
  await withRegistryLock({ repositoryPath: dir, approval: APPROVAL }, async (ctx) => {
    for (const bad of [
      { ...good, state: 'BOGUS' },
      { ...good, extra: 'field' },
      { ...good, generation: 0 },
      { ...good, generation: 1.5 },
      { ...good, baseCommit: 'xyz' },
      { ...good, heartbeatAt: 'not-a-date' },
      { ...good, heartbeatAt: '2025-02-31T00:00:00Z' },
      { ...good, deliveryId: 'a'.repeat(81) },
      { ...good, deliveryId: 'Bad_Id' },
      { ...good, branch: 'other/demo' },
      { ...good, worktreePath: join(dir, '.squad/worktrees/other') },
      { ...good, repositoryRoot: `${dir}/` },
      { ...good, scope: Array(257).fill('x/') },
      { ...good, scope: ['../x'] },
      { ...good, scope: ['src/*/x.ts'] },
      { ...good, scope: ['.squad/run/x.json'] },
      { ...good, approval: { confirmed: true, reference: 'r'.repeat(513) } },
      { ...good, repositoryRoot: 'relative/path' },
      { ...good, state: 'RELEASED' },
      { ...good, ownerToken: 'é'.repeat(40000) },
    ]) {
      const wr = await ctx.writeRecord(bad);
      assert.notEqual(wr.status, 'OK', `must reject ${JSON.stringify(bad).slice(0, 80)}`);
    }
    assert.deepEqual(readdirSync(registryPath).filter((n) => n.endsWith('.json')), []);

    const wr = await ctx.writeRecord({ ...good, state: 'RELEASED', stoppedConfirmation: APPROVAL, stoppedConfirmedAt: '2026-10-24T01:00:00Z', releasedAt: '2026-10-24T01:00:00Z' });
    assert.equal(wr.status, 'OK');
    rmSync(join(registryPath, 'demo.json'));

    // Simulate the mutex being lost mid-operation: writes must not proceed unowned.
    rmSync(join(registryPath, '.lock', 'owner'));
    const orphan = await ctx.writeRecord(good);
    assert.notEqual(orphan.status, 'OK');
  });
});

test('record filename must match its deliveryId (no alias hiding)', async () => {
  const { dir, registryPath } = setupRepo();
  mkdirSync(registryPath, { recursive: true });
  const other = makeRecord(dir, {
    deliveryId: 'other',
    branch: 'squad/other',
    worktreePath: join(dir, '.squad/worktrees/other'),
  });
  writeFileSync(join(registryPath, 'demo.json'), JSON.stringify(other));
  const r = await readRegistry({ repositoryPath: dir });
  assert.equal(r.status, 'BLOCKED');
});

test('registry path as regular file, squad as file, dangling symlink all block', async () => {
  const { dir, commonDir, registryPath } = setupRepo();
  mkdirSync(join(commonDir, 'squad'), { recursive: true });
  writeFileSync(registryPath, 'not a dir');
  let r = await readRegistry({ repositoryPath: dir });
  assert.equal(r.status, 'BLOCKED');
  let l = await withRegistryLock({ repositoryPath: dir, approval: APPROVAL }, () => ({}));
  assert.equal(l.status, 'BLOCKED');
  rmSync(registryPath);

  rmSync(join(commonDir, 'squad'), { recursive: true });
  writeFileSync(join(commonDir, 'squad'), 'not a dir');
  r = await readRegistry({ repositoryPath: dir });
  assert.equal(r.status, 'BLOCKED');
  rmSync(join(commonDir, 'squad'));

  mkdirSync(join(commonDir, 'squad'), { recursive: true });
  symlinkSync(join(commonDir, 'no-such-target'), registryPath);
  r = await readRegistry({ repositoryPath: dir });
  assert.equal(r.status, 'BLOCKED');
});

test('operation never reports success when mutex ownership changed underneath', async () => {
  const { dir, registryPath } = setupRepo();
  const result = await withRegistryLock({ repositoryPath: dir, approval: APPROVAL }, () => {
    // Attacker/crash artifact replaces the ownership marker mid-operation.
    writeFileSync(join(registryPath, '.lock', 'owner'), 'foreign-nonce');
    return 'looks-fine';
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.code, 'OWNER_MISMATCH');
  const marker = readFileSync(join(registryPath, '.lock', 'owner'), 'utf8');
  assert.equal(marker, 'foreign-nonce', 'foreign marker must be preserved');
  rmSync(join(registryPath, '.lock'), { recursive: true }); // test cleanup only
});

test('record file count over 1000 fails closed', async () => {
  const { dir, registryPath } = setupRepo();
  mkdirSync(registryPath, { recursive: true });
  const rec = makeRecord(dir);
  for (let i = 0; i < 1001; i += 1) {
    writeFileSync(join(registryPath, `d${i}.json`), JSON.stringify({ ...rec, deliveryId: `d${i}` }));
  }
  const r = await readRegistry({ repositoryPath: dir });
  assert.equal(r.status, 'BLOCKED');
});

test('callback exceptions propagate honestly and the lock is released', async () => {
  const { dir } = setupRepo();
  await assert.rejects(
    withRegistryLock({ repositoryPath: dir, approval: APPROVAL }, () => {
      throw new Error('boom');
    }),
    /boom/,
  );
  const again = await withRegistryLock({ repositoryPath: dir, approval: APPROVAL }, () => 'free');
  assert.equal(again, 'free');
});

test('symlinked registry directories and record files are refused', async () => {
  const { dir, commonDir } = setupRepo();
  const squadDir = join(commonDir, 'squad');
  mkdirSync(squadDir, { recursive: true });
  const realElsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'xq-reg-else-')));
  symlinkSync(realElsewhere, join(squadDir, 'run'));
  const r = await readRegistry({ repositoryPath: dir });
  assert.equal(r.status, 'BLOCKED');
  rmSync(join(squadDir, 'run'));

  const { dir: dir2, registryPath: rp2 } = setupRepo();
  mkdirSync(rp2, { recursive: true });
  symlinkSync(join(dir2, 'outside-target'), join(rp2, 'demo.json'));
  const r2 = await readRegistry({ repositoryPath: dir2 });
  assert.equal(r2.status, 'BLOCKED');
});

test('readOwnedClaim returns a sanitized claim only for the live owner', async () => {
  const { dir, registryPath } = setupRepo();
  const { readOwnedClaim } = await import(
    '../distribution/.squad/scripts/delivery-registry.mjs'
  );
  const mainRoot = realpathSync(dir);
  const record = makeRecord(mainRoot);
  await withRegistryLock({ repositoryPath: dir, approval: APPROVAL }, async (ctx) => {
    const w = await ctx.writeRecord(record);
    assert.equal(w.status, 'OK');
  });

  const okRead = await readOwnedClaim({
    repositoryPath: dir,
    deliveryId: 'demo',
    ownerToken: 'tok-secret',
    generation: 1,
  });
  assert.equal(okRead.status, 'OK');
  assert.equal(okRead.record.deliveryId, 'demo');
  assert.equal(okRead.record.ownerToken, undefined, 'raw token must not be exposed');
  assert.deepEqual(okRead.record.approval, { reference: 'user-message-1' });

  for (const bad of [
    { ownerToken: 'wrong' },
    { generation: 9 },
    { deliveryId: 'ghost' },
  ]) {
    const r = await readOwnedClaim({
      repositoryPath: dir,
      deliveryId: 'demo',
      ownerToken: 'tok-secret',
      generation: 1,
      ...bad,
    });
    assert.equal(r.status, 'BLOCKED', JSON.stringify(bad));
    assert.equal(r.code, 'OWNER_MISMATCH');
  }
  for (const invalid of [
    { ownerToken: '' },
    { generation: 'x' },
    { deliveryId: 'Bad_Id' },
  ]) {
    const r = await readOwnedClaim({
      repositoryPath: dir,
      deliveryId: 'demo',
      ownerToken: 'tok-secret',
      generation: 1,
      ...invalid,
    });
    assert.equal(r.status, 'ERROR');
    assert.equal(r.code, 'INVALID_INPUT');
  }

  // Non-ACTIVE claims fail ownership; corrupted registry fails closed.
  await withRegistryLock({ repositoryPath: dir, approval: APPROVAL }, async (ctx) => {
    await ctx.writeRecord({ ...record, state: 'RELEASED', generation: 2 });
  });
  const released = await readOwnedClaim({
    repositoryPath: dir,
    deliveryId: 'demo',
    ownerToken: 'tok-secret',
    generation: 2,
  });
  assert.equal(released.code, 'OWNER_MISMATCH');
  writeFileSync(join(registryPath, 'demo.json'), '{oops');
  const corrupt = await readOwnedClaim({
    repositoryPath: dir,
    deliveryId: 'demo',
    ownerToken: 'tok-secret',
    generation: 1,
  });
  assert.equal(corrupt.status, 'BLOCKED');
});

test('readOwnedClaim refuses a schema-valid foreign main-checkout binding', async () => {
  const { dir, registryPath } = setupRepo();
  const { readOwnedClaim } = await import('../distribution/.squad/scripts/delivery-registry.mjs');
  const foreignRoot = join(dir, 'foreign-main');
  const record = makeRecord(foreignRoot);
  const written = await withRegistryLock({ repositoryPath: dir, approval: APPROVAL },
    (ctx) => ctx.writeRecord(record));
  assert.equal(written.status, 'OK');
  const before = readFileSync(join(registryPath, 'demo.json'));
  const result = await readOwnedClaim({
    repositoryPath: dir,
    deliveryId: 'demo',
    ownerToken: record.ownerToken,
    generation: 1,
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.code, 'RECOVERY_REQUIRED');
  assert.deepEqual(readFileSync(join(registryPath, 'demo.json')), before);
});
