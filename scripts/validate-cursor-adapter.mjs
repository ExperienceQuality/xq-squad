// Validates the Cursor and Devin adapters in a distribution directory against
// the documented Cursor formats and the canonical .squad contracts.
// Usage: node scripts/validate-cursor-adapter.mjs <distribution-dir>
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const ROLES = ['analyst', 'implementer', 'tester', 'reviewer', 'memory-maintainer'];
// Hook events from https://cursor.com/docs/agent/hooks
export const HOOK_EVENTS = new Set([
  'sessionStart', 'sessionEnd', 'preToolUse', 'postToolUse', 'postToolUseFailure',
  'subagentStart', 'subagentStop', 'beforeShellExecution', 'afterShellExecution',
  'beforeMCPExecution', 'afterMCPExecution', 'beforeReadFile', 'afterFileEdit',
  'beforeSubmitPrompt', 'preCompact', 'stop', 'afterAgentResponse', 'afterAgentThought',
  'beforeTabFileRead', 'afterTabFileEdit',
]);
const HOOK_ENTRY_KEYS = new Set(['command', 'type', 'prompt', 'matcher', 'timeout', 'failClosed', 'loop_limit', 'model']);

export function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const data = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) data[kv[1]] = kv[2].trim();
  }
  return { data, body: m[2] };
}

export function validateAdapters(dist) {
  const errors = [];
  const err = (m) => errors.push(m);
  const read = (rel) => readFileSync(path.join(dist, rel), 'utf8');
  const has = (rel) => existsSync(path.join(dist, rel));
  const ls = (rel) => (has(rel) ? readdirSync(path.join(dist, rel)) : []);

  for (const f of ls('.cursor/rules')) {
    if (!f.endsWith('.mdc')) { err(`.cursor/rules/${f}: Cursor rules must use .mdc`); continue; }
    const fm = parseFrontmatter(read(`.cursor/rules/${f}`));
    if (!fm) { err(`.cursor/rules/${f}: missing frontmatter`); continue; }
    if (!fm.data.description) err(`.cursor/rules/${f}: missing description`);
    if (!('alwaysApply' in fm.data) && !('globs' in fm.data)) err(`.cursor/rules/${f}: needs alwaysApply or globs`);
    if ('alwaysApply' in fm.data && !['true', 'false'].includes(fm.data.alwaysApply)) err(`.cursor/rules/${f}: alwaysApply must be boolean`);
  }
  if (!has('.cursor/rules/xq-squad.mdc')) err('.cursor/rules/xq-squad.mdc missing');

  for (const role of ROLES) {
    const canonical = `.squad/agents/${role}.md`;
    if (!has(canonical)) err(`${canonical} missing`);
    for (const [runtime, rel] of [['cursor', `.cursor/agents/${role}.md`], ['devin', `.devin/agents/${role}.md`]]) {
      if (!has(rel)) { err(`${rel} missing (${runtime} adapter)`); continue; }
      const fm = parseFrontmatter(read(rel));
      if (!fm) { err(`${rel}: missing frontmatter`); continue; }
      if (fm.data.name !== role) err(`${rel}: name must be ${role}`);
      if (!fm.data.description) err(`${rel}: missing description`);
      if (!fm.body.includes(canonical)) err(`${rel}: must reference ${canonical}`);
      if (runtime === 'cursor' && 'readonly' in fm.data && !['true', 'false'].includes(fm.data.readonly)) err(`${rel}: readonly must be boolean`);
    }
  }

  for (const dir of ls('.cursor/skills')) {
    const rel = `.cursor/skills/${dir}/SKILL.md`;
    if (!statSync(path.join(dist, '.cursor/skills', dir)).isDirectory() || !has(rel)) { err(`${rel} missing`); continue; }
    const fm = parseFrontmatter(read(rel));
    if (!fm) { err(`${rel}: missing frontmatter`); continue; }
    if (fm.data.name !== dir) err(`${rel}: name must match folder ${dir}`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(dir)) err(`${rel}: name must be lowercase-hyphenated`);
    if (!fm.data.description) err(`${rel}: missing description`);
    const devin = `.devin/skills/${dir}/SKILL.md`;
    if (!has(devin)) err(`${rel}: no Devin counterpart ${devin}`);
    else if (parseFrontmatter(read(devin))?.body !== fm.body) err(`${rel}: body differs from ${devin}`);
  }
  for (const dir of ls('.devin/skills')) {
    if (!has(`.cursor/skills/${dir}/SKILL.md`)) err(`.devin/skills/${dir} has no Cursor counterpart`);
  }

  if (!has('.cursor/hooks.json')) err('.cursor/hooks.json missing');
  else {
    let cfg;
    try { cfg = JSON.parse(read('.cursor/hooks.json')); } catch (e) { err(`.cursor/hooks.json: ${e.message}`); }
    if (cfg) {
      if (cfg.version !== 1) err('.cursor/hooks.json: version must be 1');
      for (const [event, entries] of Object.entries(cfg.hooks || {})) {
        if (!HOOK_EVENTS.has(event)) err(`.cursor/hooks.json: unsupported event ${event}`);
        if (!Array.isArray(entries)) { err(`.cursor/hooks.json: ${event} must be an array`); continue; }
        for (const e of entries) {
          for (const k of Object.keys(e)) if (!HOOK_ENTRY_KEYS.has(k)) err(`.cursor/hooks.json: ${event} has unknown key ${k}`);
          const script = /^node (\.cursor\/hooks\/xq-squad-[a-z-]+\.mjs)$/.exec(e.command || '');
          if (!script) err(`.cursor/hooks.json: ${event} command must be "node .cursor/hooks/xq-squad-*.mjs"`);
          else if (!has(script[1])) err(`.cursor/hooks.json: ${script[1]} missing`);
          if (e.matcher !== undefined) { try { new RegExp(e.matcher); } catch { err(`.cursor/hooks.json: bad matcher in ${event}`); } }
        }
      }
    }
  }

  const squad = JSON.parse(read('.squad/squad.json'));
  for (const [kind, group] of Object.entries(squad.components || {})) {
    for (const [name, c] of Object.entries(group)) {
      for (const key of ['path', 'devin_profile', 'cursor_profile', 'cursor_path']) {
        if (c[key] && !existsSync(path.join(dist, '.squad', c[key]))) err(`squad.json ${kind}.${name}.${key}: ${c[key]} missing`);
      }
    }
  }
  for (const [rt, r] of Object.entries(squad.runtimes || {})) {
    if (!existsSync(path.join(dist, '.squad', r.adapter_root))) err(`squad.json runtimes.${rt}: ${r.adapter_root} missing`);
  }
  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const errors = validateAdapters(path.resolve(process.argv[2] || 'distribution'));
  for (const e of errors) console.error(`Error: ${e}`);
  process.exit(errors.length ? 1 : 0);
}
