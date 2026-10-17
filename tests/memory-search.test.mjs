import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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
