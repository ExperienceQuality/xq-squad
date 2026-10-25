import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, chmodSync, accessSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchMemory } from '../distribution/.squad/scripts/memory-search.mjs';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'xq-squad-'));
  const memoryDir = join(dir, 'memory');
  mkdirSync(memoryDir);
  process.env.SQUAD_MEMORY_DIR = memoryDir;
  return { dir, memoryDir };
}

test('finds keyword match', async () => {
  const { memoryDir } = setup();
  const rec = { id: 'L1', type: 'lesson', topic: 'auth', summary: 'Use JWT for API auth', status: 'active', created_at: '2025-01-01T00:00:00Z' };
  writeFileSync(join(memoryDir, 'lessons.ndjson'), JSON.stringify(rec) + '\n');
  writeFileSync(join(memoryDir, 'delivery-events.ndjson'), '');
  const result = await searchMemory({ keywords: ['JWT'], budget: 1000, memoryDir });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].id, 'L1');
});

test('filters by type', async () => {
  const { memoryDir } = setup();
  const rec1 = { id: 'L1', type: 'lesson', topic: 'a', summary: 'lesson summary', status: 'active', created_at: '2025-01-01T00:00:00Z' };
  const rec2 = { id: 'D1', type: 'delivery_event', topic: 'a', summary: 'delivery summary', status: 'active', created_at: '2025-01-01T00:00:00Z' };
  writeFileSync(join(memoryDir, 'lessons.ndjson'), JSON.stringify(rec1) + '\n');
  writeFileSync(join(memoryDir, 'delivery-events.ndjson'), JSON.stringify(rec2) + '\n');
  const result = await searchMemory({ types: ['delivery_event'], budget: 1000, memoryDir });
  assert.ok(result.records.some(r => r.id === 'D1'));
  assert.ok(!result.records.some(r => r.id === 'L1'));
});

test('respects budget', async () => {
  const { memoryDir } = setup();
  const small = { id: 'S1', type: 'lesson', topic: 'small', summary: 'tiny', status: 'active', created_at: '2025-01-01T00:00:00Z' };
  const big = { id: 'B1', type: 'lesson', topic: 'big', summary: 'x'.repeat(2000), status: 'active', created_at: '2025-01-01T00:00:00Z' };
  writeFileSync(join(memoryDir, 'lessons.ndjson'), JSON.stringify(small) + '\n' + JSON.stringify(big) + '\n');
  const result = await searchMemory({ budget: 100, memoryDir });
  assert.ok(result.records.length === 1);
  assert.equal(result.records[0].id, 'S1');
});

test('returns references', async () => {
  const { memoryDir } = setup();
  const rec = { id: 'L1', type: 'lesson', topic: 'auth', summary: 's', status: 'active', created_at: '2025-01-01T00:00:00Z' };
  writeFileSync(join(memoryDir, 'lessons.ndjson'), JSON.stringify(rec) + '\n');
  writeFileSync(join(memoryDir, 'delivery-events.ndjson'), '');
  const result = await searchMemory({ keywords: ['auth'], budget: 1000, memoryDir });
  assert.ok(result.references.some(r => r.includes('L1')));
});

test('explicit --source reads delivery-local files; defaults unchanged when omitted', async () => {
  const { memoryDir } = setup();
  mkdirSync(join(memoryDir, 'deliveries'));
  const mk = (id, summary) => ({ id, type: 'delivery_event', topic: 'd', summary, status: 'active', created_at: '2025-01-01T00:00:00Z' });
  writeFileSync(join(memoryDir, 'deliveries', 'alpha.ndjson'), JSON.stringify(mk('D-A', 'alpha delivery')) + '\n');
  writeFileSync(join(memoryDir, 'deliveries', 'beta.ndjson'), JSON.stringify(mk('D-B', 'beta delivery')) + '\n');
  writeFileSync(join(memoryDir, 'lessons.ndjson'), JSON.stringify(mk('L9', 'shared lesson')) + '\n');

  // One explicit source sees only that file.
  const one = await searchMemory({ sources: ['deliveries/alpha.ndjson'], budget: 1000, memoryDir });
  assert.deepEqual(one.records.map((r) => r.id), ['D-A']);

  // Two distinct delivery files are independent.
  const both = await searchMemory({ sources: ['deliveries/alpha.ndjson', 'deliveries/beta.ndjson'], budget: 1000, memoryDir });
  assert.deepEqual(both.records.map((r) => r.id).sort(), ['D-A', 'D-B']);

  // Defaults preserved when sources omitted: no delivery files leak in.
  const def = await searchMemory({ budget: 1000, memoryDir });
  assert.deepEqual(def.records.map((r) => r.id), ['L9']);

  // parseSearchArgs mirrors the same behavior.
  const { parseSearchArgs } = await import('../distribution/.squad/scripts/memory-search.mjs');
  const parsed = parseSearchArgs(['--source', 'deliveries/alpha.ndjson', '--source', 'deliveries/beta.ndjson']);
  assert.deepEqual(parsed.sources, ['deliveries/alpha.ndjson', 'deliveries/beta.ndjson']);
  const viaParser = await searchMemory({ ...parsed, memoryDir });
  assert.deepEqual(viaParser.records.map((r) => r.id).sort(), ['D-A', 'D-B']);
  assert.deepEqual(parseSearchArgs(['auth']).sources, ['lessons.ndjson', 'delivery-events.ndjson']);
});

test('invalid sources are rejected lexically and via symlink escape', async () => {
  const { memoryDir, dir } = setup();
  const { parseSearchArgs } = await import('../distribution/.squad/scripts/memory-search.mjs');
  const bad = ['/abs/x.ndjson', '../out.ndjson', 'a/b/../../c.ndjson', 'a\\b', 'x*', 'a//b.ndjson', '.git/x', '', 'a?.ndjson', '.GIT/x', 'a/.GiT/config'];
  for (const src of bad) {
    await assert.rejects(searchMemory({ sources: [src], memoryDir }), /Invalid memory source/, src);
    assert.throws(() => parseSearchArgs(['--source', src]), undefined, src);
  }
  // Symlinked ancestor escaping memoryDir is refused even for an existing file.
  const outside = join(dir, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'esc.ndjson'), JSON.stringify({ id: 'E1', type: 'lesson', topic: 't', summary: 's', status: 'active', created_at: '2025-01-01T00:00:00Z' }) + '\n');
  symlinkSync(outside, join(memoryDir, 'linked'));
  await assert.rejects(searchMemory({ sources: ['linked/esc.ndjson'], memoryDir }), /escapes/);
});

test('broken symlink and unreadable sources fail, never silently empty', async () => {
  const { memoryDir, dir } = setup();
  // Dangling symlink inside memoryDir: cannot be resolved safely — error,
  // not an empty result.
  symlinkSync(join(dir, 'nonexistent-target'), join(memoryDir, 'dangling.ndjson'));
  await assert.rejects(searchMemory({ sources: ['dangling.ndjson'], memoryDir }));

  // Unreadable existing file (skipped on platforms/users where chmod is
  // ineffective, e.g. running as root).
  writeFileSync(
    join(memoryDir, 'lessons.ndjson'),
    JSON.stringify({ id: 'L1', type: 'lesson', topic: 't', summary: 's', status: 'active', created_at: '2025-01-01T00:00:00Z' }) + '\n',
  );
  chmodSync(join(memoryDir, 'lessons.ndjson'), 0o000);
  let readable = true;
  try {
    accessSync(join(memoryDir, 'lessons.ndjson'), constants.R_OK);
  } catch {
    readable = false;
  }
  if (!readable) {
    await assert.rejects(searchMemory({ sources: ['lessons.ndjson'], memoryDir }));
  }
  chmodSync(join(memoryDir, 'lessons.ndjson'), 0o644);
});

test('CLI arg parser: missing values, unknown flags, bad budget are clean errors', async () => {
  const { parseSearchArgs } = await import('../distribution/.squad/scripts/memory-search.mjs');
  for (const args of [['--type'], ['--source'], ['--status'], ['--budget'], ['--budget', 'nan'], ['--budget', '-5'], ['--budget', '2garbage'], ['--budget', '5.5'], ['--budget', '0x10'], ['--bogus']]) {
    assert.throws(() => parseSearchArgs(args), undefined, JSON.stringify(args));
  }
  const p = parseSearchArgs(['auth', '--type', 'lesson', '--budget', '200']);
  assert.deepEqual(p.keywords, ['auth']);
  assert.deepEqual(p.types, ['lesson']);
  assert.equal(p.budget, 200);
});
