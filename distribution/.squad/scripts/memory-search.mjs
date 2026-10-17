import { readFile, access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const DEFAULT_BUDGET = 4000;

function resolveMemoryDir(explicit) {
  return explicit || process.env.SQUAD_MEMORY_DIR || '.squad/memory';
}

function tokenEstimate(text) {
  // Very rough tokenizer estimate: ~4 characters per token for English/JSON text.
  return Math.ceil(text.length / 4);
}

function scoreRecord(record, keywords, types, explicitStatuses) {
  let score = 0;
  const hay = `${record.topic} ${record.summary} ${record.details || ''}`.toLowerCase();
  for (const kw of keywords) {
    if (hay.includes(kw.toLowerCase())) score += 3;
  }
  if (types.length && types.includes(record.type)) score += 2;
  if (explicitStatuses.length && explicitStatuses.includes(record.status)) score += 1;
  if (record.status === 'superseded') score -= 1;
  return score;
}

async function readNdjson(filePath) {
  const records = [];
  try {
    await access(filePath);
  } catch {
    return records;
  }
  const rl = createInterface({ input: createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber++;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch (e) {
      throw new Error(`Invalid JSON at line ${lineNumber} in ${filePath}: ${e.message}`);
    }
  }
  return records;
}

export async function searchMemory({ keywords = [], types = [], statuses = ['active'], budget = DEFAULT_BUDGET, sources = ['lessons.ndjson', 'delivery-events.ndjson'], memoryDir } = {}) {
  const dir = resolveMemoryDir(memoryDir);
  const all = [];
  for (const src of sources) {
    const records = await readNdjson(`${dir}/${src}`);
    for (const rec of records) {
      all.push({ ...rec, _source: src });
    }
  }

  const explicitStatuses = statuses.length && !(statuses.length === 1 && statuses[0] === 'active') ? statuses : [];
  const hasFilter = keywords.length > 0 || types.length > 0 || explicitStatuses.length > 0;
  const scored = all
    .map(rec => ({ record: rec, score: scoreRecord(rec, keywords, types, explicitStatuses) }))
    .filter(item => item.score > 0 || !hasFilter)
    .sort((a, b) => b.score - a.score);

  const selected = [];
  let used = 0;
  const references = [];

  for (const item of scored) {
    const text = JSON.stringify(item.record);
    const cost = tokenEstimate(text);
    if (used + cost > budget && selected.length > 0) break;
    selected.push(item.record);
    references.push(`${item.record.id} (${item.record._source})`);
    used += cost;
    delete item.record._source;
  }

  return {
    records: selected,
    references,
    used_budget: used,
    budget,
    approximate_tokens: used,
    total_considered: all.length
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node memory-search.mjs <keywords...> [--type lesson|observation|delivery_event|decision] [--status active|superseded|historical|rejected] [--budget N]');
    process.exit(2);
  }
  const keywords = [];
  const types = [];
  const statuses = [];
  let budget = DEFAULT_BUDGET;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--type') types.push(args[++i]);
    else if (a === '--status') statuses.push(args[++i]);
    else if (a === '--budget') budget = parseInt(args[++i], 10);
    else if (!a.startsWith('--')) keywords.push(a);
  }

  const result = await searchMemory({ keywords, types, statuses: statuses.length ? statuses : ['active'], budget, memoryDir: process.env.SQUAD_MEMORY_DIR });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
