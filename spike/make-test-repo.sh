#!/usr/bin/env bash
# Spike-0: build a scratch repo for the Cursor hook probe. Idempotent.
# Usage: bash spike/make-test-repo.sh <dir>
set -euo pipefail

if [ $# -ne 1 ] || [ -z "$1" ]; then
  echo "usage: $0 <dir>" >&2
  exit 64
fi

SPIKE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
mkdir -p "$1"
REPO=$(cd "$1" && pwd -P)
LINKED="$REPO.worktrees/linked wt"
DELIVERY_ID=probe-delivery
DELIVERY="$REPO/.squad/worktrees/$DELIVERY_ID"
NFILES=10000
export GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0
g() { git -C "$REPO" -c user.email=probe@example.com -c user.name="XQ Probe" "$@"; }
has_worktree() { g worktree list --porcelain | grep -Fxq "worktree $1"; }

[ -d "$REPO/.git" ] || g init -q -b main

# 10,000 small files under files/dNN/.
if [ ! -f "$REPO/files/d99/f9999.txt" ]; then
  for ((d = 0; d < NFILES / 100; d++)); do
    dir=$(printf '%s/files/d%02d' "$REPO" "$d")
    mkdir -p "$dir"
    for ((i = d * 100; i < d * 100 + 100; i++)); do
      printf 'probe file %d\n' "$i" >"$dir/f$i.txt"
    done
  done
fi

# Probe install: .cursor/hooks.json + .cursor/xq-probe/{probe,lock-proto}.mjs.
# The <C>/xq-probe-ledger marker makes the probe append each call to
# <C>/squad/enforce/ledger/<conversation_id>.ndjson (E-07).
mkdir -p "$REPO/.cursor/xq-probe"
cp "$SPIKE_DIR/hooks.json" "$REPO/.cursor/hooks.json"
cp "$SPIKE_DIR/probe.mjs" "$SPIKE_DIR/lock-proto.mjs" "$REPO/.cursor/xq-probe/"
touch "$REPO/.git/xq-probe-ledger"
# E-03 notebook edit target.
[ -f "$REPO/notebook.ipynb" ] || cat >"$REPO/notebook.ipynb" <<'NB'
{"cells":[{"cell_type":"code","execution_count":null,"metadata":{},"outputs":[],"source":["print('probe')"]}],"metadata":{},"nbformat":4,"nbformat_minor":5}
NB
[ -f "$REPO/README.md" ] || printf '# XQ probe test repo\n\nThrowaway repo for Spike-0.\n' >"$REPO/README.md"

grep -qxF '.squad/worktrees/' "$REPO/.git/info/exclude" 2>/dev/null || echo '.squad/worktrees/' >>"$REPO/.git/info/exclude"

g add -A
if ! g diff --cached --quiet 2>/dev/null || ! g rev-parse -q --verify HEAD >/dev/null; then
  g commit -q -m "probe: test repo files and hooks"
fi

# Linked worktree on a path containing a space.
if ! has_worktree "$LINKED"; then
  mkdir -p "$(dirname "$LINKED")"
  g show-ref -q --verify refs/heads/probe-linked || g branch -q probe-linked
  g worktree add -q "$LINKED" probe-linked
fi

# Delivery worktree at .squad/worktrees/<id>.
if ! has_worktree "$DELIVERY"; then
  g show-ref -q --verify "refs/heads/squad/$DELIVERY_ID" || g branch -q "squad/$DELIVERY_ID"
  g worktree add -q "$DELIVERY" "squad/$DELIVERY_ID"
fi

# Fake claim registry: one ACTIVE claim under <C>/squad/run/.
C=$(g rev-parse --path-format=absolute --git-common-dir)
CLAIM="$C/squad/run/$DELIVERY_ID.json"
if [ ! -f "$CLAIM" ]; then
  mkdir -p "$C/squad/run"
  BASE=$(g rev-parse HEAD)
  NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  cat >"$CLAIM" <<JSON
{
  "schemaVersion": 1,
  "deliveryId": "$DELIVERY_ID",
  "ownerToken": "probe-owner-token",
  "generation": 1,
  "state": "ACTIVE",
  "repositoryRoot": "$REPO",
  "branch": "squad/$DELIVERY_ID",
  "worktreePath": "$DELIVERY",
  "baseRef": "main",
  "baseCommit": "$BASE",
  "scope": ["files/d00/"],
  "createdAt": "$NOW",
  "heartbeatAt": "$NOW",
  "approval": { "confirmed": true, "reference": "spike-0 probe" }
}
JSON
fi

# Check the claim with the real registry reader when this checkout has it.
READER="$SPIKE_DIR/../distribution/.squad/scripts/delivery-registry.mjs"
if [ -f "$READER" ]; then
  node --input-type=module -e "
    const { readRegistry } = await import(process.argv[1]);
    const r = await readRegistry({ repositoryPath: process.argv[2] });
    const active = (r.records || []).filter((x) => x.state === 'ACTIVE').length;
    if (r.status !== 'OK' || active !== 1) { console.error('claim registry check failed:', JSON.stringify(r)); process.exit(1); }
  " "$READER" "$REPO"
fi

echo "repo:              $REPO"
echo "linked worktree:   $LINKED"
echo "delivery worktree: $DELIVERY"
echo "claim:             $CLAIM"
echo "files:             $(find "$REPO/files" -type f | wc -l | tr -d ' ')"
