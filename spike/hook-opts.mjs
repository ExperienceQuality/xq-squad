#!/usr/bin/env node
// Spike-0 helper: switch hooks.json options for an experiment.
//   node hook-opts.mjs <repo> <event> key=value ...   set (JSON or text) or delete (key=) options
//                                                     on <repo>/.cursor/hooks.json entries for <event>
//   node hook-opts.mjs <repo> --reset                 restore spike/hooks.json
//   node hook-opts.mjs --user-install <event,...>     register the probe in ~/.cursor/hooks.json as source "user"
//   node hook-opts.mjs --user-remove                  remove it and restore the previous user file
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const USER_FILE = path.join(os.homedir(), '.cursor', 'hooks.json');
const BACKUP = `${USER_FILE}.xq-probe-backup`;
const BIN = path.join(os.homedir(), 'xq-probe', 'bin');
const die = (msg) => { console.error(msg); process.exit(64); };
const write = (file, obj) => { fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n'); console.log(`${file}:\n${JSON.stringify(obj, null, 2)}`); };
const [a, b, ...rest] = process.argv.slice(2);

if (a === '--user-install') {
  if (!b) die('usage: --user-install <event,...>');
  fs.mkdirSync(BIN, { recursive: true });
  for (const f of ['probe.mjs', 'lock-proto.mjs']) fs.copyFileSync(path.join(HERE, f), path.join(BIN, f));
  fs.mkdirSync(path.dirname(USER_FILE), { recursive: true });
  if (fs.existsSync(USER_FILE) && !fs.existsSync(BACKUP)) fs.renameSync(USER_FILE, BACKUP);
  const hooks = Object.fromEntries(b.split(',').map((ev) => [ev, [{ command: `node ${JSON.stringify(path.join(BIN, 'probe.mjs'))} ${ev} user`, timeout: 30 }]]));
  write(USER_FILE, { version: 1, hooks });
} else if (a === '--user-remove') {
  fs.rmSync(USER_FILE, { force: true });
  if (fs.existsSync(BACKUP)) fs.renameSync(BACKUP, USER_FILE);
  console.log(fs.existsSync(USER_FILE) ? `restored ${USER_FILE}` : `removed ${USER_FILE}`);
} else if (a && b === '--reset') {
  const file = path.join(a, '.cursor', 'hooks.json');
  fs.copyFileSync(path.join(HERE, 'hooks.json'), file);
  console.log(`reset ${file}`);
} else if (a && b && rest.length) {
  const file = path.join(a, '.cursor', 'hooks.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entries = cfg.hooks?.[b] || die(`${file} has no "${b}" hook`);
  for (const kv of rest) {
    const i = kv.indexOf('=');
    if (i < 1) die(`not key=value: ${kv}`);
    const [key, text] = [kv.slice(0, i), kv.slice(i + 1)];
    let value;
    try { value = JSON.parse(text); } catch { value = text; }
    for (const e of entries) text === '' ? delete e[key] : (e[key] = value);
  }
  write(file, cfg);
} else {
  die('usage: see the header of spike/hook-opts.mjs');
}
