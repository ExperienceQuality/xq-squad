import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  existsSync,
  rmSync,
  chmodSync,
  cpSync,
  readdirSync,
  readFileSync,
  renameSync,
} from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSessionCommand } from '../distribution/.squad/scripts/delivery-session.mjs';
import { readRegistry, withRegistryLock } from '../distribution/.squad/scripts/delivery-registry.mjs';

const execFileP = promisify(execFile);
const SQUAD_SRC = fileURLToPath(new URL('../distribution/.squad', import.meta.url));
const CLI_PATH = fileURLToPath(
  new URL('../distribution/.squad/scripts/delivery-session.mjs', import.meta.url),
);
const WORKER_PATH = fileURLToPath(
  new URL('./fixtures/concurrent-session-worker.mjs', import.meta.url),
);
const APPROVAL = { confirmed: true, reference: 'user-setup-1' };
const STOPPED = { confirmed: true, reference: 'user-stop-1' };

function git(args, cwd) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

function setupConsumer({ helpers = true } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'xq-session-')));
  git(['init', '-b', 'main'], dir);
  writeFileSync(join(dir, 'keep.txt'), 'tracked-bytes');
  if (helpers) {
    mkdirSync(join(dir, '.squad', 'scripts'), { recursive: true });
    mkdirSync(join(dir, '.squad', 'schemas'), { recursive: true });
    for (const f of readdirSync(join(SQUAD_SRC, 'scripts'))) {
      if (f.endsWith('.mjs')) cpSync(join(SQUAD_SRC, 'scripts', f), join(dir, '.squad', 'scripts', f));
    }
    for (const f of readdirSync(join(SQUAD_SRC, 'schemas'))) {
      if (f.endsWith('.json')) cpSync(join(SQUAD_SRC, 'schemas', f), join(dir, '.squad', 'schemas', f));
    }
    if (helpers === 'old') {
      // Same paths, incompatible older bytes.
      writeFileSync(join(dir, '.squad/scripts/delivery-session.mjs'), '// old helper v0\n');
      writeFileSync(join(dir, '.squad/scripts/delivery-scope.mjs'), '// old scope v0\n');
    }
  }
  git(['add', '-A'], dir);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init'], dir);
  const commonDir = realpathSync(git(['rev-parse', '--path-format=absolute', '--git-common-dir'], dir));
  return {
    dir,
    commonDir,
    baseCommit: git(['rev-parse', 'HEAD'], dir),
    registryPath: join(commonDir, 'squad', 'run'),
  };
}

function acquireReq(dir, over = {}) {
  return {
    repositoryPath: dir,
    deliveryId: 'demo',
    mainCheckoutPath: dir,
    baseRef: 'main',
    scope: ['src/', '.squad/memory/deliveries/demo.ndjson'],
    approval: APPROVAL,
    ...over,
  };
}

function worker(env = {}) {
  const child = spawn(process.execPath, [WORKER_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  let stderr = '';
  let stdout = '';
  child.stderr.on('data', (d) => {
    stderr += d;
  });
  child.stdout.on('data', (d) => {
    stdout += d;
  });
  const ready = new Promise((resolve) => {
    child.stderr.once('data', () => resolve());
  });
  const done = new Promise((resolve, reject) => {
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker exit ${code}: ${stderr}`))));
  });
  return {
    ready,
    async send(command, request, retries = 0) {
      child.stdin.end(JSON.stringify({ command, request, retries }));
      await done;
      return JSON.parse(stdout);
    },
  };
}

// ---------- request validation / approval gate ----------

test('acquire without valid approval creates zero artifacts', async () => {
  const { dir, registryPath } = setupConsumer();
  for (const approval of [
    undefined,
    { confirmed: false, reference: 'x' },
    { confirmed: true },
    { confirmed: true, reference: 'x', extra: 1 },
    ['confirmed', 'reference'],
  ]) {
    const req = acquireReq(dir);
    if (approval === undefined) delete req.approval;
    else req.approval = approval;
    const r = await runSessionCommand('acquire', req);
    assert.equal(r.status, 'BLOCKED', JSON.stringify(approval));
    assert.equal(r.code, 'APPROVAL_REQUIRED');
  }
  assert.ok(!existsSync(registryPath));
  assert.throws(() => git(['rev-parse', '--verify', 'refs/heads/squad/demo'], dir));
  assert.ok(!existsSync(join(dir, '.squad/worktrees/demo')));
});

test('invalid requests return ERROR INVALID_INPUT', async () => {
  const { dir } = setupConsumer();
  assert.equal((await runSessionCommand('bogus', {})).status, 'ERROR');
  // Object.prototype names must not satisfy the command lookup.
  assert.equal((await runSessionCommand('toString', {})).status, 'ERROR');
  assert.equal((await runSessionCommand('toString', {})).code, 'INVALID_INPUT');
  const cases = [
    { ...acquireReq(dir), surprise: 1 },
    acquireReq(dir, { deliveryId: 'Bad_Id' }),
    acquireReq(dir, { deliveryId: 'a'.repeat(81) }),
    acquireReq(dir, { baseRef: '--upload-pack=evil' }),
    acquireReq(dir, { baseRef: 'main\ninjected' }),
    acquireReq(dir, { baseRef: 'x'.repeat(257) }),
    acquireReq(dir, { scope: ['src/'] }),
    acquireReq(dir, { scope: [] }),
    acquireReq(dir, { scope: new Array(300).fill('x') }),
    acquireReq(dir, { scope: ['../x'] }),
    acquireReq(dir, { repositoryPath: 42 }),
    acquireReq(dir, { repositoryPath: null }),
    acquireReq(dir, { mainCheckoutPath: 'relative' }),
  ];
  for (const req of cases) {
    const r = await runSessionCommand('acquire', req);
    assert.equal(r.status, 'ERROR', JSON.stringify(req).slice(0, 100));
    assert.equal(r.code, 'INVALID_INPUT');
  }
  // API-level request bound (same 64 KiB ceiling as the CLI stdin bound).
  const oversized = await runSessionCommand(
    'acquire',
    acquireReq(dir, { scope: ['x'.repeat(70 * 1024)] }),
  );
  assert.equal(oversized.status, 'ERROR');
  assert.equal(oversized.code, 'INVALID_INPUT');
});

// ---------- acquire ----------

test('acquire provisions an isolated worktree and leaves main untouched', async () => {
  const { dir, registryPath } = setupConsumer();
  writeFileSync(join(dir, 'dirty-note.txt'), 'user-untracked');
  writeFileSync(join(dir, 'keep.txt'), 'modified-tracked'); // uncommitted tracked edit
  writeFileSync(join(dir, 'staged.txt'), 'staged-new'); // staged but uncommitted
  git(['add', 'staged.txt'], dir);
  const before = {
    head: git(['rev-parse', 'HEAD'], dir),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], dir),
    status: git(['status', '--porcelain'], dir),
    index: readFileSync(join(dir, '.git', 'index')),
  };
  const r = await runSessionCommand('acquire', acquireReq(dir));
  assert.equal(r.status, 'OK', JSON.stringify(r));
  assert.ok(r.ownerToken);
  assert.equal(r.generation, 1);

  const wt = join(dir, '.squad/worktrees/demo');
  assert.ok(existsSync(wt));
  assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD'], wt), 'squad/demo');
  assert.equal(git(['rev-parse', 'HEAD'], wt), before.head);

  // Main checkout: original HEAD/branch/index bytes and all file bytes
  // (tracked, staged, untracked) unchanged; only exclude metadata is added.
  assert.equal(git(['rev-parse', 'HEAD'], dir), before.head);
  assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD'], dir), before.branch);
  assert.deepEqual(readFileSync(join(dir, '.git', 'index')), before.index);
  assert.equal(git(['status', '--porcelain'], dir), before.status);
  assert.equal(readFileSync(join(dir, 'keep.txt'), 'utf8'), 'modified-tracked');
  assert.equal(readFileSync(join(dir, 'dirty-note.txt'), 'utf8'), 'user-untracked');
  const exclude = readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8');
  assert.ok(exclude.split('\n').includes('/.squad/worktrees/'));
  // Worktree subtree is ignored inside main.
  assert.ok(!git(['status', '--porcelain'], dir).includes('worktrees'));

  const read = await readRegistry({ repositoryPath: dir });
  assert.equal(read.records.length, 1);
  assert.equal(read.records[0].state, 'ACTIVE');
});

test('acquire appends anchored exclude line preserving existing content', async () => {
  const { dir, commonDir } = setupConsumer();
  mkdirSync(join(commonDir, 'info'), { recursive: true });
  writeFileSync(join(commonDir, 'info', 'exclude'), 'custom-rule');
  const r = await runSessionCommand('acquire', acquireReq(dir));
  assert.equal(r.status, 'OK');
  const exclude = readFileSync(join(commonDir, 'info', 'exclude'), 'utf8');
  assert.ok(exclude.startsWith('custom-rule'));
  assert.ok(exclude.split('\n').includes('/.squad/worktrees/'));
});

test('exclude append preserves CRLF content byte-for-byte', async () => {
  const { dir, commonDir } = setupConsumer();
  mkdirSync(join(commonDir, 'info'), { recursive: true });
  const original = 'rule-a\r\nrule-b\r\n';
  writeFileSync(join(commonDir, 'info', 'exclude'), original);
  const r = await runSessionCommand('acquire', acquireReq(dir));
  assert.equal(r.status, 'OK');
  const exclude = readFileSync(join(commonDir, 'info', 'exclude'), 'utf8');
  assert.ok(exclude.startsWith(original));
  assert.ok(exclude.endsWith('/.squad/worktrees/\n'));

  // A preexisting anchored line (any line ending) is not duplicated.
  const { dir: dir2, commonDir: commonDir2 } = setupConsumer();
  mkdirSync(join(commonDir2, 'info'), { recursive: true });
  const withLine = 'x\n/.squad/worktrees/\r\n';
  writeFileSync(join(commonDir2, 'info', 'exclude'), withLine);
  const r2 = await runSessionCommand('acquire', acquireReq(dir2));
  assert.equal(r2.status, 'OK');
  assert.equal(readFileSync(join(commonDir2, 'info', 'exclude'), 'utf8'), withLine);
});

test('symlinked exclude metadata blocks before any mutation', async () => {
  const { dir, commonDir, registryPath } = setupConsumer();
  rmSync(join(commonDir, 'info', 'exclude'), { force: true }); // default template file
  symlinkSync('/dev/null', join(commonDir, 'info', 'exclude'));
  const r = await runSessionCommand('acquire', acquireReq(dir));
  assert.equal(r.status, 'BLOCKED');
  assert.equal(r.code, 'RECOVERY_REQUIRED');
  assert.ok(!existsSync(registryPath));
  assert.throws(() => git(['rev-parse', '--verify', 'refs/heads/squad/demo'], dir));
});

test('dangling symlink at worktree target blocks with no writes', async () => {
  const { dir, registryPath } = setupConsumer();
  mkdirSync(join(dir, '.squad', 'worktrees'), { recursive: true });
  symlinkSync(join(dir, 'nonexistent-target'), join(dir, '.squad', 'worktrees', 'demo'));
  const r = await runSessionCommand('acquire', acquireReq(dir));
  assert.equal(r.status, 'BLOCKED');
  assert.ok(!existsSync(registryPath));
  assert.throws(() => git(['rev-parse', '--verify', 'refs/heads/squad/demo'], dir));
});

test('status redacts tokens and evidence transcripts', async () => {
  const { dir } = setupConsumer();
  const acq = await runSessionCommand('acquire', acquireReq(dir));
  assert.equal(acq.status, 'OK');
  const r = await runSessionCommand('status', { repositoryPath: dir });
  assert.equal(r.status, 'OK');
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].ownerToken, undefined);
  assert.deepEqual(r.records[0].approval, { reference: 'user-setup-1' });
  assert.equal(JSON.stringify(r).includes(acq.ownerToken), false);
});

test('overlapping acquire blocks with no artifacts for the loser', async () => {
  const { dir } = setupConsumer();
  const first = await runSessionCommand('acquire', acquireReq(dir));
  assert.equal(first.status, 'OK');
  const second = await runSessionCommand(
    'acquire',
    acquireReq(dir, {
      deliveryId: 'demo2',
      scope: ['src/nested/', '.squad/memory/deliveries/demo2.ndjson'],
    }),
  );
  assert.equal(second.status, 'BLOCKED');
  assert.equal(second.code, 'SCOPE_CONFLICT');
  assert.ok(second.conflicts.length > 0);
  assert.throws(() => git(['rev-parse', '--verify', 'refs/heads/squad/demo2'], dir));
  assert.ok(!existsSync(join(dir, '.squad/worktrees/demo2')));
  const read = await readRegistry({ repositoryPath: dir });
  assert.equal(read.records.length, 1);
});

test('disjoint and overlapping concurrent acquires behave correctly', async () => {
  const { dir } = setupConsumer();
  // Disjoint concurrent acquires: transient mutex contention retries, both win.
  const w1 = worker();
  const w2 = worker();
  await Promise.all([w1.ready, w2.ready]);
  const [r1, r2] = await Promise.all([
    w1.send('acquire', acquireReq(dir, { deliveryId: 'alpha', scope: ['src/', '.squad/memory/deliveries/alpha.ndjson'] }), 10),
    w2.send('acquire', acquireReq(dir, { deliveryId: 'beta', scope: ['docs/', '.squad/memory/deliveries/beta.ndjson'] }), 10),
  ]);
  assert.equal(r1.status, 'OK');
  assert.equal(r2.status, 'OK');

  // Overlapping concurrent acquires (fresh scope, racing each other only):
  // exactly one winner.
  const w3 = worker();
  const w4 = worker();
  await Promise.all([w3.ready, w4.ready]);
  const [r3, r4] = await Promise.all([
    w3.send('acquire', acquireReq(dir, { deliveryId: 'gamma', scope: ['newdir/', '.squad/memory/deliveries/gamma.ndjson'] }), 10),
    w4.send('acquire', acquireReq(dir, { deliveryId: 'delta', scope: ['newdir/', '.squad/memory/deliveries/delta.ndjson'] }), 10),
  ]);
  const oks = [r3, r4].filter((r) => r.status === 'OK');
  const blocked = [r3, r4].filter((r) => r.status === 'BLOCKED' && r.code === 'SCOPE_CONFLICT');
  assert.equal(oks.length, 1);
  assert.equal(blocked.length, 1);
});

test('acquire fails cleanly on preflight violations', async () => {
  const { dir } = setupConsumer();
  // mainCheckoutPath is a linked worktree, not the main checkout.
  const linked = join(dir, 'linked');
  git(['worktree', 'add', linked, '-b', 'linked'], dir);
  let r = await runSessionCommand('acquire', acquireReq(dir, { mainCheckoutPath: realpathSync(linked) }));
  assert.equal(r.status, 'BLOCKED');

  // Unresolvable base ref.
  r = await runSessionCommand('acquire', acquireReq(dir, { baseRef: 'no-such-ref' }));
  assert.equal(r.status, 'BLOCKED');

  // Existing branch collision.
  git(['branch', 'squad/demo'], dir);
  r = await runSessionCommand('acquire', acquireReq(dir));
  assert.equal(r.status, 'BLOCKED');
  git(['branch', '-D', 'squad/demo'], dir);

  // Existing worktree path collision.
  mkdirSync(join(dir, '.squad', 'worktrees', 'demo'), { recursive: true });
  r = await runSessionCommand('acquire', acquireReq(dir));
  assert.equal(r.status, 'BLOCKED');
  rmSync(join(dir, '.squad', 'worktrees'), { recursive: true });
});

test('acquire without committed helpers blocks before any artifact', async () => {
  for (const helpers of [false, 'old']) {
    const { dir, registryPath } = setupConsumer({ helpers });
    const r = await runSessionCommand('acquire', acquireReq(dir));
    assert.equal(r.status, 'BLOCKED', `helpers=${helpers}`);
    assert.ok(!existsSync(registryPath));
    assert.throws(() => git(['rev-parse', '--verify', 'refs/heads/squad/demo'], dir));
    assert.ok(!existsSync(join(dir, '.squad/worktrees/demo')));
  }
});

test('symlink-bearing scope in the base tree blocks; root scope allowed', async () => {
  const { dir } = setupConsumer();
  mkdirSync(join(dir, 'realsrc'));
  symlinkSync('realsrc', join(dir, 'link-src'));
  git(['add', '-A'], dir);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'link'], dir);
  const r = await runSessionCommand(
    'acquire',
    acquireReq(dir, { scope: ['link-src/', '.squad/memory/deliveries/demo.ndjson'] }),
  );
  assert.equal(r.status, 'BLOCKED');
  const rootScope = await runSessionCommand(
    'acquire',
    acquireReq(dir, { scope: ['.'] }),
  );
  assert.equal(rootScope.status, 'OK');
});

test('transient mutex contention blocks without artifacts; retry succeeds', async () => {
  const { dir } = setupConsumer();
  let during;
  await withRegistryLock({ repositoryPath: dir, approval: APPROVAL }, async () => {
    during = await runSessionCommand('acquire', acquireReq(dir));
  });
  assert.equal(during.status, 'BLOCKED');
  assert.equal(during.code, 'RECOVERY_REQUIRED');
  assert.ok(!existsSync(join(dir, '.squad/worktrees/demo')));
  const r = await runSessionCommand('acquire', acquireReq(dir));
  assert.equal(r.status, 'OK');
});

test('stale claims never expire; partial provisioning failure retains claim', async () => {
  const { dir, registryPath, commonDir } = setupConsumer();
  // Age the claim's heartbeat under an approved lock: staleness never frees
  // the scope.
  const first = await runSessionCommand('acquire', acquireReq(dir));
  assert.equal(first.status, 'OK');
  await withRegistryLock({ repositoryPath: dir, approval: APPROVAL }, async (ctx) => {
    const rec = ctx.records.find((r) => r.deliveryId === 'demo');
    await ctx.writeRecord({ ...rec, heartbeatAt: '2000-01-01T00:00:00Z' });
  });
  const stale = await runSessionCommand(
    'acquire',
    acquireReq(dir, { deliveryId: 'late', scope: ['src/', '.squad/memory/deliveries/late.ndjson'] }),
  );
  assert.equal(stale.status, 'BLOCKED');

  // Deterministic provisioning failure: .git/worktrees as a plain file makes
  // `git worktree add` fail regardless of uid or permissions.
  const adminWt = join(commonDir, 'worktrees');
  rmSync(adminWt, { recursive: true, force: true });
  writeFileSync(adminWt, 'not-a-dir');
  try {
    const r = await runSessionCommand(
      'acquire',
      acquireReq(dir, {
        deliveryId: 'fragile',
        scope: ['other/', '.squad/memory/deliveries/fragile.ndjson'],
      }),
    );
    assert.equal(r.status, 'BLOCKED');
    assert.equal(r.recoveryRequired, true);
    const read = await readRegistry({ repositoryPath: dir });
    const fragile = read.records.find((rec) => rec.deliveryId === 'fragile');
    assert.ok(fragile, 'failed reservation must persist as a claim');
    assert.ok(['PREPARING', 'RECOVERY_REQUIRED'].includes(fragile.state));
    // Its scope still blocks an overlapping newcomer.
    const overlap = await runSessionCommand(
      'acquire',
      acquireReq(dir, { deliveryId: 'rival', scope: ['other/', '.squad/memory/deliveries/rival.ndjson'] }),
    );
    assert.equal(overlap.status, 'BLOCKED');
    assert.equal(overlap.code, 'SCOPE_CONFLICT');
  } finally {
    rmSync(adminWt, { force: true });
  }
  assert.ok(existsSync(registryPath));
});

// ---------- heartbeat / extend ----------

test('heartbeat updates timestamp; stale token or generation fenced', async () => {
  const { dir } = setupConsumer();
  const acq = await runSessionCommand('acquire', acquireReq(dir));
  const before = (await readRegistry({ repositoryPath: dir })).records[0].heartbeatAt;
  const hb = await runSessionCommand('heartbeat', {
    repositoryPath: dir,
    deliveryId: 'demo',
    ownerToken: acq.ownerToken,
    generation: 1,
  });
  assert.equal(hb.status, 'OK');
  const after = (await readRegistry({ repositoryPath: dir })).records[0].heartbeatAt;
  assert.notEqual(after, before);

  for (const mutation of [
    { ownerToken: 'wrong' },
    { generation: 99 },
    { ownerToken: acq.ownerToken, generation: 1, deliveryId: 'ghost' },
  ]) {
    const r = await runSessionCommand('heartbeat', {
      repositoryPath: dir,
      deliveryId: 'demo',
      ownerToken: 'x',
      generation: 1,
      ...mutation,
    });
    assert.equal(r.status, 'BLOCKED');
    assert.equal(r.code, 'OWNER_MISMATCH');
  }
});

test('extend unions scope with checks; no shrink; fencing enforced', async () => {
  const { dir } = setupConsumer();
  const acq = await runSessionCommand('acquire', acquireReq(dir));
  const noApproval = await runSessionCommand('extend', {
    repositoryPath: dir,
    deliveryId: 'demo',
    ownerToken: acq.ownerToken,
    generation: 1,
    scope: ['docs/'],
  });
  assert.equal(noApproval.code, 'APPROVAL_REQUIRED');

  const ext = await runSessionCommand('extend', {
    repositoryPath: dir,
    deliveryId: 'demo',
    ownerToken: acq.ownerToken,
    generation: 1,
    scope: ['docs/', 'src/deep/'],
    approval: { confirmed: true, reference: 'extend-ok' },
  });
  assert.equal(ext.status, 'OK');
  const scope = (await readRegistry({ repositoryPath: dir })).records[0].scope;
  for (const e of ['src/', 'docs/', 'src/deep/', '.squad/memory/deliveries/demo.ndjson']) {
    assert.ok(scope.includes(e), `missing ${e}`);
  }

  // Overlap with another live claim.
  await runSessionCommand('acquire', acquireReq(dir, {
    deliveryId: 'other',
    scope: ['lib/', '.squad/memory/deliveries/other.ndjson'],
  }));
  const clash = await runSessionCommand('extend', {
    repositoryPath: dir,
    deliveryId: 'demo',
    ownerToken: acq.ownerToken,
    generation: 1,
    scope: ['lib/'],
    approval: APPROVAL,
  });
  assert.equal(clash.code, 'SCOPE_CONFLICT');

  const stale = await runSessionCommand('extend', {
    repositoryPath: dir,
    deliveryId: 'demo',
    ownerToken: acq.ownerToken,
    generation: 42,
    scope: ['more/'],
    approval: APPROVAL,
  });
  assert.equal(stale.code, 'OWNER_MISMATCH');
});

test('extend rejects symlink-bearing scope in the current worktree', async () => {
  const { dir } = setupConsumer();
  const acq = await runSessionCommand('acquire', acquireReq(dir));
  const wt = join(dir, '.squad/worktrees/demo');
  symlinkSync(join(wt, 'keep.txt'), join(wt, 'link-out'));
  const r = await runSessionCommand('extend', {
    repositoryPath: dir,
    deliveryId: 'demo',
    ownerToken: acq.ownerToken,
    generation: 1,
    scope: ['link-out'],
    approval: APPROVAL,
  });
  assert.equal(r.status, 'BLOCKED');
});

// ---------- resume / release ----------

test('resume recovers a lost token only with approval + stopped confirmation', async () => {
  const { dir } = setupConsumer();
  const acq = await runSessionCommand('acquire', acquireReq(dir));

  const noEvidence = await runSessionCommand('resume', {
    repositoryPath: dir,
    deliveryId: 'demo',
    expectedGeneration: 1,
  });
  assert.equal(noEvidence.code, 'APPROVAL_REQUIRED');

  const res = await runSessionCommand('resume', {
    repositoryPath: dir,
    deliveryId: 'demo',
    expectedGeneration: 1,
    approval: { confirmed: true, reference: 'resume-ok' },
    stoppedConfirmation: STOPPED,
  });
  assert.equal(res.status, 'OK');
  assert.equal(res.generation, 2);
  assert.ok(res.ownerToken && res.ownerToken !== acq.ownerToken);
  // Recovery returns the same worktree binding fields acquire reports.
  assert.equal(res.worktreePath, acq.worktreePath);
  assert.equal(res.branch, 'squad/demo');
  assert.equal(res.baseCommit, acq.baseCommit);

  // Old token is fenced.
  const oldHb = await runSessionCommand('heartbeat', {
    repositoryPath: dir,
    deliveryId: 'demo',
    ownerToken: acq.ownerToken,
    generation: 1,
  });
  assert.equal(oldHb.code, 'OWNER_MISMATCH');

  // Second resume with the same expected generation loses.
  const dup = await runSessionCommand('resume', {
    repositoryPath: dir,
    deliveryId: 'demo',
    expectedGeneration: 1,
    approval: APPROVAL,
    stoppedConfirmation: STOPPED,
  });
  assert.equal(dup.code, 'OWNER_MISMATCH');
});

test('simultaneous same-generation recoveries: exactly one wins', async () => {
  const { dir } = setupConsumer();
  await runSessionCommand('acquire', acquireReq(dir));
  const w1 = worker();
  const w2 = worker();
  await Promise.all([w1.ready, w2.ready]);
  const req = {
    repositoryPath: dir,
    deliveryId: 'demo',
    expectedGeneration: 1,
    approval: APPROVAL,
    stoppedConfirmation: STOPPED,
  };
  const [r1, r2] = await Promise.all([
    w1.send('resume', req, 5),
    w2.send('resume', req, 5),
  ]);
  const results = [r1, r2];
  assert.equal(results.filter((r) => r.status === 'OK').length, 1);
  assert.equal(results.filter((r) => r.code === 'OWNER_MISMATCH').length, 1);
});

test('release preserves worktree, branch, dirty and untracked files', async () => {
  const { dir } = setupConsumer();
  const acq = await runSessionCommand('acquire', acquireReq(dir));
  const wt = join(dir, '.squad/worktrees/demo');
  writeFileSync(join(wt, 'dirty-tracked.txt'), 'dirty');
  writeFileSync(join(wt, 'keep.txt'), 'modified');
  const rel = await runSessionCommand('release', {
    repositoryPath: dir,
    deliveryId: 'demo',
    expectedGeneration: 1,
    approval: { confirmed: true, reference: 'release-ok' },
    stoppedConfirmation: STOPPED,
  });
  assert.equal(rel.status, 'OK');
  assert.ok(existsSync(join(wt, 'dirty-tracked.txt')));
  assert.equal(readFileSync(join(wt, 'keep.txt'), 'utf8'), 'modified');
  assert.equal(git(['rev-parse', '--verify', 'refs/heads/squad/demo'], dir).length > 0, true);

  const rec = (await readRegistry({ repositoryPath: dir })).records[0];
  assert.equal(rec.state, 'RELEASED');
  assert.ok(rec.releasedAt && rec.stoppedConfirmedAt);
  assert.equal(rec.generation, 2);

  // Old token and stale generation fenced; ID reuse refused.
  const hb = await runSessionCommand('heartbeat', {
    repositoryPath: dir,
    deliveryId: 'demo',
    ownerToken: acq.ownerToken,
    generation: 1,
  });
  assert.equal(hb.code, 'OWNER_MISMATCH');
  const reacquire = await runSessionCommand('acquire', acquireReq(dir));
  assert.equal(reacquire.status, 'BLOCKED');
  const rerel = await runSessionCommand('release', {
    repositoryPath: dir,
    deliveryId: 'demo',
    expectedGeneration: 1,
    approval: APPROVAL,
    stoppedConfirmation: STOPPED,
  });
  assert.equal(rerel.code, 'OWNER_MISMATCH');
});

test('resume cannot proceed when the worktree is missing; release still works', async () => {
  const { dir } = setupConsumer();
  await runSessionCommand('acquire', acquireReq(dir));
  const wt = join(dir, '.squad/worktrees/demo');
  rmSync(wt, { recursive: true, force: true });
  const res = await runSessionCommand('resume', {
    repositoryPath: dir,
    deliveryId: 'demo',
    expectedGeneration: 1,
    approval: APPROVAL,
    stoppedConfirmation: STOPPED,
  });
  assert.equal(res.status, 'BLOCKED');
  assert.equal(res.code, 'RECOVERY_REQUIRED');
  const rel = await runSessionCommand('release', {
    repositoryPath: dir,
    deliveryId: 'demo',
    expectedGeneration: 1,
    approval: APPROVAL,
    stoppedConfirmation: STOPPED,
  });
  assert.equal(rel.status, 'OK');
});

test('resume/release require each evidence field independently and exactly', async () => {
  const { dir } = setupConsumer();
  await runSessionCommand('acquire', acquireReq(dir));
  for (const cmd of ['resume', 'release']) {
    const missing = await runSessionCommand(cmd, {
      repositoryPath: dir,
      deliveryId: 'demo',
      expectedGeneration: 1,
      approval: APPROVAL,
    });
    assert.equal(missing.code, 'APPROVAL_REQUIRED', `${cmd} missing stoppedConfirmation`);
    const missingApproval = await runSessionCommand(cmd, {
      repositoryPath: dir,
      deliveryId: 'demo',
      expectedGeneration: 1,
      stoppedConfirmation: STOPPED,
    });
    assert.equal(missingApproval.code, 'APPROVAL_REQUIRED', `${cmd} missing approval`);
    const extras = await runSessionCommand(cmd, {
      repositoryPath: dir,
      deliveryId: 'demo',
      expectedGeneration: 1,
      approval: { ...APPROVAL, extra: 1 },
      stoppedConfirmation: STOPPED,
    });
    assert.equal(extras.code, 'APPROVAL_REQUIRED', `${cmd} evidence extras`);
  }
});

test('heartbeat and extend reject foreign main-checkout bindings without writes', async () => {
  const { dir, registryPath } = setupConsumer();
  const acquired = await runSessionCommand('acquire', acquireReq(dir));
  assert.equal(acquired.status, 'OK');
  await withRegistryLock({ repositoryPath: dir, approval: APPROVAL }, async (ctx) => {
    const record = ctx.records.find((entry) => entry.deliveryId === 'demo');
    const foreignRoot = join(dir, 'foreign-main');
    const result = await ctx.writeRecord({
      ...record,
      repositoryRoot: foreignRoot,
      worktreePath: join(foreignRoot, '.squad/worktrees/demo'),
    });
    assert.equal(result.status, 'OK');
  });
  const claimPath = join(registryPath, 'demo.json');
  const before = readFileSync(claimPath);
  for (const command of ['heartbeat', 'extend']) {
    const result = await runSessionCommand(command, {
      repositoryPath: dir,
      deliveryId: 'demo',
      ownerToken: acquired.ownerToken,
      generation: acquired.generation,
      ...(command === 'extend' ? { scope: ['docs/'], approval: APPROVAL } : {}),
    });
    assert.equal(result.status, 'BLOCKED', command);
    assert.equal(result.code, 'RECOVERY_REQUIRED', command);
    assert.deepEqual(readFileSync(claimPath), before);
  }
});

test('resume rejects redirected worktree ancestors even with genuine Git identity', async () => {
  const { dir, registryPath } = setupConsumer();
  const acquired = await runSessionCommand('acquire', acquireReq(dir));
  assert.equal(acquired.status, 'OK');
  const parent = join(dir, '.squad/worktrees');
  const relocated = join(dir, '.squad/relocated-worktrees');
  renameSync(parent, relocated);
  symlinkSync(relocated, parent);
  assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD'], acquired.worktreePath), 'squad/demo');
  const claimPath = join(registryPath, 'demo.json');
  const before = readFileSync(claimPath);
  const result = await runSessionCommand('resume', {
    repositoryPath: dir,
    deliveryId: 'demo',
    expectedGeneration: 1,
    approval: APPROVAL,
    stoppedConfirmation: STOPPED,
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.code, 'RECOVERY_REQUIRED');
  assert.deepEqual(readFileSync(claimPath), before);
});

test('extend/acquire race is atomic: exactly one wins the target scope', async () => {
  const { dir } = setupConsumer();
  const acq = await runSessionCommand('acquire', acquireReq(dir));
  assert.equal(acq.status, 'OK');
  const w1 = worker();
  const w2 = worker();
  await Promise.all([w1.ready, w2.ready]);
  const [r1, r2] = await Promise.all([
    w1.send('extend', {
      repositoryPath: dir,
      deliveryId: 'demo',
      ownerToken: acq.ownerToken,
      generation: 1,
      scope: ['target/'],
      approval: APPROVAL,
    }, 10),
    w2.send('acquire', acquireReq(dir, {
      deliveryId: 'rival',
      scope: ['target/', '.squad/memory/deliveries/rival.ndjson'],
    }), 10),
  ]);
  assert.equal([r1, r2].filter((r) => r.status === 'OK').length, 1);
  const loser = [r1, r2].find((r) => r.status !== 'OK');
  assert.equal(loser.status, 'BLOCKED');
  assert.equal(loser.code, 'SCOPE_CONFLICT');
  const recs = (await readRegistry({ repositoryPath: dir })).records;
  const demo = recs.find((r) => r.deliveryId === 'demo');
  const rival = recs.find((r) => r.deliveryId === 'rival');
  const demoHas = demo.scope.includes('target/');
  assert.equal(demoHas !== Boolean(rival && rival.state !== 'RELEASED'), true);
});

test('held activation mutex returns retained-claim BLOCKED; resume recovers', async () => {
  const { dir, registryPath } = setupConsumer();
  // Git shim delays `git worktree add` until a barrier file appears, so the
  // test can deterministically hold the registry mutex across activation.
  const binDir = join(dir, 'shimbin');
  mkdirSync(binDir);
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const shim = join(binDir, 'git');
  writeFileSync(
    shim,
    '#!/bin/sh\ncase " $*" in\n*" worktree add "*)\n  i=0\n' +
      '  while [ ! -f "$SQUAD_BARRIER" ] && [ $i -lt 3000 ]; do sleep 0.01; i=$((i+1)); done\n' +
      '  [ -f "$SQUAD_BARRIER" ] || exit 124\n  ;;\nesac\nexec "$REAL_GIT" "$@"\n',
  );
  chmodSync(shim, 0o755);
  const barrier = join(dir, 'barrier');
  const claimFile = join(registryPath, 'held.json');
  const lockPath = join(registryPath, '.lock');
  const w = worker({
    PATH: `${binDir}:${process.env.PATH}`,
    REAL_GIT: realGit,
    SQUAD_BARRIER: barrier,
  });
  await w.ready;
  const resultP = w.send(
    'acquire',
    acquireReq(dir, {
      deliveryId: 'held',
      scope: ['src/', '.squad/memory/deliveries/held.ndjson'],
    }),
  );
  // Deterministic barrier: claim written + reservation mutex released.
  const deadline = Date.now() + 15000;
  while (!(existsSync(claimFile) && !existsSync(lockPath))) {
    if (Date.now() > deadline) throw new Error('PREPARING claim never appeared');
    await new Promise((r) => setTimeout(r, 10));
  }
  const res = await withRegistryLock({ repositoryPath: dir, approval: APPROVAL }, async () => {
    writeFileSync(barrier, 'go');
    return resultP;
  });
  assert.equal(res.status, 'BLOCKED');
  assert.equal(res.recoveryRequired, true);
  assert.equal(res.deliveryId, 'held');
  const rec = (await readRegistry({ repositoryPath: dir })).records.find(
    (r) => r.deliveryId === 'held',
  );
  assert.equal(rec.state, 'PREPARING');
  assert.ok(existsSync(join(dir, '.squad/worktrees/held')));
  // User-confirmed resume on the same branch/worktree completes recovery.
  const res2 = await runSessionCommand('resume', {
    repositoryPath: dir,
    deliveryId: 'held',
    expectedGeneration: 1,
    approval: APPROVAL,
    stoppedConfirmation: STOPPED,
  });
  assert.equal(res2.status, 'OK');
  assert.equal(res2.generation, 2);
});

test('corrupt registry blocks session operations fail-closed', async () => {
  const { dir, registryPath } = setupConsumer();
  mkdirSync(registryPath, { recursive: true });
  writeFileSync(join(registryPath, 'demo.json'), '{oops');
  for (const cmd of [
    ['status', { repositoryPath: dir }],
    ['acquire', acquireReq(dir)],
    ['heartbeat', { repositoryPath: dir, deliveryId: 'demo', ownerToken: 'x', generation: 1 }],
    [
      'release',
      { repositoryPath: dir, deliveryId: 'demo', expectedGeneration: 1, approval: APPROVAL, stoppedConfirmation: STOPPED },
    ],
  ]) {
    const r = await runSessionCommand(cmd[0], cmd[1]);
    assert.equal(r.status, 'BLOCKED', cmd[0]);
  }
});

// ---------- CLI end-to-end ----------

test('CLI: JSON stdin/stdout contract with exit codes', async () => {
  const { dir } = setupConsumer();
  const run = (args, input) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI_PATH, ...args], {
        cwd: dir,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => {
        stdout += d;
      });
      child.stderr.on('data', (d) => {
        stderr += d;
      });
      child.on('exit', (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(input === undefined ? '' : String(input));
    });

  let out = await run(['status'], '');
  assert.equal(out.code, 0);
  assert.equal(JSON.parse(out.stdout).status, 'OK');

  // Extra argv and inherited-property command names are rejected.
  out = await run(['status', 'extra'], '');
  assert.equal(out.code, 1);
  assert.equal(JSON.parse(out.stdout).code, 'INVALID_INPUT');
  out = await run(['toString'], '');
  assert.equal(out.code, 1);

  out = await run(['status'], '{bad json');
  assert.equal(out.code, 1);
  assert.equal(JSON.parse(out.stdout).code, 'INVALID_INPUT');

  out = await run(['acquire'], JSON.stringify({ ...acquireReq(dir), repositoryPath: undefined }));
  assert.equal(out.code, 0);
  const acq = JSON.parse(out.stdout);
  assert.equal(acq.status, 'OK');
  assert.ok(acq.ownerToken);

  out = await run(['status'], '');
  const status = JSON.parse(out.stdout);
  assert.equal(status.records[0].ownerToken, undefined, 'status must redact token');
  assert.equal(out.stdout.includes('    at '), false, 'no stack traces on stdout');

  const oversized = JSON.stringify(acquireReq(dir, { deliveryId: 'x'.repeat(70 * 1024) }));
  out = await run(['acquire'], oversized);
  assert.equal(out.code, 1);
  assert.equal(JSON.parse(out.stdout).code, 'INVALID_INPUT');
});
