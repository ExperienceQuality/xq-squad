// T8 two-process protocol scenario driver for tests/concurrent-delivery.test.sh.
// Exercises the session protocol across independent worker processes against a
// local consumer fixture with the installed .squad committed. Evidence objects
// here are SCRIPTED SIMULATIONS of user approval — they prove protocol
// behavior only, never real Devin compatibility. Exits 0 on success, 1 on any
// step failure; every child process is reaped.

import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  cpSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSessionCommand } from '../../distribution/.squad/scripts/delivery-session.mjs';
import {
  readRegistry,
  withRegistryLock,
} from '../../distribution/.squad/scripts/delivery-registry.mjs';

const SQUAD_SRC = fileURLToPath(new URL('../../distribution/.squad', import.meta.url));
const WORKER = fileURLToPath(new URL('./concurrent-session-worker.mjs', import.meta.url));
const APPROVAL = { confirmed: true, reference: 'simulated-user-setup' };
const STOPPED = { confirmed: true, reference: 'simulated-user-stopped' };

const children = new Set();
let failed = 0;

function step(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
}

function check(name, cond, detail) {
  step(name, Boolean(cond), detail ? JSON.stringify(detail).slice(0, 200) : '');
  return cond;
}

function git(args, cwd) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

function worker(env = {}) {
  const child = spawn(process.execPath, [WORKER], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  children.add(child);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => {
    stdout += d;
  });
  child.stderr.on('data', (d) => {
    stderr += d;
  });
  const ready = new Promise((resolve) => child.stderr.once('data', resolve));
  const done = new Promise((resolve, reject) => {
    child.on('exit', (code) => {
      children.delete(child);
      code === 0 ? resolve() : reject(new Error(`worker exit ${code}: ${stderr}`));
    });
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

function acquireReq(dir, id, scope, extra = {}) {
  return {
    repositoryPath: dir,
    deliveryId: id,
    mainCheckoutPath: dir,
    baseRef: 'main',
    scope: [...scope, `.squad/memory/deliveries/${id}.ndjson`],
    approval: APPROVAL,
    ...extra,
  };
}

// Simulated user-approved recovery for a result carrying recoveryRequired.
async function recover(dir, result) {
  const res = await runSessionCommand('resume', {
    repositoryPath: dir,
    deliveryId: result.deliveryId,
    expectedGeneration: 1,
    approval: APPROVAL,
    stoppedConfirmation: STOPPED,
  });
  return res;
}

async function main() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'xq-concurrent-')));
  git(['init', '-b', 'main'], dir);
  writeFileSync(join(dir, 'seed.txt'), 'base');
  cpSync(SQUAD_SRC, join(dir, '.squad'), { recursive: true });
  git(['add', '-A'], dir);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init'], dir);
  const commonDir = realpathSync(
    git(['rev-parse', '--path-format=absolute', '--git-common-dir'], dir),
  );
  const registryPath = join(commonDir, 'squad', 'run');
  step(
    'fixture consumer has installed helpers and no registry yet',
    existsSync(join(dir, '.squad/scripts/delivery-session.mjs')) &&
      existsSync(join(dir, '.squad/schemas/delivery-session.schema.json')) &&
      !existsSync(registryPath),
  );

  // ---- overlap: two racing workers, exactly one wins ----
  const w1 = worker();
  const w2 = worker();
  await Promise.all([w1.ready, w2.ready]);
  const overlap = await Promise.all([
    w1.send('acquire', acquireReq(dir, 'alpha', ['src/']), 10),
    w2.send('acquire', acquireReq(dir, 'beta', ['src/']), 10),
  ]);
  // A post-reservation BLOCKED retains the claim — finish it through the
  // user-confirmed recovery path (the worker already exited and was reaped),
  // never blind re-acquire. This is deterministic either way the race lands.
  for (let i = 0; i < overlap.length; i += 1) {
    if (overlap[i].status !== 'OK' && overlap[i].recoveryRequired) {
      overlap[i] = await recover(dir, overlap[i]);
    }
  }
  const winner = overlap.find((r) => r.status === 'OK');
  const loser = overlap.find((r) => r !== winner);
  check('overlapping concurrent acquires: exactly one winner', winner && loser, { winner, loser });
  const regAfterOverlap = await readRegistry({ repositoryPath: dir });
  const actives = regAfterOverlap.records.filter(
    (r) => ['alpha', 'beta'].includes(r.deliveryId) && r.state === 'ACTIVE',
  );
  const wtCount = ['alpha', 'beta'].filter((id) =>
    existsSync(join(dir, '.squad/worktrees', id)),
  ).length;
  check(
    'overlap: exactly one active claim, loser blocked, only winner artifact',
    actives.length === 1 && loser && loser.code === 'SCOPE_CONFLICT' && wtCount === 1,
    loser,
  );

  // ---- disjoint: both deliveries run isolated ----
  const w3 = worker();
  const w4 = worker();
  await Promise.all([w3.ready, w4.ready]);
  const [d1, d2] = await Promise.all([
    w3.send('acquire', acquireReq(dir, 'gamma', ['docs/']), 10),
    w4.send('acquire', acquireReq(dir, 'delta', ['lib/']), 10),
  ]);
  const disjoint = [d1, d2];
  // Activation-time contention is not retryable — simulate user-confirmed
  // resume instead of blind re-acquire.
  for (let i = 0; i < disjoint.length; i += 1) {
    if (disjoint[i].status === 'BLOCKED' && disjoint[i].recoveryRequired) {
      disjoint[i] = await recover(dir, disjoint[i]);
    }
  }
  check('disjoint concurrent deliveries both reach ACTIVE', disjoint.every((r) => r.status === 'OK'), disjoint);
  for (const r of disjoint) {
    if (r.status === 'OK') {
      check(
        `worktree ${r.deliveryId} on its own branch`,
        git(['rev-parse', '--abbrev-ref', 'HEAD'], r.worktreePath) === `squad/${r.deliveryId}`,
      );
    }
  }

  // ---- stale claim still blocks overlap ----
  await withRegistryLock({ repositoryPath: dir, approval: APPROVAL }, async (ctx) => {
    const rec = ctx.records.find((r) => r.deliveryId === 'gamma');
    await ctx.writeRecord({ ...rec, heartbeatAt: '2000-01-01T00:00:00Z' });
  });
  const staleOverlap = await runSessionCommand('acquire', acquireReq(dir, 'late', ['docs/']));
  check(
    'stale (aged) claim still blocks overlapping acquire',
    staleOverlap.status === 'BLOCKED' && staleOverlap.code === 'SCOPE_CONFLICT',
    staleOverlap,
  );

  // ---- lost-token recovery: stop -> resume -> release preserving bytes ----
  const live = disjoint.find((r) => r.status === 'OK' && r.deliveryId === 'gamma');
  if (live) {
    mkdirSync(join(live.worktreePath, 'docs'), { recursive: true });
    writeFileSync(join(live.worktreePath, 'docs', 'in-progress.md'), 'user work');
    const res = await runSessionCommand('resume', {
      repositoryPath: dir,
      deliveryId: 'gamma',
      expectedGeneration: live.generation,
      approval: APPROVAL,
      stoppedConfirmation: STOPPED,
    });
    check('lost-token resume rotates owner + generation', res.status === 'OK' && res.generation === live.generation + 1, res);
    if (res.status === 'OK') {
      const rel = await runSessionCommand('release', {
        repositoryPath: dir,
        deliveryId: 'gamma',
        expectedGeneration: res.generation,
        approval: APPROVAL,
        stoppedConfirmation: STOPPED,
      });
      check('release tombstones the claim', rel.status === 'OK', rel);
      check(
        'release preserves worktree bytes (dirty/untracked)',
        readFileSync(join(live.worktreePath, 'docs', 'in-progress.md'), 'utf8') === 'user work' &&
          git(['rev-parse', '--verify', 'refs/heads/squad/gamma'], dir).length > 0,
      );
    }
  }

  // ---- shared registry visible from a linked worktree root ----
  const linked = join(dir, 'linked-checkout');
  git(['worktree', 'add', linked, '-b', 'linked'], dir);
  const linkedStatus = await runSessionCommand('status', { repositoryPath: realpathSync(linked) });
  check(
    'linked worktree root sees the same registry claims',
    linkedStatus.status === 'OK' &&
      linkedStatus.records.some((r) => r.deliveryId === 'alpha' || r.deliveryId === 'delta') &&
      linkedStatus.records.every((r) => r.ownerToken === undefined),
    { count: linkedStatus.records?.length },
  );

  // ---- no leftover lock or mutex artifact ----
  check('no leftover registry mutex', !existsSync(join(registryPath, '.lock')));

  await Promise.allSettled([...children].map((c) => new Promise((r) => c.on('exit', r))));
  return failed;
}

main()
  .then((n) => {
    console.log(n === 0 ? 'SCENARIO OK' : `SCENARIO FAILED (${n})`);
    process.exit(n === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.log(`SCENARIO ERROR ${err && err.stack ? err.stack : err}`);
    process.exit(1);
  });
