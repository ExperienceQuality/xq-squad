import { readFile, writeFile } from 'node:fs/promises';

const MANAGED_START = '<!-- XQ_SQUAD_MANAGED_START';
const MANAGED_END = '<!-- XQ_SQUAD_MANAGED_END -->';

function stripManagedSection(content) {
  const startIdx = content.indexOf(MANAGED_START);
  if (startIdx === -1) return content;
  const endIdx = content.indexOf(MANAGED_END, startIdx);
  if (endIdx === -1) return content.slice(0, startIdx);
  return content.slice(0, startIdx) + content.slice(endIdx + MANAGED_END.length);
}

function extractManagedSection(content) {
  const startIdx = content.indexOf(MANAGED_START);
  if (startIdx === -1) return null;
  const endIdx = content.indexOf(MANAGED_END, startIdx);
  if (endIdx === -1) return null;
  return content.slice(startIdx, endIdx + MANAGED_END.length);
}

export async function mergeAgents(existingPath, distributedPath, outputPath) {
  const existing = await readFile(existingPath, 'utf8');
  const distributed = await readFile(distributedPath, 'utf8');

  const existingManaged = extractManagedSection(existing);
  const newManaged = extractManagedSection(distributed);

  let result;
  if (existingManaged) {
    // Replace existing managed section with new one.
    result = stripManagedSection(existing).replace(/\s*$/, '') + '\n\n' + newManaged + '\n';
  } else {
    // Append new managed section at end.
    result = existing.replace(/\s*$/, '') + '\n\n' + newManaged + '\n';
  }

  await writeFile(outputPath, result, 'utf8');
}

async function main() {
  const [existingPath, distributedPath, outputPath] = process.argv.slice(2);
  await mergeAgents(existingPath, distributedPath, outputPath);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
