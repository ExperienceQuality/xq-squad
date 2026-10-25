#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$REPO_ROOT/tests/agents-test-helpers.sh"
TMP_BASE="$(mktemp -d)"
trap 'rm -rf "$TMP_BASE"' EXIT

CONSUMER="$TMP_BASE/consumer"
mkdir -p "$CONSUMER"
git -C "$CONSUMER" init -q

RELEASE_DIR="$TMP_BASE/releases"
bash "$REPO_ROOT/scripts/package-release.sh" --version v1.0.0 --output "$RELEASE_DIR"
bash "$REPO_ROOT/scripts/package-release.sh" --version v1.1.0 --output "$RELEASE_DIR"

bash "$REPO_ROOT/install.sh" \
  --target "$CONSUMER" \
  --version v1.0.0 \
  --archive "$RELEASE_DIR/squad-v1.0.0.tar.gz" \
  --checksum "$RELEASE_DIR/squad-v1.0.0.tar.gz.sha256"

# Simulate consumer modification to a managed file (not AGENTS.md)
echo "# Consumer override" >> "$CONSUMER/.squad/README.md"

# Update to v1.1.0
bash "$REPO_ROOT/update.sh" \
  --target "$CONSUMER" \
  --version v1.1.0 \
  --archive "$RELEASE_DIR/squad-v1.1.0.tar.gz" \
  --checksum "$RELEASE_DIR/squad-v1.1.0.tar.gz.sha256"

# Verify consumer modification preserved in README
if ! grep -q 'Consumer override' "$CONSUMER/.squad/README.md"; then
  echo "consumer modification to .squad/README.md was not preserved" >&2
  exit 1
fi

# Verify install state updated
NEW_VERSION="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$CONSUMER/.squad/install-state.json','utf8')).version)")"
if [[ "$NEW_VERSION" != "1.1.0" ]]; then
  echo "expected version 1.1.0, got $NEW_VERSION" >&2
  exit 1
fi

# Simulate an installed v1.0.4 consumer with the legacy unmanaged Lead block.
LEGACY_CONSUMER="$TMP_BASE/legacy-consumer"
mkdir -p "$LEGACY_CONSUMER"
git -C "$LEGACY_CONSUMER" init -q
bash "$REPO_ROOT/install.sh" \
  --target "$LEGACY_CONSUMER" \
  --version v1.0.0 \
  --archive "$RELEASE_DIR/squad-v1.0.0.tar.gz" \
  --checksum "$RELEASE_DIR/squad-v1.0.0.tar.gz.sha256"
cp "$REPO_ROOT/tests/fixtures/legacy-agents-v1.0.4.md" "$LEGACY_CONSUMER/AGENTS.md"

bash "$REPO_ROOT/update.sh" \
  --target "$LEGACY_CONSUMER" \
  --version v1.1.0 \
  --archive "$RELEASE_DIR/squad-v1.1.0.tar.gz" \
  --checksum "$RELEASE_DIR/squad-v1.1.0.tar.gz.sha256" \
  --yes

if ! grep -q 'existing consumer rule' "$LEGACY_CONSUMER/AGENTS.md"; then
  echo "legacy upgrade did not preserve consumer AGENTS.md rule" >&2
  exit 1
fi
assert_lead_contract_in_managed_section "$LEGACY_CONSUMER/AGENTS.md"
if ! grep -q 'XQ_SQUAD_MANAGED_START version:v1.1.0' "$LEGACY_CONSUMER/AGENTS.md"; then
  echo "legacy upgrade AGENTS.md marker version is not v1.1.0" >&2
  exit 1
fi

echo "upgrade tests passed"
