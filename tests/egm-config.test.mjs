import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = path.join(ROOT, 'distribution/.squad/schemas/egm-config.schema.json');
const STARTER = path.join(ROOT, 'distribution/.squad/egm.json');
const VALIDATOR = path.join(ROOT, 'scripts/validate-squad-config.mjs');

function validateFile(dataPath) {
  return spawnSync(process.execPath, [VALIDATOR, SCHEMA, dataPath], { encoding: 'utf8' });
}

test('starter egm.json validates with intake_policy null', () => {
  const r = validateFile(STARTER);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const data = JSON.parse(readFileSync(STARTER, 'utf8'));
  assert.equal(data.intake_policy, null);
  assert.equal(data.egm_package_version, '0.1.1');
});

test('intake_policy accepts block and warn', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'egm-cfg-'));
  try {
    for (const policy of ['block', 'warn']) {
      const file = path.join(dir, `egm-${policy}.json`);
      const data = JSON.parse(await readFile(STARTER, 'utf8'));
      data.intake_policy = policy;
      await writeFile(file, JSON.stringify(data, null, 2) + '\n');
      const r = validateFile(file);
      assert.equal(r.status, 0, `${policy}: ${r.stderr || r.stdout}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('intake_policy rejects other values', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'egm-cfg-bad-'));
  try {
    for (const policy of ['allow', '', 'BLOCK', 1, true]) {
      const file = path.join(dir, `bad.json`);
      const data = JSON.parse(await readFile(STARTER, 'utf8'));
      data.intake_policy = policy;
      await writeFile(file, JSON.stringify(data, null, 2) + '\n');
      const r = validateFile(file);
      assert.notEqual(r.status, 0, `expected reject for ${JSON.stringify(policy)}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
