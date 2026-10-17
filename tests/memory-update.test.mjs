import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
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
