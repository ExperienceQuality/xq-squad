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

# Run consumer tests
cd "$CONSUMER"
npm test

echo "e2e test passed"
