// XQ Squad Cursor hook (beforeShellExecution): commits, pushes, PRs, and
// releases need explicit user authorization, so ask before each one.
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readStdinJson, respond } from './xq-squad-hook-io.mjs';

export const GUARDED = /\bgit\b[^|;&]*\s(commit|push)\b|\bgh\s+(pr\s+create|release\s+create)\b/;

export function decide(input) {
  const command = typeof input?.command === 'string' ? input.command : '';
  if (!GUARDED.test(command)) return { permission: 'allow' };
  return {
    permission: 'ask',
    user_message: `XQ Squad: "${command}" commits, pushes, or publishes. Approve only if you explicitly authorized it.`,
    agent_message:
      'XQ Squad governance: commits, pushes, PRs, and releases require explicit user authorization. Wait for the user to approve.',
  };
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  respond(decide(await readStdinJson()));
}
