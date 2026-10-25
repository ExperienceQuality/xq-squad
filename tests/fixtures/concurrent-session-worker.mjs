// Test worker for concurrent session scenarios. Protocol:
//   - signals READY on stderr, then reads one JSON spec on stdin:
//     { command, request, retries }
//   - runs runSessionCommand(command, request); on a transient mutex
//     BLOCKED/RECOVERY_REQUIRED it retries up to `retries` times — the
//     caller-level retry the protocol prescribes, not a helper busy-loop.
//     A result carrying recoveryRequired means a claim already exists:
//     never retried (that path needs user-confirmed resume/release).
//   - prints exactly one JSON result on stdout.
import { runSessionCommand } from '../../distribution/.squad/scripts/delivery-session.mjs';

process.stderr.write('READY\n');
let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) {
  input += chunk;
}
const { command, request, retries = 0 } = JSON.parse(input);
let result;
for (let attempt = 0; ; attempt += 1) {
  result = await runSessionCommand(command, request);
  const transient =
    result.status === 'BLOCKED' &&
    result.code === 'RECOVERY_REQUIRED' &&
    result.recoveryRequired !== true;
  if (!transient || attempt >= retries) break;
}
process.stdout.write(JSON.stringify(result));
