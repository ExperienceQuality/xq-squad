import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'distribution/.squad/scripts/upgrade-managed.mjs');
const { upgradeManaged, settleRetiredFiles, listRetired, lookupRetired, formatRetiredNotice, parseArgs } = await import(SCRIPT);

const sha = (s) => createHash('sha256').update(s).digest('hex');
const tmp = () => mkdtemp(path.join(tmpdir(), 'xq-retired-'));
const MANIFEST = {
  version: 1,
  retired: [{ prefix: '.devin/', since: '2.0.0', decision: 'D1', reason: 'The Devin adapter was retired: xq-squad supports Cursor only.' }],
};
const OLD_OWNERSHIP = { upstream_managed: ['.devin/agents/**'], merge_managed: [], consumer_owned: ['.devin/rules/local-*', '.devin/agents/local-*'] };
const NEW_OWNERSHIP = { upstream_managed: ['.cursor/agents/**'], merge_managed: [], consumer_owned: ['.cursor/agents/local-*'] };

async function put(root, rel, text) {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), text);
}

// Target with three retired .devin files and one shipped .cursor file.
async function fixture({ edit = false, local = false } = {}) {
  const target = await tmp();
  const next = await tmp();
  const managed = {};
  for (const rel of ['.devin/agents/analyst.md', '.devin/agents/tester.md', '.devin/skills/train-me/SKILL.md', '.cursor/agents/tester.md']) {
    await put(target, rel, `old ${rel}\n`);
    managed[rel] = sha(`old ${rel}\n`);
  }
  if (edit) await put(target, '.devin/skills/train-me/SKILL.md', 'my edit\n');
  if (local) await put(target, '.devin/agents/local-x.md', 'mine\n');
  for (const d of [target, next]) await put(d, 'AGENTS.md', '<!-- XQ_SQUAD_MANAGED_START version:v1 -->\nx\n<!-- XQ_SQUAD_MANAGED_END -->\n');
  await put(next, '.cursor/agents/tester.md', 'new tester\n');
  await put(next, '.squad/retired.json', JSON.stringify(MANIFEST));
  await put(next, '.squad/squad.json', JSON.stringify({ ownership: NEW_OWNERSHIP }));
  await put(target, '.squad/install-state.json', JSON.stringify({ version: '1.4.0', managed_files: managed, ownership: OLD_OWNERSHIP }));
  return { target, next };
}
const readState = async (t) => JSON.parse(await readFile(path.join(t, '.squad/install-state.json'), 'utf8'));

test('lookup: exact path wins over prefixes, longest prefix wins', () => {
  const m = { retired: [{ prefix: '.devin/', reason: 'a' }, { prefix: '.devin/skills/', reason: 'b' }, { path: '.devin/skills/x/SKILL.md', reason: 'c' }] };
  assert.equal(lookupRetired(m, '.devin/skills/x/SKILL.md').reason, 'c');
  assert.equal(lookupRetired(m, '.devin/skills/y/SKILL.md').reason, 'b');
  assert.equal(lookupRetired(m, '.devin/agents/a.md').reason, 'a');
  assert.equal(lookupRetired(m, '.cursor/a.md'), null);
  assert.equal(lookupRetired(null, '.devin/a.md'), null);
});

test('default policy keeps unmodified retired files in retired_files, never in managed_files', async () => {
  const { target, next } = await fixture();
  const res = await upgradeManaged(target, next, 'v2.0.0');
  assert.deepEqual(res.conflicts, []);
  assert.ok(existsSync(path.join(target, '.devin/agents/analyst.md')));
  assert.deepEqual(new Set(res.notices.map((n) => n.kind)), new Set(['retired-kept']));
  const state = await readState(target);
  assert.deepEqual(Object.keys(state.managed_files).filter((k) => k.startsWith('.devin/')), []);
  assert.deepEqual(Object.keys(state.retired_files).sort(), ['.devin/agents/analyst.md', '.devin/agents/tester.md', '.devin/skills/train-me/SKILL.md']);
  assert.equal(state.retired_files['.devin/agents/analyst.md'].since, '2.0.0');
  assert.equal(state.retired_files['.devin/agents/analyst.md'].hash, sha('old .devin/agents/analyst.md\n'));
  assert.deepEqual(state.ownership, NEW_OWNERSHIP, 'ownership refreshed from the new squad.json');
});

test('--retired=remove deletes unmodified files and prunes empty adapter dirs', async () => {
  const { target, next } = await fixture();
  const res = await upgradeManaged(target, next, 'v2.0.0', { retired: 'remove' });
  assert.deepEqual(res.conflicts, []);
  assert.equal(existsSync(path.join(target, '.devin')), false);
  assert.equal(res.notices.filter((n) => n.kind === 'retired-removed').length, 3);
  const state = await readState(target);
  assert.deepEqual(state.retired_files, {});
  assert.equal(await readFile(path.join(target, '.cursor/agents/tester.md'), 'utf8'), 'new tester\n');
});

test('modified retired file is reported, kept and not a conflict (MIG-03)', async () => {
  const { target, next } = await fixture({ edit: true });
  const res = await upgradeManaged(target, next, 'v2.0.0', { retired: 'remove' });
  assert.deepEqual(res.conflicts, []);
  assert.equal(await readFile(path.join(target, '.devin/skills/train-me/SKILL.md'), 'utf8'), 'my edit\n');
  assert.deepEqual(res.notices.filter((n) => n.kind === 'retired-modified').map((n) => n.file), ['.devin/skills/train-me/SKILL.md']);
  const state = await readState(target);
  assert.equal(state.managed_files['.devin/skills/train-me/SKILL.md'], undefined);
  assert.equal(state.retired_files['.devin/skills/train-me/SKILL.md'], undefined);
  const cli = spawnSync(process.execPath, [SCRIPT, target, next, 'v2.0.0'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
});

test('consumer local-* files and missing files are handled without touching consumer data', async () => {
  const { target, next } = await fixture({ local: true });
  const { unlink } = await import('node:fs/promises');
  await unlink(path.join(target, '.devin/agents/tester.md'));
  const res = await upgradeManaged(target, next, 'v2.0.0', { retired: 'remove' });
  assert.equal(await readFile(path.join(target, '.devin/agents/local-x.md'), 'utf8'), 'mine\n');
  assert.deepEqual(res.notices.filter((n) => n.kind === 'retired-missing').map((n) => n.file), ['.devin/agents/tester.md']);
  assert.ok(existsSync(path.join(target, '.devin/agents')), 'non-empty dir kept');
});

test('a managed file with no retired.json entry gets the default reason', async () => {
  const { target, next } = await fixture();
  await put(target, '.squad/old.md', 'old\n');
  const state = await readState(target);
  state.managed_files['.squad/old.md'] = sha('old\n');
  await writeFile(path.join(target, '.squad/install-state.json'), JSON.stringify(state));
  const res = await upgradeManaged(target, next, 'v2.0.0', { retired: 'remove' });
  assert.equal(res.notices.find((n) => n.file === '.squad/old.md').reason, 'No longer shipped in 2.0.0.');
});

test('--list-retired reports state and action and changes nothing', async () => {
  const { target, next } = await fixture({ edit: true });
  const before = await readFile(path.join(target, '.squad/install-state.json'), 'utf8');
  const out = execFileSync(process.execPath, [SCRIPT, target, next, 'v2.0.0', '--list-retired'], { encoding: 'utf8' });
  const rows = out.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => `${r.rel} ${r.state} ${r.action}`).sort(), [
    '.devin/agents/analyst.md unmodified keep',
    '.devin/agents/tester.md unmodified keep',
    '.devin/skills/train-me/SKILL.md modified drop-entry',
  ]);
  assert.equal(await readFile(path.join(target, '.squad/install-state.json'), 'utf8'), before);
  const removeRows = await listRetired(target, next, 'v2.0.0', { retired: 'remove' });
  assert.ok(removeRows.some((r) => r.action === 'remove'));
});

test('--retired-only removes files kept by an earlier upgrade', async () => {
  const { target, next } = await fixture();
  await upgradeManaged(target, next, 'v2.0.0');
  await put(target, '.squad/retired.json', JSON.stringify(MANIFEST));
  const res = await settleRetiredFiles(target, { retired: 'remove' });
  assert.equal(res.notices.filter((n) => n.kind === 'retired-removed').length, 3);
  assert.equal(existsSync(path.join(target, '.devin')), false);
  assert.deepEqual((await readState(target)).retired_files, {});
});

test('deprecation notice matches the spec wording', () => {
  const base = { since: '2.0.0', decision: 'D1', prefix: '.devin/', reason: MANIFEST.retired[0].reason };
  const text = formatRetiredNotice([
    { ...base, file: '.devin/agents/analyst.md', kind: 'retired-removed' },
    { ...base, file: '.devin/agents/tester.md', kind: 'retired-kept' },
    { ...base, file: '.devin/skills/train-me/SKILL.md', kind: 'retired-modified' },
  ], OLD_OWNERSHIP);
  assert.equal(text, [
    'XQ Squad 2.0.0: the Devin adapter was retired (decision D1: xq-squad supports Cursor only).',
    'These files from your previous install are no longer shipped:',
    '  removed   .devin/agents/analyst.md',
    '  kept      .devin/agents/tester.md   (unmodified; rerun update.sh with --remove-retired to delete)',
    '  modified  .devin/skills/train-me/SKILL.md   (retired by D1; keep or delete by hand)',
    'Your own .devin/rules/local-* and .devin/agents/local-* files were not touched.',
    'See "Upgrading from 1.x" in the README.',
  ].join('\n'));
});

test('argument parsing rejects unknown policies and flags', () => {
  assert.equal(parseArgs(['a', 'b', 'v2.0.0', '--retired=remove']).retired, 'remove');
  assert.throws(() => parseArgs(['--retired=delete']));
  assert.throws(() => parseArgs(['--bogus']));
});
