#!/usr/bin/env bash
# Spike-0 (S0-T3): 8 appenders x 500 records on one ledger, then a lock left
# 31 s old that must be broken and recorded. Usage: bash spike/lock-stress.sh [workers] [per-worker]
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WORKERS=${1:-8}
PER=${2:-500}
DIR=$(mktemp -d "${TMPDIR:-/tmp}/xq-lock-stress.XXXXXX")
trap 'rm -rf "$DIR"' EXIT
LEDGER="$DIR/ledger/stress.ndjson"
mkdir -p "$DIR/ledger"

start=$(date +%s)
pids=()
for ((w = 1; w <= WORKERS; w++)); do
  node "$HERE/lock-proto.mjs" append "$LEDGER" "w$w" "$PER" stress >"$DIR/w$w.out" &
  pids+=($!)
done
rc=0
for pid in "${pids[@]}"; do wait "$pid" || rc=1; done
cat "$DIR"/w*.out
echo "appended in $(($(date +%s) - start))s"
node -e '
  const outs = process.argv.slice(1).map((f) => JSON.parse(require("fs").readFileSync(f, "utf8")));
  const busy = outs.reduce((n, o) => n + o.busy, 0);
  const total = outs.reduce((n, o) => n + o.appended, 0);
  console.log(`LOCK_BUSY (append failed after the 10..320 ms backoff, resubmitted): ${busy} of ${total + busy} attempts`);
' "$DIR"/w*.out

result=$(node "$HERE/lock-proto.mjs" verify "$LEDGER" || true)
echo "verify: $result"
want=$((WORKERS * PER))
node -e '
  const r = JSON.parse(process.argv[1]); const want = Number(process.argv[2]);
  const ok = r.ok && r.counts["turn.ok"] === want && r.counts["session.open"] === 1 && r.lastSeq === want && r.forks.length === 0 && r.torn === 0;
  console.log(ok ? `OK: ${want} records, seq 0..${r.lastSeq} contiguous, valid chain, 0 forks` : `FAIL: want ${want} turn.ok records, seq 0..${want}, 0 forks`);
  process.exit(ok ? 0 : 1);
' "$result" "$want" || rc=1

# A holder that never released, 31 s old: the next append must break it and record ledger.lock-broken.
mkdir "$LEDGER.lock.d"
echo '{"nonce":"stale-nonce","pid":999999,"host":"gone","hook":"crashed","ts":"1970-01-01T00:00:00Z"}' >"$LEDGER.lock.d/holder.json"
touch -d '31 seconds ago' "$LEDGER.lock.d" 2>/dev/null || touch -A -000031 "$LEDGER.lock.d"
node "$HERE/lock-proto.mjs" append "$LEDGER" breaker 1 stress >/dev/null
node -e '
  const fs = require("fs");
  const recs = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").slice(-2).map(JSON.parse);
  const b = recs[0];
  const ok = b.type === "ledger.lock-broken" && b.data.holder.nonce === "stale-nonce" && b.data.ageMs > 30000 && recs[1].type === "turn.ok" && !fs.existsSync(process.argv[1] + ".lock.d");
  console.log(ok ? `OK: 31 s lock broken (age ${b.data.ageMs} ms) and recorded at seq ${b.seq}` : "FAIL: stale lock not broken and recorded");
  process.exit(ok ? 0 : 1);
' "$LEDGER" || rc=1
node "$HERE/lock-proto.mjs" verify "$LEDGER" >/dev/null || { echo "FAIL: chain invalid after break"; rc=1; }

[ "$rc" = 0 ] && echo PASS || echo FAIL
exit "$rc"
