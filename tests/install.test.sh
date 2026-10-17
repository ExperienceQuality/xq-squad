#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_BASE="$(mktemp -d)"
trap 'rm -rf "$TMP_BASE"' EXIT

CONSUMER="$TMP_BASE/consumer"
mkdir -p "$CONSUMER"
git -C "$CONSUMER" init -q

# Build a local release archive
RELEASE_DIR="$TMP_BASE/releases"
bash "$REPO_ROOT/scripts/package-release.sh" --version v1.0.0 --output "$RELEASE_DIR"

# Test fresh install from local archive
bash "$REPO_ROOT/install.sh" \
  --target "$CONSUMER" \
  --version v1.0.0 \
  --archive "$RELEASE_DIR/squad-v1.0.0.tar.gz" \
  --checksum "$RELEASE_DIR/squad-v1.0.0.tar.gz.sha256"

# Verify key files
for f in AGENTS.md .squad/squad.json .devin/agents/analyst.md .devin/skills/squad-delivery/SKILL.md; do
  if [[ ! -e "$CONSUMER/$f" ]]; then
    echo "Missing $f after install" >&2
    exit 1
  fi
done

# Verify install state
if [[ ! -f "$CONSUMER/.squad/install-state.json" ]]; then
  echo "install-state.json missing" >&2
  exit 1
fi

# Test idempotency: running again should fail because existing installation detected
if bash "$REPO_ROOT/install.sh" \
  --target "$CONSUMER" \
  --version v1.0.0 \
  --archive "$RELEASE_DIR/squad-v1.0.0.tar.gz" \
  --checksum "$RELEASE_DIR/squad-v1.0.0.tar.gz.sha256" 2>/dev/null; then
  echo "install should have failed on existing squad" >&2
  exit 1
fi

# Test AGENTS.md merge with existing file
CONSUMER2="$TMP_BASE/consumer2"
mkdir -p "$CONSUMER2"
git -C "$CONSUMER2" init -q
cp "$REPO_ROOT/tests/fixtures/existing-agents.md" "$CONSUMER2/AGENTS.md"

bash "$REPO_ROOT/install.sh" \
  --target "$CONSUMER2" \
  --version v1.0.0 \
  --archive "$RELEASE_DIR/squad-v1.0.0.tar.gz" \
  --checksum "$RELEASE_DIR/squad-v1.0.0.tar.gz.sha256"

if ! grep -q 'existing consumer rule' "$CONSUMER2/AGENTS.md"; then
  echo "existing AGENTS.md instructions not preserved" >&2
  exit 1
fi
if ! grep -q 'XQ_SQUAD_MANAGED_START' "$CONSUMER2/AGENTS.md"; then
  echo "managed section missing" >&2
  exit 1
fi

echo "install tests passed"
