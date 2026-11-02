// AF-01: each Cursor hook must run (and print a response) when invoked from a
// path with spaces or non-ASCII characters, or through a symlinked parent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'distribution');
const HOOKS = {
  'xq-squad-git-guard.mjs': { command: 'git push origin main' },
  'xq-squad-scope-guard.mjs': { tool_name: 'Write', tool_input: { file_path: 'README.md' } },
  'xq-squad-verify-reminder.mjs': { status: 'completed', loop_count: 0 },
};

async function repoAt(base, name) {
  const dir = path.join(base, name);
  await mkdir(dir, { recursive: true });
  await cp(path.join(DIST, '.cursor'), path.join(dir, '.cursor'), { recursive: true });
  await cp(path.join(DIST, '.squad'), path.join(dir, '.squad'), { recursive: true });
  return dir;
}

async function layouts() {
  const base = await mkdtemp(path.join(tmpdir(), 'xq-hook-entry-'));
  const spaced = await repoAt(base, 'my repo');
  const unicode = await repoAt(base, 'répo ñ 仓库');
  const real = await repoAt(base, 'real');
  const linked = path.join(base, 'linked parent');
  await symlink(real, linked);
  return { 'path with spaces': spaced, 'non-ASCII path': unicode, 'symlinked parent': linked };
}

const all = await layouts();
for (const [label, repo] of Object.entries(all)) {
  for (const [hook, input] of Object.entries(HOOKS)) {
    test(`${hook} responds from a ${label}`, () => {
      const res = spawnSync(process.execPath, [path.join(repo, '.cursor/hooks', hook)], {
        cwd: repo,
        input: JSON.stringify({ ...input, cwd: repo, workspace_roots: [repo] }),
        encoding: 'utf8',
      });
      assert.equal(res.status, 0, res.stderr);
      assert.notEqual(res.stdout.trim(), '', 'hook printed nothing (entry-point guard did not match)');
      JSON.parse(res.stdout);
    });
  }
}

test('git guard still asks for git push from a path with spaces', () => {
  const repo = all['path with spaces'];
  const res = spawnSync(process.execPath, [path.join(repo, '.cursor/hooks/xq-squad-git-guard.mjs')], {
    input: JSON.stringify({ command: 'git push origin main', cwd: repo }),
    encoding: 'utf8',
  });
  assert.equal(JSON.parse(res.stdout).permission, 'ask');
});
