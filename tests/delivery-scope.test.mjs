import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  normalizeScope,
  findScopeConflicts,
  validateWritePaths,
} from '../distribution/.squad/scripts/delivery-scope.mjs';

// ---------- normalizeScope ----------

test('normalizeScope accepts file, tree, and root entries sorted and deduplicated', () => {
  assert.deepEqual(normalizeScope(['src/b.ts', 'src/a.ts', 'docs/', '.']), [
    '.',
    'docs/',
    'src/a.ts',
    'src/b.ts',
  ]);
  assert.deepEqual(normalizeScope(['a.txt', 'a.txt']), ['a.txt']);
  assert.deepEqual(normalizeScope(['.squad/memory/deliveries/demo.ndjson']), [
    '.squad/memory/deliveries/demo.ndjson',
  ]);
});

test('normalizeScope deduplicates case-folded and NFC-equivalent entries', () => {
  assert.deepEqual(normalizeScope(['Foo.txt', 'foo.txt']), ['Foo.txt']);
  const nfc = normalizeScope(['café.txt', 'café.txt']);
  assert.equal(nfc.length, 1);
  assert.equal(nfc[0].normalize('NFC'), 'café.txt');
});

test('normalizeScope rejects invalid entries', () => {
  const bad = [
    '/abs/path',
    '../escape',
    'a/../b',
    'a\\b',
    'a//b',
    '',
    'a/./b',
    './a',
    'a*',
    'a?',
    'a[b]',
    'a{b}',
    'x\u0001y',
    '.git',
    '.git/config',
    'x/.git/hooks',
    '.squad/run/',
    '.squad/run/demo.json',
    '.squad/worktrees/',
    '.squad/worktrees/w/f.txt',
    42,
    null,
  ];
  for (const entry of bad) {
    assert.throws(() => normalizeScope([entry]), /invalid scope entry/i, String(entry));
  }
  assert.throws(() => normalizeScope('a.txt'));
});

// ---------- findScopeConflicts ----------

test('findScopeConflicts detects exact file, file-in-tree, and tree ancestor conflicts', () => {
  assert.deepEqual(findScopeConflicts(['a/b.ts'], ['a/b.ts']), [
    { left: 'a/b.ts', right: 'a/b.ts' },
  ]);
  assert.deepEqual(findScopeConflicts(['src/'], ['src/x.ts']), [
    { left: 'src/', right: 'src/x.ts' },
  ]);
  assert.deepEqual(findScopeConflicts(['src/'], ['src/deep/']), [
    { left: 'src/', right: 'src/deep/' },
  ]);
});

test('findScopeConflicts detects same-prefix file/tree and root conflicts', () => {
  assert.deepEqual(findScopeConflicts(['src'], ['src/x.ts']), [
    { left: 'src', right: 'src/x.ts' },
  ]);
  assert.deepEqual(findScopeConflicts(['.'], ['x.ts']), [{ left: '.', right: 'x.ts' }]);
  assert.deepEqual(findScopeConflicts(['.'], ['.']), [{ left: '.', right: '.' }]);
});

test('findScopeConflicts is conservative on case, NFC, sharp-s, and sigma', () => {
  assert.deepEqual(findScopeConflicts(['SRC/X.ts'], ['src/x.ts']), [
    { left: 'SRC/X.ts', right: 'src/x.ts' },
  ]);
  assert.deepEqual(findScopeConflicts(['café/x.ts'], ['café/x.ts']), [
    { left: 'café/x.ts', right: 'café/x.ts' },
  ]);
  assert.deepEqual(findScopeConflicts(['straße/x.ts'], ['strasse/x.ts']), [
    { left: 'straße/x.ts', right: 'strasse/x.ts' },
  ]);
  assert.deepEqual(findScopeConflicts(['σ.txt'], ['ς.txt']), [
    { left: 'σ.txt', right: 'ς.txt' },
  ]);
});

test('findScopeConflicts emits every conflicting pair without key collisions', () => {
  const pairs = findScopeConflicts(['a/', 'a/a/'], ['a/', 'a/a/']);
  assert.equal(pairs.length, 4);
  assert.deepEqual(pairs[0], { left: 'a/', right: 'a/' });
});

test('findScopeConflicts reserves rename source/destination and future paths', () => {
  assert.deepEqual(findScopeConflicts(['a.txt', 'b.txt'], ['b.txt']), [
    { left: 'b.txt', right: 'b.txt' },
  ]);
  assert.deepEqual(findScopeConflicts(['new-dir/'], ['new-dir/future.ts']), [
    { left: 'new-dir/', right: 'new-dir/future.ts' },
  ]);
  assert.deepEqual(findScopeConflicts(['src/'], ['docs/x.md']), []);
  assert.deepEqual(findScopeConflicts(['src/'], ['src-extra/x.md']), []);
});

// ---------- validateWritePaths ----------

function setupWorktree() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'xq-scope-wt-')));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), '');
  writeFileSync(join(root, 'doc.md'), '');
  return root;
}

test('validateWritePaths allows in-scope writes', async () => {
  const wt = setupWorktree();
  const result = await validateWritePaths({
    worktreePath: wt,
    paths: ['src/a.ts', 'doc.md'],
    scope: ['src/', 'doc.md'],
  });
  assert.equal(result.status, 'OK');
});

test('validateWritePaths blocks out-of-scope writes with violations', async () => {
  const wt = setupWorktree();
  const result = await validateWritePaths({
    worktreePath: wt,
    paths: ['other/x.ts'],
    scope: ['src/'],
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.code, 'SCOPE_CONFLICT');
  assert.equal(result.violations.length, 1);
});

test('validateWritePaths never lets root scope enable internal runtime paths', async () => {
  const wt = setupWorktree();
  const result = await validateWritePaths({
    worktreePath: wt,
    paths: ['.git/config', '.squad/run/x.json', '.squad/worktrees/w/f.txt'],
    scope: ['.'],
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.violations.length, 3);
});

test('validateWritePaths rejects descendants of an exact-file scope entry', async () => {
  const wt = setupWorktree();
  const result = await validateWritePaths({
    worktreePath: wt,
    paths: ['doc.md/child'],
    scope: ['doc.md'],
  });
  assert.equal(result.status, 'BLOCKED');
});

test('validateWritePaths reserves nonexistent future paths under a tree', async () => {
  const wt = setupWorktree();
  const result = await validateWritePaths({
    worktreePath: wt,
    paths: ['new-dir/future.ts'],
    scope: ['new-dir/'],
  });
  assert.equal(result.status, 'OK');
});

test('validateWritePaths blocks symlink escapes outside the worktree', async () => {
  const wt = setupWorktree();
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'xq-scope-out-')));
  symlinkSync(outside, join(wt, 'link'));
  const result = await validateWritePaths({
    worktreePath: wt,
    paths: ['link/evil.txt'],
    scope: ['link/'],
  });
  assert.equal(result.status, 'BLOCKED');
});

test('validateWritePaths requires lexical AND resolved coverage for aliases', async () => {
  const wt = setupWorktree();
  mkdirSync(join(wt, 'docs'));
  symlinkSync('src', join(wt, 'alias-src'));
  symlinkSync('docs', join(wt, 'alias-docs'));
  // Lexical path outside declared scope blocks even though real target is covered.
  const lexBlocked = await validateWritePaths({
    worktreePath: wt,
    paths: ['alias-src/b.ts'],
    scope: ['src/'],
  });
  assert.equal(lexBlocked.status, 'BLOCKED');
  // A symlink node write outside lexical scope blocks the same way.
  const nodeBlocked = await validateWritePaths({
    worktreePath: wt,
    paths: ['alias-src'],
    scope: ['src/'],
  });
  assert.equal(nodeBlocked.status, 'BLOCKED');
  // Both lexical and resolved coverage allows the alias.
  const covered = await validateWritePaths({
    worktreePath: wt,
    paths: ['alias-src/b.ts'],
    scope: ['alias-src/', 'src/'],
  });
  assert.equal(covered.status, 'OK');
  // Resolved target outside scope blocks even though lexical path is covered.
  const uncovered = await validateWritePaths({
    worktreePath: wt,
    paths: ['alias-docs/b.md'],
    scope: ['alias-docs/'],
  });
  assert.equal(uncovered.status, 'BLOCKED');
});

test('validateWritePaths refuses broken symlink ancestors and ambiguous case/NFC aliases', async () => {
  const wt = setupWorktree();
  symlinkSync(join(wt, 'no-such-target'), join(wt, 'broken'));
  const broken = await validateWritePaths({
    worktreePath: wt,
    paths: ['broken/x.ts'],
    scope: ['.'],
  });
  assert.equal(broken.status, 'BLOCKED');

  // Case-only alias: on case-insensitive filesystems 'SRC/x.ts' resolves to
  // the existing differently-cased 'src' — an ambiguous write.
  const caseInsensitive = existsSync(join(wt, 'SRC'));
  const caseResult = await validateWritePaths({
    worktreePath: wt,
    paths: ['SRC/x.ts'],
    scope: ['src/'],
  });
  if (caseInsensitive) {
    assert.equal(caseResult.status, 'BLOCKED', 'case-fold alias must be refused');
  } else {
    assert.equal(caseResult.status, 'OK');
  }

  // NFC-only alias: writing the decomposed name that canonically equals the
  // existing composed name is ambiguous where the filesystem normalizes.
  writeFileSync(join(wt, 'café.md'), '');
  const nfcResult = await validateWritePaths({
    worktreePath: wt,
    paths: ['café.md'],
    scope: ['.'],
  });
  const decomposedExists = existsSync(join(wt, 'café.md'));
  if (decomposedExists) {
    assert.equal(nfcResult.status, 'BLOCKED', 'NFC alias must be refused');
  }
});

test('validateWritePaths normalizes a symlinked worktree root (macOS /tmp)', async () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'xq-scope-parent-')));
  const link = join(parent, 'link-dir');
  const real = join(parent, 'real-dir');
  mkdirSync(real);
  mkdirSync(join(real, 'src'));
  symlinkSync(real, link);
  const result = await validateWritePaths({
    worktreePath: link,
    paths: ['src/a.ts'],
    scope: ['src/'],
  });
  assert.equal(result.status, 'OK');
});

test('validateWritePaths handles absolute paths and rejects escapes', async () => {
  const wt = setupWorktree();
  const inside = await validateWritePaths({
    worktreePath: wt,
    paths: [join(wt, 'src', 'a.ts')],
    scope: ['src/'],
  });
  assert.equal(inside.status, 'OK');
  const outside = await validateWritePaths({
    worktreePath: wt,
    paths: [join(realpathSync(tmpdir()), 'elsewhere.txt'), '../x.ts'],
    scope: ['.'],
  });
  assert.equal(outside.status, 'BLOCKED');
  assert.equal(outside.violations.length, 2);
});

test('validateWritePaths reports invalid input as ERROR', async () => {
  const wt = setupWorktree();
  const bad = await validateWritePaths({ worktreePath: wt, paths: 'x.ts', scope: ['.'] });
  assert.equal(bad.status, 'ERROR');
  assert.equal(bad.code, 'INVALID_INPUT');
});

// ---------- schema parse (T1 contract artifact) ----------

test('delivery-session schema is valid JSON with frozen contract fields', async () => {
  const schemaPath = new URL(
    '../distribution/.squad/schemas/delivery-session.schema.json',
    import.meta.url,
  );
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
  assert.equal(schema.additionalProperties, false);
  for (const field of [
    'schemaVersion',
    'deliveryId',
    'ownerToken',
    'generation',
    'state',
    'repositoryRoot',
    'branch',
    'worktreePath',
    'baseRef',
    'baseCommit',
    'scope',
    'createdAt',
    'heartbeatAt',
    'approval',
  ]) {
    assert.ok(schema.required.includes(field), `missing required field ${field}`);
    assert.ok(schema.properties[field], `missing property ${field}`);
  }
  assert.deepEqual(schema.properties.state.enum, [
    'PREPARING',
    'ACTIVE',
    'RECOVERY_REQUIRED',
    'RELEASED',
  ]);
  assert.equal(schema.properties.schemaVersion.const, 1);
  assert.equal(schema.properties.scope.maxItems, 256);
  assert.equal(schema.properties.deliveryId.maxLength, 80);
});
