import { readFile, writeFile, rename, mkdir, copyFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname, relative } from 'node:path';

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

function lines(text) {
  return text.split(/\r?\n/);
}

function threeWayMerge(baseLines, currentLines, newLines, fileName) {
  const conflicts = [];
  const max = Math.max(baseLines.length, currentLines.length, newLines.length);
  const result = [];

  for (let i = 0; i < max; i++) {
    const base = baseLines[i];
    const cur = currentLines[i];
    const neu = newLines[i];

    if (cur === neu) {
      result.push(cur ?? '');
      continue;
    }
    if (base === cur) {
      result.push(neu ?? '');
      continue;
    }
    if (base === neu) {
      result.push(cur ?? '');
      continue;
    }
    // All three differ: conflict
    conflicts.push({ file: fileName, line: i + 1 });
    result.push(cur ?? '');
  }

  return { text: result.join('\n'), conflicts };
}

export async function upgradeManaged(targetDir, newDir, version) {
  const statePath = join(targetDir, '.squad', 'install-state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const conflicts = [];
  const applied = [];

  const newFiles = await listFiles(newDir);
  const managedFiles = Object.keys(state.managed_files).filter(p => p !== 'AGENTS.md');

  for (const rel of managedFiles) {
    const consumerPath = join(targetDir, rel);
    const newPath = join(newDir, rel);
    const oldHash = state.managed_files[rel];

    const current = await readTextOrNull(consumerPath);
    const upstream = await readTextOrNull(newPath);
    const old = current; // We treat current install baseline as old for now; in v2 store original.

    if (!upstream) {
      // File removed in new release. Leave consumer-owned modifications; report if changed.
      if (current && await hashFile(consumerPath) !== oldHash) {
        conflicts.push({ file: rel, reason: 'upstream removed but consumer modified' });
      }
      continue;
    }

    if (!current) {
      // Missing locally; install fresh.
      await mkdir(dirname(consumerPath), { recursive: true });
      await copyFile(newPath, consumerPath);
      applied.push(rel);
      continue;
    }

    if (await hashFile(consumerPath) === oldHash) {
      // Consumer has not modified; safe to replace.
      await mkdir(dirname(consumerPath), { recursive: true });
      await copyFile(newPath, consumerPath);
      applied.push(rel);
      continue;
    }

    if (await hashFile(newPath) === oldHash) {
      // Upstream unchanged; keep consumer modifications.
      continue;
    }

    // Both changed. Try line merge for text files.
    const isText = rel.endsWith('.md') || rel.endsWith('.json') || rel.endsWith('.ndjson') || rel.endsWith('.sh') || rel.endsWith('.mjs');
    if (isText) {
      const merged = threeWayMerge(lines(old), lines(current), lines(upstream), rel);
      conflicts.push(...merged.conflicts);
      await atomicWrite(consumerPath, merged.text);
      applied.push(rel);
    } else {
      conflicts.push({ file: rel, reason: 'binary file conflict' });
    }
  }

  // Merge AGENTS.md managed section separately
  const agentsResult = await mergeAgents(targetDir, newDir, state, version);
  if (agentsResult.conflicts.length) conflicts.push(...agentsResult.conflicts);
  if (agentsResult.applied) applied.push('AGENTS.md');

  // Update state
  const updatedManaged = {};
  for (const rel of Object.keys(state.managed_files)) {
    const consumerPath = join(targetDir, rel);
    if (await exists(consumerPath)) {
      updatedManaged[rel] = await hashFile(consumerPath);
    }
  }

  const versionNumber = version.startsWith('v') ? version.slice(1) : version;
  const newState = {
    ...state,
    version: versionNumber,
    release_tag: version,
    managed_files: updatedManaged,
    updated_at: new Date().toISOString()
  };
  await atomicWrite(statePath, JSON.stringify(newState, null, 2) + '\n');

  return { applied, conflicts };
}

async function mergeAgents(targetDir, newDir, state, version) {
  const existingPath = join(targetDir, 'AGENTS.md');
  const newPath = join(newDir, 'AGENTS.md');
  const { mergeAgents: mergeAgentsMd } = await import('./merge-agents.mjs');
  await mergeAgentsMd(existingPath, newPath, existingPath);
  return { applied: true, conflicts: [] };
}

async function main() {
  const [targetDir, newDir, version] = process.argv.slice(2);
  const result = await upgradeManaged(targetDir, newDir, version);

  if (result.conflicts.length) {
    console.error('Conflicts detected:');
    for (const c of result.conflicts) console.error(`  ${c.file}${c.line ? ':' + c.line : ''} ${c.reason || ''}`);
  }

  if (result.applied.length) {
    console.log('Updated files:');
    for (const f of result.applied) console.log(`  ${f}`);
  }

  process.exit(result.conflicts.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
