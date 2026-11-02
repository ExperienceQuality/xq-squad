import { readFile, writeFile, rename, mkdir, copyFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname, relative, sep } from 'node:path';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

async function hashFile(path) {
  const hash = createHash('sha256');
  const { createReadStream } = await import('node:fs');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function readTextOrNull(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(dir) {
  const files = [];
  const stack = [dir];
  const { readdir } = await import('node:fs/promises');
  while (stack.length) {
    const current = stack.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else files.push(path);
    }
  }
  return files.sort();
}

function atomicWrite(filePath, content) {
  const tmp = join(dirname(filePath), `.${filePath.split('/').pop()}.tmp`);
  return writeFile(tmp, content, 'utf8').then(() => rename(tmp, filePath));
}

// Merge-managed files have dedicated merge logic and are skipped by the
// generic hash-based upgrade.
const MERGE_MANAGED = new Set(['AGENTS.md', '.cursor/hooks.json']);
const UPSTREAM_SUFFIX = '.squad-upstream';
const RETIRED_POLICIES = new Set(['remove', 'keep']);

async function readJsonOrNull(path) {
  const text = await readTextOrNull(path);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') { re += '.*'; i++; }
    else if (ch === '*') re += '[^/]*';
    else re += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

// Retired-file lookup: exact `path` entry first, then the longest `prefix`.
export function lookupRetired(manifest, rel) {
  const entries = Array.isArray(manifest?.retired) ? manifest.retired : [];
  const exact = entries.find((e) => e.path === rel);
  if (exact) return exact;
  let best = null;
  for (const e of entries) {
    if (typeof e.prefix === 'string' && rel.startsWith(e.prefix) && (!best || e.prefix.length > best.prefix.length)) best = e;
  }
  return best;
}

function retiredReason(entry, versionNumber) {
  return entry?.reason || `No longer shipped in ${versionNumber}.`;
}

// Delete now-empty parent directories up to the top-level adapter directory.
// rmdir fails on a non-empty directory, so consumer files are never removed.
async function pruneEmptyParents(targetDir, rel) {
  const { rmdir } = await import('node:fs/promises');
  let dir = dirname(rel);
  while (dir && dir !== '.' && dir !== '/') {
    try {
      await rmdir(join(targetDir, dir));
    } catch {
      return;
    }
    dir = dirname(dir);
  }
}

async function classifyRetired(targetDir, rel, baselineHash, isConsumerOwned) {
  if (isConsumerOwned(rel)) return 'consumer-owned';
  const path = join(targetDir, rel);
  if (!(await exists(path))) return 'missing';
  return (await hashFile(path)) === baselineHash ? 'unmodified' : 'modified';
}

const RETIRED_ACTIONS = {
  missing: () => 'drop-entry',
  unmodified: (policy) => (policy === 'remove' ? 'remove' : 'keep'),
  modified: () => 'drop-entry',
  'consumer-owned': () => 'skip',
};

// Applies the retired-file policy to one file. Returns the notice (or null)
// and the retired_files entry to keep (or null).
async function settleRetired(targetDir, rel, baselineHash, entry, policy, versionNumber, isConsumerOwned) {
  const state = await classifyRetired(targetDir, rel, baselineHash, isConsumerOwned);
  const reason = retiredReason(entry, versionNumber);
  const since = entry?.since || versionNumber;
  const base = { file: rel, reason, since, decision: entry?.decision || null, prefix: entry?.prefix || null };
  if (state === 'consumer-owned') return { state, notice: null, keep: null };
  if (state === 'missing') return { state, notice: { ...base, kind: 'retired-missing' }, keep: null };
  if (state === 'modified') return { state, notice: { ...base, kind: 'retired-modified' }, keep: null };
  if (policy === 'remove') {
    const { unlink } = await import('node:fs/promises');
    await unlink(join(targetDir, rel));
    await pruneEmptyParents(targetDir, rel);
    return { state, notice: { ...base, kind: 'retired-removed' }, keep: null };
  }
  return { state, notice: { ...base, kind: 'retired-kept' }, keep: { hash: baselineHash, since, reason } };
}

function consumerOwnedMatcher(...ownerships) {
  const globs = ownerships.flatMap((o) => (Array.isArray(o?.consumer_owned) ? o.consumer_owned : []));
  const res = globs.map(globToRegExp);
  return (rel) => res.some((re) => re.test(rel)) || /(^|\/)local-[^/]*$/.test(rel);
}

// Lists every retired file without changing anything.
export async function listRetired(targetDir, newDir, version, { retired = 'keep' } = {}) {
  const state = JSON.parse(await readFile(join(targetDir, '.squad', 'install-state.json'), 'utf8'));
  const newSquad = await readJsonOrNull(join(newDir, '.squad', 'squad.json'));
  const isConsumerOwned = consumerOwnedMatcher(state.ownership, newSquad?.ownership);
  const rows = [];
  const candidates = [
    ...Object.entries(state.managed_files || {}).filter(([rel]) => !MERGE_MANAGED.has(rel)),
    ...Object.entries(state.retired_files || {}).map(([rel, r]) => [rel, r.hash]),
  ];
  for (const [rel, hash] of candidates) {
    if (await exists(join(newDir, rel))) continue;
    const st = await classifyRetired(targetDir, rel, hash, isConsumerOwned);
    rows.push({ rel, state: st, action: RETIRED_ACTIONS[st](retired) });
  }
  return rows;
}

// Retired-only pass over install-state.json retired_files (files kept
// earlier without consent). Needs no new release.
export async function settleRetiredFiles(targetDir, { retired = 'remove' } = {}) {
  const statePath = join(targetDir, '.squad', 'install-state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const manifest = await readJsonOrNull(join(targetDir, '.squad', 'retired.json'));
  const isConsumerOwned = consumerOwnedMatcher(state.ownership);
  const notices = [];
  const retiredFiles = {};
  for (const [rel, r] of Object.entries(state.retired_files || {})) {
    const entry = lookupRetired(manifest, rel) || { since: r.since, reason: r.reason };
    const res = await settleRetired(targetDir, rel, r.hash, entry, retired, state.version, isConsumerOwned);
    if (res.notice) notices.push(res.notice);
    if (res.keep) retiredFiles[rel] = res.keep;
  }
  const newState = { ...state, retired_files: retiredFiles, updated_at: new Date().toISOString() };
  await atomicWrite(statePath, JSON.stringify(newState, null, 2) + '\n');
  return { applied: [], conflicts: [], notices, ownership: state.ownership };
}

export async function upgradeManaged(targetDir, newDir, version, { retired = 'keep' } = {}) {
  if (!RETIRED_POLICIES.has(retired)) throw new Error(`unknown retired policy: ${retired}`);
  const statePath = join(targetDir, '.squad', 'install-state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const versionNumber = version.startsWith('v') ? version.slice(1) : version;
  const newSquad = await readJsonOrNull(join(newDir, '.squad', 'squad.json'));
  const manifest = await readJsonOrNull(join(newDir, '.squad', 'retired.json'));
  const isConsumerOwned = consumerOwnedMatcher(state.ownership, newSquad?.ownership);
  const conflicts = [];
  const applied = [];
  const notices = [];
  const retiredSet = new Set();
  const retiredFiles = {};

  const newFiles = await listFiles(newDir);
  const managedFiles = Object.keys(state.managed_files).filter(p => !MERGE_MANAGED.has(p));
  const appliedSet = new Set();
  const managedSet = new Set(managedFiles);

  for (const rel of managedFiles) {
    const consumerPath = join(targetDir, rel);
    const newPath = join(newDir, rel);
    const oldHash = state.managed_files[rel];

    if (!(await exists(newPath))) {
      // Retired: the new release no longer ships this file. Never a conflict.
      retiredSet.add(rel);
      const res = await settleRetired(targetDir, rel, oldHash, lookupRetired(manifest, rel), retired, versionNumber, isConsumerOwned);
      if (res.notice) notices.push(res.notice);
      if (res.keep) retiredFiles[rel] = res.keep;
      continue;
    }

    if (!(await exists(consumerPath))) {
      // Missing locally; install fresh.
      await mkdir(dirname(consumerPath), { recursive: true });
      await copyFile(newPath, consumerPath);
      applied.push(rel);
      appliedSet.add(rel);
      continue;
    }

    if (await hashFile(consumerPath) === oldHash) {
      // Consumer has not modified; safe to replace.
      await mkdir(dirname(consumerPath), { recursive: true });
      await copyFile(newPath, consumerPath);
      applied.push(rel);
      appliedSet.add(rel);
      continue;
    }

    if (await hashFile(newPath) === oldHash) {
      // Upstream unchanged; keep consumer modifications.
      continue;
    }

    // Both changed. Keep the consumer file untouched, write the upstream
    // version next to it, and report the conflict. The recorded baseline hash
    // is kept, so the next upgrade still sees the consumer edit.
    await copyFile(newPath, consumerPath + UPSTREAM_SUFFIX);
    conflicts.push({ file: rel, reason: `modified locally and upstream; upstream version written to ${rel}${UPSTREAM_SUFFIX}` });
  }

  // Files kept by an earlier upgrade without consent. A path shipped again
  // leaves retired_files and is handled by the adoption pass below.
  for (const [rel, r] of Object.entries(state.retired_files || {})) {
    if (managedSet.has(rel) || (await exists(join(newDir, rel)))) continue;
    const entry = lookupRetired(manifest, rel) || { since: r.since, reason: r.reason };
    const res = await settleRetired(targetDir, rel, r.hash, entry, retired, versionNumber, isConsumerOwned);
    if (res.notice) notices.push(res.notice);
    if (res.keep) retiredFiles[rel] = res.keep;
  }

  // Files first shipped in this release are absent from the recorded
  // manifest; adopt them unless an unrelated consumer file already occupies
  // the path, which is reported rather than overwritten.
  const adopted = [];
  for (const abs of newFiles) {
    const rel = relative(newDir, abs).split(sep).join('/');
    if (MERGE_MANAGED.has(rel) || managedSet.has(rel)) continue;
    const consumerPath = join(targetDir, rel);
    if (!(await exists(consumerPath))) {
      await mkdir(dirname(consumerPath), { recursive: true });
      await copyFile(abs, consumerPath);
      applied.push(rel);
      adopted.push(rel);
      continue;
    }
    if ((await hashFile(consumerPath)) === (await hashFile(abs))) {
      adopted.push(rel); // identical bytes already present; register as managed
    } else {
      await copyFile(abs, consumerPath + UPSTREAM_SUFFIX);
      conflicts.push({ file: rel, reason: `consumer file exists at new managed path; upstream version written to ${rel}${UPSTREAM_SUFFIX}` });
    }
  }

  // Merge AGENTS.md managed section separately
  const agentsResult = await mergeAgents(targetDir, newDir, state, version);
  if (agentsResult.conflicts.length) conflicts.push(...agentsResult.conflicts);
  if (agentsResult.applied) applied.push('AGENTS.md');

  const hooksResult = await mergeHooks(targetDir, newDir);
  conflicts.push(...hooksResult.conflicts);
  if (hooksResult.applied) applied.push('.cursor/hooks.json');

  // Update state
  const updatedManaged = {};
  for (const rel of Object.keys(state.managed_files)) {
    if (retiredSet.has(rel)) continue;
    const consumerPath = join(targetDir, rel);
    if (!(await exists(consumerPath))) continue;
    // Only files actually written by this upgrade (and merge-managed files)
    // get a new baseline; kept consumer edits retain the old one.
    updatedManaged[rel] = appliedSet.has(rel) || MERGE_MANAGED.has(rel)
      ? await hashFile(consumerPath)
      : state.managed_files[rel];
  }
  if (hooksResult.applied) {
    updatedManaged['.cursor/hooks.json'] = await hashFile(join(targetDir, '.cursor', 'hooks.json'));
  }
  for (const rel of adopted) {
    updatedManaged[rel] = await hashFile(join(targetDir, rel));
  }

  const newState = {
    ...state,
    version: versionNumber,
    release_tag: version,
    managed_files: updatedManaged,
    retired_files: retiredFiles,
    ownership: newSquad?.ownership ?? state.ownership,
    updated_at: new Date().toISOString()
  };
  await atomicWrite(statePath, JSON.stringify(newState, null, 2) + '\n');

  return { applied, conflicts, notices, ownership: state.ownership };
}

async function mergeAgents(targetDir, newDir, state, version) {
  const existingPath = join(targetDir, 'AGENTS.md');
  const newPath = join(newDir, 'AGENTS.md');
  const { mergeAgents: mergeAgentsMd } = await import('./merge-agents.mjs');
  await mergeAgentsMd(existingPath, newPath, existingPath);
  return { applied: true, conflicts: [] };
}

async function mergeHooks(targetDir, newDir) {
  const newPath = join(newDir, '.cursor', 'hooks.json');
  if (!(await exists(newPath))) return { applied: false, conflicts: [] };
  const existingPath = join(targetDir, '.cursor', 'hooks.json');
  await mkdir(dirname(existingPath), { recursive: true });
  const { mergeCursorHooks } = await import('./merge-cursor-hooks.mjs');
  const res = await mergeCursorHooks(existingPath, newPath, existingPath);
  if (res.status === 'conflict') {
    return { applied: false, conflicts: [{ file: '.cursor/hooks.json', reason: `${res.reason}; upstream version written to .cursor/hooks.json${UPSTREAM_SUFFIX}` }] };
  }
  return { applied: true, conflicts: [] };
}

const pad = (s) => s.padEnd(10);
const lcfirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

function headline(n) {
  const m = /^(.*?):\s+(.*?)\.?$/.exec(n.reason || '');
  if (n.decision && m) return `XQ Squad ${n.since}: ${lcfirst(m[1])} (decision ${n.decision}: ${m[2]}).`;
  if (n.decision) return `XQ Squad ${n.since}: ${n.reason} (decision ${n.decision}).`;
  return `XQ Squad ${n.since}: ${n.reason}`;
}

function noticeLine(n) {
  if (n.kind === 'retired-removed') return `  ${pad('removed')}${n.file}`;
  if (n.kind === 'retired-kept') return `  ${pad('kept')}${n.file}   (unmodified; rerun update.sh with --remove-retired to delete)`;
  if (n.kind === 'retired-modified') {
    const why = n.decision ? `retired by ${n.decision}` : 'changed locally';
    return `  ${pad('modified')}${n.file}   (${why}; keep or delete by hand)`;
  }
  return `  ${pad('missing')}${n.file}   (already removed)`;
}

// Human-readable deprecation notice, one block per retired.json entry.
export function formatRetiredNotice(notices, ownership) {
  const groups = new Map();
  for (const n of notices) {
    const key = `${n.since}\0${n.decision}\0${n.reason}\0${n.prefix}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(n);
  }
  const consumerGlobs = Array.isArray(ownership?.consumer_owned) ? ownership.consumer_owned : [];
  const blocks = [];
  for (const group of groups.values()) {
    const first = group[0];
    const lines = [headline(first), 'These files from your previous install are no longer shipped:', ...group.map(noticeLine)];
    const own = first.prefix ? consumerGlobs.filter((g) => g.startsWith(first.prefix)) : [];
    if (own.length) {
      const list = own.length === 1 ? own[0] : `${own.slice(0, -1).join(', ')} and ${own[own.length - 1]}`;
      lines.push(`Your own ${list} files were not touched.`);
    }
    if (first.decision) lines.push('See "Upgrading from 1.x" in the README.');
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

export function parseArgs(argv) {
  const opts = { retired: 'keep', listRetired: false, retiredOnly: false, positional: [] };
  for (const arg of argv) {
    if (arg.startsWith('--retired=')) opts.retired = arg.slice('--retired='.length);
    else if (arg === '--list-retired') opts.listRetired = true;
    else if (arg === '--retired-only') opts.retiredOnly = true;
    else if (arg.startsWith('--')) throw new Error(`unknown option: ${arg}`);
    else opts.positional.push(arg);
  }
  if (!RETIRED_POLICIES.has(opts.retired)) throw new Error(`--retired must be remove or keep, got ${opts.retired}`);
  return opts;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    console.error('Usage: upgrade-managed.mjs <target> <newDir> <version> [--retired=remove|keep] [--list-retired]');
    console.error('       upgrade-managed.mjs --retired-only <target> --retired=remove|keep');
    process.exit(2);
  }
  const [targetDir, newDir, version] = opts.positional;

  if (opts.listRetired) {
    for (const row of await listRetired(targetDir, newDir, version, opts)) console.log(JSON.stringify(row));
    return;
  }

  const result = opts.retiredOnly
    ? await settleRetiredFiles(targetDir, opts)
    : await upgradeManaged(targetDir, newDir, version, opts);

  if (result.conflicts.length) {
    console.error('Conflicts detected:');
    for (const c of result.conflicts) console.error(`  ${c.file}${c.line ? ':' + c.line : ''} ${c.reason || ''}`);
  }

  if (result.applied.length) {
    console.log('Updated files:');
    for (const f of result.applied) console.log(`  ${f}`);
  }

  if (result.notices.length) console.log(formatRetiredNotice(result.notices, result.ownership));

  process.exit(result.conflicts.length ? 1 : 0);
}

function isMain() {
  try {
    return Boolean(process.argv[1]) && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMain()) {
  main();
}
