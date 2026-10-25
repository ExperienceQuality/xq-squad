#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$REPO_ROOT/tests/agents-test-helpers.sh"
TMP_BASE="$(mktemp -d)"
trap 'rm -rf "$TMP_BASE"' EXIT

CONSUMER="$TMP_BASE/consumer"
cp -R "$REPO_ROOT/tests/fixtures/sample-consumer" "$CONSUMER"
git -C "$CONSUMER" init -q

RELEASE_DIR="$TMP_BASE/releases"
bash "$REPO_ROOT/scripts/package-release.sh" --version v1.0.0 --output "$RELEASE_DIR"

bash "$REPO_ROOT/install.sh" \
  --target "$CONSUMER" \
  --version v1.0.0 \
  --archive "$RELEASE_DIR/squad-v1.0.0.tar.gz" \
  --checksum "$RELEASE_DIR/squad-v1.0.0.tar.gz.sha256"

# Verify consumer files preserved
if ! grep -q 'Use ESM modules' "$CONSUMER/AGENTS.md"; then
  echo "consumer AGENTS.md not preserved" >&2
  exit 1
fi
assert_lead_contract_in_managed_section "$CONSUMER/AGENTS.md"

# Verify squad loaded
if [[ ! -f "$CONSUMER/.squad/agents/lead.md" ]]; then
  echo "Lead contract missing" >&2
  exit 1
fi

# Concurrent-delivery helpers installed with their opt-in API intact
for m in delivery-scope delivery-registry delivery-worktree delivery-session delivery-verify; do
  if [[ ! -f "$CONSUMER/.squad/scripts/$m.mjs" ]]; then
    echo "installed concurrent-delivery helper missing: $m.mjs" >&2
    exit 1
  fi
done
if [[ ! -f "$CONSUMER/.squad/schemas/delivery-session.schema.json" || ! -f "$CONSUMER/.squad/workflows/concurrent-delivery.md" ]]; then
  echo "concurrent-delivery schema/workflow missing in consumer" >&2
  exit 1
fi

# Read-only status works on the installed fixture and never touches the index.
INDEX_BEFORE="absent"
if [[ -f "$CONSUMER/.git/index" ]]; then
  INDEX_BEFORE="$(git -C "$CONSUMER" hash-object --stdin < "$CONSUMER/.git/index")"
fi
SQ_CONSUMER="$CONSUMER" node --input-type=module - <<'NODE'
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const consumer = process.env.SQ_CONSUMER;
if (!consumer) throw new Error('SQ_CONSUMER unset');
const load = (rel) => import(pathToFileURL(path.join(consumer, rel)).href);
const s = await load('.squad/scripts/delivery-session.mjs');
const v = await load('.squad/scripts/delivery-verify.mjs');
if (typeof s.runSessionCommand !== 'function' || typeof v.captureDeliverySnapshot !== 'function' || typeof v.verifyDeliveryWrites !== 'function') {
  throw new Error('concurrent-delivery exports missing');
}
const r = await s.runSessionCommand('status', { repositoryPath: consumer });
if (r.status !== 'OK' || !Array.isArray(r.records)) throw new Error('read-only status failed: ' + JSON.stringify(r));
console.log('read-only status ok; records:', r.records.length);
NODE
INDEX_AFTER="absent"
if [[ -f "$CONSUMER/.git/index" ]]; then
  INDEX_AFTER="$(git -C "$CONSUMER" hash-object --stdin < "$CONSUMER/.git/index")"
fi
if [[ "$INDEX_BEFORE" != "$INDEX_AFTER" ]]; then
  echo "consumer .git/index changed by read-only status" >&2
  exit 1
fi

# Run consumer tests
cd "$CONSUMER"
npm test

echo "e2e test passed"
