import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'distribution');
const { validateAdapters, parseFrontmatter } = await import(path.join(ROOT, 'scripts/validate-cursor-adapter.mjs'));
const gitGuard = await import(path.join(DIST, '.cursor/hooks/xq-squad-git-guard.mjs'));
const scopeGuard = await import(path.join(DIST, '.cursor/hooks/xq-squad-scope-guard.mjs'));
const verify = await import(path.join(DIST, '.cursor/hooks/xq-squad-verify-reminder.mjs'));
const { mergeHooksConfig, mergeCursorHooks } = await import(path.join(DIST, '.squad/scripts/merge-cursor-hooks.mjs'));
const { upgradeManaged } = await import(path.join(DIST, '.squad/scripts/upgrade-managed.mjs'));

const tmp = () => mkdtemp(path.join(tmpdir(), 'xq-cursor-'));
const sha = (s) => createHash('sha256').update(s).digest('hex');

test('distribution adapters validate', () => {
  assert.deepEqual(validateAdapters(DIST), []);
});

test('validator rejects plain .md rules, mismatched skill names, unknown hook events', async () => {
  const d = await tmp();
  await cp(DIST, d, { recursive: true });
  await writeFile(path.join(d, '.cursor/rules/extra.md'), '# ignored by Cursor\n');
  const skill = path.join(d, '.cursor/skills/train-me/SKILL.md');
  await writeFile(skill, (await readFile(skill, 'utf8')).replace('name: train-me', 'name: trainme'));
  const hooks = JSON.parse(await readFile(path.join(d, '.cursor/hooks.json'), 'utf8'));
  hooks.hooks.onCommit = [{ command: 'node .cursor/hooks/xq-squad-git-guard.mjs' }];
  await writeFile(path.join(d, '.cursor/hooks.json'), JSON.stringify(hooks));
  const errors = validateAdapters(d).join('\n');
  assert.match(errors, /extra\.md: Cursor rules must use \.mdc/);
  assert.match(errors, /name must match folder train-me/);
  assert.match(errors, /unsupported event onCommit/);
  await rm(d, { recursive: true, force: true });
});

test('cursor subagents reference canonical contracts and keep governance', async () => {
  for (const role of ['analyst', 'implementer', 'tester', 'reviewer', 'memory-maintainer']) {
    const fm = parseFrontmatter(await readFile(path.join(DIST, `.cursor/agents/${role}.md`), 'utf8'));
    assert.equal(fm.data.name, role);
    assert.match(fm.body, new RegExp(`\\.squad/agents/${role}\\.md`));
    assert.match(fm.body, /Never commit, push, or open a PR/);
  }
  const rule = await readFile(path.join(DIST, '.cursor/rules/xq-squad.mdc'), 'utf8');
  for (const ref of ['.squad/agents/lead.md', '.squad/workflows/delivery.md', '.squad/workflows/concurrent-delivery.md']) {
    assert.ok(rule.includes(ref), `rule references ${ref}`);
    assert.ok(existsSync(path.join(DIST, ref)));
  }
});

test('validator is Cursor-only: rejects devin_profile, Devin runtimes, .devin paths and a shipped .devin/', async () => {
  const d = await tmp();
  await cp(DIST, d, { recursive: true });
  const p = path.join(d, '.squad/squad.json');
  const squad = JSON.parse(readFileSync(p, 'utf8'));
  squad.components.agents.analyst.devin_profile = '../.devin/agents/analyst.md';
  squad.components.skills['train-me'].path = '../.devin/skills/train-me/SKILL.md';
  squad.runtimes.devin = { adapter_root: '../.cursor' };
  squad.ownership.upstream_managed.push('.devin/agents/**');
  await writeFile(p, JSON.stringify(squad));
  await mkdir(path.join(d, '.devin/agents'), { recursive: true });
  await writeFile(path.join(d, '.devin/agents/analyst.md'), 'x\n');
  const errors = validateAdapters(d).join('\n');
  assert.match(errors, /analyst\.devin_profile: Devin keys are not supported/);
  assert.match(errors, /train-me\.path: \.\.\/\.devin\/skills\/train-me\/SKILL\.md points into \.devin\//);
  assert.match(errors, /runtimes\.devin: unsupported runtime/);
  assert.match(errors, /ownership\.upstream_managed: \.devin\/agents/);
  assert.match(errors, /\.devin\/ must not be shipped/);
});

test('canonical .squad contracts are runtime-neutral', async () => {
  for (const rel of ['agents/lead.md', 'workflows/delivery.md', 'workflows/parallel-execution.md', 'workflows/concurrent-delivery.md']) {
    const text = await readFile(path.join(DIST, '.squad', rel), 'utf8');
    assert.doesNotMatch(text, /main Devin session|Separate Devin sessions|two actual Devin sessions/, rel);
  }
});

test('git guard asks for commit/push/PR/release and allows the rest', () => {
  for (const command of ['git commit -m x', 'git -C repo push origin main', 'gh pr create --fill', 'gh release create v1', 'cd a && git commit -am y']) {
    assert.equal(gitGuard.decide({ command }).permission, 'ask', command);
  }
  for (const command of ['git status', 'git log --grep=commit', 'npm test', 'echo push']) {
    assert.equal(gitGuard.decide({ command }).permission, 'allow', command);
  }
  const cfg = JSON.parse(readFileSync(path.join(DIST, '.cursor/hooks.json'), 'utf8'));
  assert.ok(new RegExp(cfg.hooks.beforeShellExecution[0].matcher).test('git commit -m x'));
});


async function stubHelpers(records, status = 'OK', scopeResult = { status: 'OK', code: 'OK' }) {
  const d = await tmp();
  await mkdir(path.join(d, '.squad/scripts'), { recursive: true });
  await writeFile(path.join(d, '.squad/scripts/delivery-registry.mjs'),
    `export async function readRegistry() { return ${JSON.stringify({ status, code: status === 'OK' ? 'OK' : 'REGISTRY_CORRUPT', records })}; }\n`);
  await writeFile(path.join(d, '.squad/scripts/delivery-scope.mjs'),
    `export async function validateWritePaths() { return ${JSON.stringify(scopeResult)}; }\n`);
  return d;
}

test('scope guard: main checkout without deliveries is allowed', async () => {
  const repo = await tmp();
  const helpers = await stubHelpers([]);
  const out = await scopeGuard.decide({ tool_input: { file_path: 'src/a.js' }, workspace_roots: [repo] }, { helpersRoot: helpers });
  assert.equal(out.permission, 'allow');
});

test('scope guard: write in a claimed worktree outside scope is denied', async () => {
  const repo = await tmp();
  const wt = path.join(repo, '.squad/worktrees/d1');
  await mkdir(wt, { recursive: true });
  const rec = { deliveryId: 'd1', state: 'ACTIVE', worktreePath: wt, scope: ['src/a'] };
  const blocked = await stubHelpers([rec], 'OK', { status: 'BLOCKED', code: 'SCOPE_CONFLICT', violations: [{ reason: 'outside scope' }] });
  const out = await scopeGuard.decide({ tool_input: { file_path: path.join(wt, 'src/b.js') }, workspace_roots: [wt] }, { helpersRoot: blocked });
  assert.equal(out.permission, 'deny');
  assert.match(out.agent_message, /outside the claimed scope of d1/);
  const ok = await stubHelpers([rec]);
  const allowed = await scopeGuard.decide({ tool_input: { file_path: 'src/a/x.js' }, workspace_roots: [wt] }, { helpersRoot: ok });
  assert.equal(allowed.permission, 'allow');
});

test('scope guard: session in a worktree cannot write outside it; indeterminate registry fails closed', async () => {
  const repo = await tmp();
  const wt = path.join(repo, '.squad/worktrees/d1');
  await mkdir(wt, { recursive: true });
  const rec = { deliveryId: 'd1', state: 'ACTIVE', worktreePath: wt, scope: ['.'] };
  const helpers = await stubHelpers([rec]);
  const out = await scopeGuard.decide({ tool_input: { file_path: path.join(repo, 'README.md') }, workspace_roots: [wt] }, { helpersRoot: helpers });
  assert.equal(out.permission, 'deny');
  const corrupt = await stubHelpers([], 'ERROR');
  const out2 = await scopeGuard.decide({ tool_input: { file_path: 'x' }, workspace_roots: [wt] }, { helpersRoot: corrupt });
  assert.equal(out2.permission, 'deny');
  const out3 = await scopeGuard.decide({ tool_input: { file_path: 'x' }, workspace_roots: [repo] }, { helpersRoot: corrupt });
  assert.equal(out3.permission, 'allow');
});

test('verify reminder: one follow-up only for dirty delivery worktrees', () => {
  const wt = '/r/.squad/worktrees/d1';
  const dirty = () => ' M a.js\n';
  assert.match(verify.decide({ status: 'completed', loop_count: 0, workspace_roots: [wt] }, { gitStatus: dirty }).followup_message, /d1/);
  assert.deepEqual(verify.decide({ status: 'completed', loop_count: 1, workspace_roots: [wt] }, { gitStatus: dirty }), {});
  assert.deepEqual(verify.decide({ status: 'completed', loop_count: 0, workspace_roots: ['/r'] }, { gitStatus: dirty }), {});
  assert.deepEqual(verify.decide({ status: 'completed', loop_count: 0, workspace_roots: [wt] }, { gitStatus: () => '' }), {});
  assert.deepEqual(verify.decide({ status: 'aborted', loop_count: 0, workspace_roots: [wt] }, { gitStatus: dirty }), {});
});

test('hooks.json merge keeps consumer hooks and replaces squad entries', async () => {
  const dist = { version: 1, hooks: { stop: [{ command: 'node .cursor/hooks/xq-squad-verify-reminder.mjs' }] } };
  const consumer = {
    version: 1,
    extra: true,
    hooks: {
      stop: [{ command: './mine.sh' }, { command: 'node .cursor/hooks/xq-squad-old.mjs' }],
      afterFileEdit: [{ command: './fmt.sh' }],
      preToolUse: [{ command: 'node .cursor/hooks/xq-squad-removed.mjs' }],
    },
  };
  const merged = mergeHooksConfig(consumer, dist);
  assert.equal(merged.extra, true);
  assert.deepEqual(merged.hooks.stop, [{ command: './mine.sh' }, dist.hooks.stop[0]]);
  assert.deepEqual(merged.hooks.afterFileEdit, [{ command: './fmt.sh' }]);
  assert.equal(merged.hooks.preToolUse, undefined);
  assert.deepEqual(mergeHooksConfig(merged, dist), merged, 'idempotent');

  const d = await tmp();
  await writeFile(path.join(d, 'dist.json'), JSON.stringify(dist));
  await writeFile(path.join(d, 'hooks.json'), '{ not json');
  const res = await mergeCursorHooks(path.join(d, 'hooks.json'), path.join(d, 'dist.json'), path.join(d, 'hooks.json'));
  assert.equal(res.status, 'conflict');
  assert.equal(await readFile(path.join(d, 'hooks.json'), 'utf8'), '{ not json');
  assert.ok(existsSync(path.join(d, 'hooks.json.squad-upstream')));
});

async function fixture(files, state) {
  const target = await tmp();
  const next = await tmp();
  for (const [rel, [installed, upstream]] of Object.entries(files)) {
    if (installed !== null) {
      await mkdir(path.dirname(path.join(target, rel)), { recursive: true });
      await writeFile(path.join(target, rel), installed);
    }
    if (upstream !== null) {
      await mkdir(path.dirname(path.join(next, rel)), { recursive: true });
      await writeFile(path.join(next, rel), upstream);
    }
  }
  for (const d of [target, next]) {
    await mkdir(path.join(d, '.squad'), { recursive: true });
    await writeFile(path.join(d, 'AGENTS.md'), '<!-- XQ_SQUAD_MANAGED_START version:v1 -->\nx\n<!-- XQ_SQUAD_MANAGED_END -->\n');
  }
  await writeFile(path.join(target, '.squad/install-state.json'), JSON.stringify({ version: '1.0.0', managed_files: state }));
  return { target, next };
}

test('upgrade: consumer and upstream both changed -> consumer kept, sidecar written, conflict reported, baseline kept', async () => {
  const base = 'line1\nline2\n';
  const { target, next } = await fixture(
    {
      '.cursor/agents/tester.md': ['line1 consumer\nline2\n', 'line1\nline2 upstream\n'],
      '.squad/agents/tester.md': [base, 'new upstream\n'],
      '.squad/README.md': ['consumer only\n', base],
    },
    { '.cursor/agents/tester.md': sha(base), '.squad/agents/tester.md': sha(base), '.squad/README.md': sha(base) },
  );
  const res = await upgradeManaged(target, next, 'v1.1.0');
  assert.deepEqual(res.conflicts.map((c) => c.file), ['.cursor/agents/tester.md']);
  assert.equal(await readFile(path.join(target, '.cursor/agents/tester.md'), 'utf8'), 'line1 consumer\nline2\n');
  assert.equal(await readFile(path.join(target, '.cursor/agents/tester.md.squad-upstream'), 'utf8'), 'line1\nline2 upstream\n');
  assert.equal(await readFile(path.join(target, '.squad/agents/tester.md'), 'utf8'), 'new upstream\n');
  assert.equal(await readFile(path.join(target, '.squad/README.md'), 'utf8'), 'consumer only\n');
  const state = JSON.parse(await readFile(path.join(target, '.squad/install-state.json'), 'utf8'));
  assert.equal(state.managed_files['.cursor/agents/tester.md'], sha(base));
  assert.equal(state.managed_files['.squad/README.md'], sha(base));
  assert.equal(state.managed_files['.squad/agents/tester.md'], sha('new upstream\n'));
});

test('upgrade from a pre-Cursor install adopts .cursor and merges consumer hooks.json', async () => {
  const { target, next } = await fixture(
    {
      '.cursor/agents/tester.md': [null, 'cursor tester\n'],
      '.cursor/rules/local-team.mdc': ['---\ndescription: mine\nalwaysApply: true\n---\n', null],
      '.cursor/rules/xq-squad.mdc': ['consumer rule with same name\n', 'squad rule\n'],
      '.cursor/hooks.json': ['{"version":1,"hooks":{"stop":[{"command":"./mine.sh"}]}}', '{"version":1,"hooks":{"stop":[{"command":"node .cursor/hooks/xq-squad-verify-reminder.mjs"}]}}'],
    },
    {},
  );
  const res = await upgradeManaged(target, next, 'v1.4.0');
  assert.equal(await readFile(path.join(target, '.cursor/agents/tester.md'), 'utf8'), 'cursor tester\n');
  assert.ok(existsSync(path.join(target, '.cursor/rules/local-team.mdc')));
  assert.equal(await readFile(path.join(target, '.cursor/rules/xq-squad.mdc'), 'utf8'), 'consumer rule with same name\n');
  assert.ok(existsSync(path.join(target, '.cursor/rules/xq-squad.mdc.squad-upstream')));
  assert.deepEqual(res.conflicts.map((c) => c.file), ['.cursor/rules/xq-squad.mdc']);
  const hooks = JSON.parse(await readFile(path.join(target, '.cursor/hooks.json'), 'utf8'));
  assert.deepEqual(hooks.hooks.stop.map((h) => h.command), ['./mine.sh', 'node .cursor/hooks/xq-squad-verify-reminder.mjs']);
  const state = JSON.parse(await readFile(path.join(target, '.squad/install-state.json'), 'utf8'));
  assert.ok(state.managed_files['.cursor/agents/tester.md']);
  assert.ok(state.managed_files['.cursor/hooks.json']);
  assert.equal(state.managed_files['.cursor/rules/xq-squad.mdc'], undefined);
  assert.equal(state.managed_files['.cursor/rules/local-team.mdc'], undefined);
});
