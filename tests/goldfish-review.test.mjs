import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'distribution');

test('goldfish review contract files and retired reviewer subagent', async () => {
  const workflow = await readFile(path.join(DIST, '.squad/workflows/goldfish-review.md'), 'utf8');
  assert.match(workflow, /XQ_SQUAD_GOLDFISH_REVIEW_PACKET/);
  assert.match(workflow, /### User request/);
  assert.match(workflow, /### Acceptance criteria/);
  assert.match(workflow, /### Diff/);
  assert.match(workflow, /### Test commands/);
  assert.match(workflow, /side chat/i);
  assert.match(workflow, /Task subagent/i);

  const lead = await readFile(path.join(DIST, '.squad/agents/lead.md'), 'utf8');
  assert.match(lead, /REVIEW/);
  assert.match(lead, /goldfish-review/);
  assert.match(lead, /never embody the reviewer/i);
  assert.match(lead, /except.*reviewer/i);

  const rule = await readFile(path.join(DIST, '.cursor/rules/xq-squad.mdc'), 'utf8');
  assert.doesNotMatch(rule, /reviewer.*subagents in/);
  assert.match(rule, /goldfish-review/);

  const retired = JSON.parse(await readFile(path.join(DIST, '.squad/retired.json'), 'utf8'));
  assert.ok(
    retired.retired.some((e) => e.path === '.cursor/agents/reviewer.md' && e.since === '3.0.0'),
  );

  const skill = await readFile(path.join(DIST, '.cursor/skills/goldfish-review/SKILL.md'), 'utf8');
  assert.match(skill, /not\*\* the Agent/);
  assert.match(skill, /goldfish-review/);
});