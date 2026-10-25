import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeAgentsContent } from '../distribution/.squad/scripts/merge-agents.mjs';

const distributed = readFileSync(new URL('../distribution/AGENTS.md', import.meta.url), 'utf8');
const managedStart = distributed.indexOf('<!-- XQ_SQUAD_MANAGED_START');
const managedEnd = distributed.indexOf('<!-- XQ_SQUAD_MANAGED_END -->') + '<!-- XQ_SQUAD_MANAGED_END -->'.length;
const managed = distributed.slice(managedStart, managedEnd);
const managedVersion = managed.match(/XQ_SQUAD_MANAGED_START version:(v\d+\.\d+\.\d+)/)[1];

const oldManaged = `<!-- XQ_SQUAD_MANAGED_START version:v1.0.0 -->
old managed content
<!-- XQ_SQUAD_MANAGED_END -->`;

const legacyLead = `# XQ Squad

You are the **Agent Lead** for this repository. Operate from \`.squad/agents/lead.md\` and the delivery workflow in \`.squad/workflows/delivery.md\`. Use the \`squad-delivery\` skill when it helps.

- Read \`.squad/README.md\` for layout and conventions.
- Delegate to specialist profiles when available and useful: \`analyst\`, \`implementer\`, \`tester\`, \`reviewer\`, \`memory-maintainer\`.
- Load only relevant shared memory. Do not load all memory by default.
- Verify changes before reporting success.
- Run memory maintenance before delivery. Report \`UPDATED\`, \`UNCHANGED\`, or \`BLOCKED\`.
- Never push, commit, or open a PR unless explicitly authorized.`;

const oldEmptyManaged = `<!-- XQ_SQUAD_MANAGED_START version:v1.0.4 -->
*Managed by \`ExperienceQuality/xq-squad\`. Updates modify only this section.*
<!-- XQ_SQUAD_MANAGED_END -->`;

function assertLeadCount(content, expected = 1) {
  assert.equal((content.match(/You are the \*\*Agent Lead\*\*/g) || []).length, expected);
}

test('keeps consumer content and appends managed Lead contract when no block exists', () => {
  const result = mergeAgentsContent('# Consumer rules\n\n- Keep this rule\n', managed);
  assert.match(result, /# Consumer rules/);
  assert.match(result, /- Keep this rule/);
  assert.ok(result.indexOf('<!-- XQ_SQUAD_MANAGED_START') > result.indexOf('- Keep this rule'));
  assertLeadCount(result);
});

test('replaces an existing managed block and keeps consumer content', () => {
  const existing = `# Consumer rules\n\n- Keep this rule\n\n${oldManaged}\n`;
  const result = mergeAgentsContent(existing, managed);
  assert.match(result, /# Consumer rules/);
  assert.match(result, /- Keep this rule/);
  assert.doesNotMatch(result, /old managed content/);
  assert.match(result, new RegExp(`XQ_SQUAD_MANAGED_START version:${managedVersion.replace(/\./g, '\\.')}`));
  assertLeadCount(result);
});

test('removes the legacy unmanaged block from a fresh-install shape', () => {
  const existing = `${legacyLead}\n\n${oldEmptyManaged}\n`;
  const result = mergeAgentsContent(existing, managed);
  assert.equal(result, `${managed}\n`);
  assertLeadCount(result);
});

test('removes the legacy block but preserves consumer content before it', () => {
  const existing = `# Consumer Project Rules\n\n- existing consumer rule\n\n${legacyLead}\n\n${oldEmptyManaged}\n`;
  const result = mergeAgentsContent(existing, managed);
  assert.match(result, /^# Consumer Project Rules\n\n- existing consumer rule\n\n<!-- XQ_SQUAD_MANAGED_START/);
  assert.equal((result.match(/^# XQ Squad$/gm) || []).length, 1);
  assert.match(result, /- existing consumer rule/);
  assertLeadCount(result);
});

test('preserves the legacy block when a consumer edited one of its bullets', () => {
  const editedLegacy = legacyLead.replace(
    '- Load only relevant shared memory. Do not load all memory by default.',
    '- Load all memory for this project.'
  );
  const existing = `# Consumer Project Rules\n\n${editedLegacy}\n\n${oldEmptyManaged}\n`;
  const result = mergeAgentsContent(existing, managed);
  assert.ok(result.includes(editedLegacy));
  assert.match(result, /- Load all memory for this project\./);
  assert.match(result, /# XQ Squad/);
  assertLeadCount(result, 2);
});
