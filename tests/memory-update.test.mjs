import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateMemory } from '../distribution/.squad/scripts/memory-update.mjs';

const schema = JSON.stringify({
  type: 'object',
  required: ['id', 'type', 'topic', 'summary', 'status', 'created_at'],
  properties: {
    id: { type: 'string', pattern: '^[A-Za-z0-9_-]+$' },
    type: { type: 'string', enum: ['lesson', 'observation', 'delivery_event', 'decision', 'rejected'] },
    topic: { type: 'string' },
    summary: { type: 'string', maxLength: 500 },
    details: { type: 'string' },
    source: { type: 'string' },
    status: { type: 'string', enum: ['active', 'superseded', 'historical', 'rejected'] },
    created_at: { type: 'string' },
    updated_at: { type: 'string' },
    supersedes: { type: 'array', items: { type: 'string' } }
  },
  additionalProperties: false
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'xq-squad-'));
  writeFileSync(join(dir, 'schema.json'), schema);
  const input = join(dir, 'input.ndjson');
  const output = join(dir, 'output.ndjson');
  return { dir, input, output };
}

test('appends valid record to new file', async () => {
  const { input, output, dir } = setup();
  writeFileSync(input, JSON.stringify({ id: 'L1', type: 'lesson', topic: 't', summary: 's', status: 'active', created_at: '2025-01-01T00:00:00Z' }) + '\n');
  const result = await updateMemory(input, output, { schemaPath: join(dir, 'schema.json') });
  assert.equal(result.ok, true);
  assert.equal(result.updated, 1);
  const content = readFileSync(output, 'utf8');
  assert.match(content, /"id":"L1"/);
});

test('rejects invalid record', async () => {
  const { input, output, dir } = setup();
  writeFileSync(input, JSON.stringify({ id: 'L2', type: 'bad', topic: 't', summary: 's', status: 'active', created_at: '2025-01-01T00:00:00Z' }) + '\n');
  const result = await updateMemory(input, output, { schemaPath: join(dir, 'schema.json') });
  assert.equal(result.ok, false);
});

test('detects duplicate active id', async () => {
  const { input, output, dir } = setup();
  const rec = JSON.stringify({ id: 'L3', type: 'lesson', topic: 't', summary: 's', status: 'active', created_at: '2025-01-01T00:00:00Z' });
  writeFileSync(input, rec + '\n');
  await updateMemory(input, output, { schemaPath: join(dir, 'schema.json') });
  const result = await updateMemory(input, output, { schemaPath: join(dir, 'schema.json') });
  assert.equal(result.ok, false);
});

test('superseded record replaces existing', async () => {
  const { input, output, dir } = setup();
  const oldRec = JSON.stringify({ id: 'L4', type: 'lesson', topic: 't', summary: 'old', status: 'active', created_at: '2025-01-01T00:00:00Z' });
  writeFileSync(input, oldRec + '\n');
  await updateMemory(input, output, { schemaPath: join(dir, 'schema.json') });
  const newRec = JSON.stringify({ id: 'L4', type: 'lesson', topic: 't', summary: 'new', status: 'superseded', created_at: '2025-01-01T00:00:00Z', supersedes: ['L4'] });
  writeFileSync(input, newRec + '\n');
  const result = await updateMemory(input, output, { schemaPath: join(dir, 'schema.json') });
  assert.equal(result.ok, true);
  const content = readFileSync(output, 'utf8');
  assert.match(content, /"status":"superseded"/);
});

test('delivery-local explicit outputPath writes independent files only', async () => {
  const { input, dir } = setup();
  const deliveries = join(dir, 'deliveries');
  mkdirSync(deliveries);
  const deliveryOut = join(deliveries, 'delivery-demo.ndjson');
  const rec = JSON.stringify({ id: 'D1', type: 'delivery_event', topic: 't', summary: 'delivery local', status: 'active', created_at: '2025-01-01T00:00:00Z' });
  writeFileSync(input, rec + '\n');
  const result = await updateMemory(input, deliveryOut, { schemaPath: join(dir, 'schema.json') });
  assert.equal(result.ok, true);
  const content = readFileSync(deliveryOut, 'utf8');
  assert.match(content, /"id":"D1"/);

  // A second delivery-local file stays independent of the first.
  const other = join(deliveries, 'delivery-other.ndjson');
  writeFileSync(input, JSON.stringify({ id: 'D2', type: 'delivery_event', topic: 't', summary: 'other', status: 'active', created_at: '2025-01-01T00:00:00Z' }) + '\n');
  const r2 = await updateMemory(input, other, { schemaPath: join(dir, 'schema.json') });
  assert.equal(r2.ok, true);
  assert.equal(readFileSync(deliveryOut, 'utf8'), content, 'first delivery file untouched');
  assert.match(readFileSync(other, 'utf8'), /"id":"D2"/);

  // The shared store path was never written by these delivery-local updates.
  assert.equal(existsSync(join(dir, 'lessons.ndjson')), false);
});
