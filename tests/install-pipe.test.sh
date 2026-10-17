#!/usr/bin/env bash
# Pipe-mode install test: proves install.sh works when streamed into `sh`
# (POSIX), self-contained (helpers ship inside the release archive), and
# non-interactive safe (--yes / dirty-tree refusal).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_BASE="$(mktemp -d)"
trap 'rm -rf "$TMP_BASE"' EXIT

# Build a local release archive
RELEASE_DIR="$TMP_BASE/releases"
bash "$REPO_ROOT/scripts/package-release.sh" --version v1.0.0 --output "$RELEASE_DIR"
ARCH="$RELEASE_DIR/squad-v1.0.0.tar.gz"
SUM="$ARCH.sha256"

# --- Scenario 1: piped install into a clean repo ---------------------------
CONSUMER="$TMP_BASE/consumer"
mkdir -p "$CONSUMER"
git -C "$CONSUMER" init -q

cat "$REPO_ROOT/install.sh" | sh -s -- \
  --target "$CONSUMER" \
  --version v1.0.0 \
  --archive "$ARCH" \
  --checksum "$SUM" \
  --yes

for f in AGENTS.md \
         .squad/squad.json \
         .squad/install-state.json \
         .devin/skills/squad-delivery/SKILL.md \
         .squad/scripts/merge-agents.mjs; do
  if [[ ! -e "$CONSUMER/$f" ]]; then
    echo "Missing $f after piped install" >&2
    exit 1
  fi
done

STATE_VERSION="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$CONSUMER/.squad/install-state.json','utf8')).version)")"
if [[ "$STATE_VERSION" != "1.0.0" ]]; then
  echo "expected install-state version 1.0.0, got $STATE_VERSION" >&2
  exit 1
fi

# --- Scenario 2: dirty tree + piped (non-TTY) stdin without --yes ----------
CONSUMER2="$TMP_BASE/consumer2"
mkdir -p "$CONSUMER2"
git -C "$CONSUMER2" init -q
echo "base" > "$CONSUMER2/AGENTS.md"
git -C "$CONSUMER2" add AGENTS.md
git -C "$CONSUMER2" -c user.email=test@example.com -c user.name=Test commit -qm init
echo "uncommitted edit" >> "$CONSUMER2/AGENTS.md"

set +e
ERR_OUTPUT="$(cat "$REPO_ROOT/install.sh" | sh -s -- \
  --target "$CONSUMER2" \
  --version v1.0.0 \
  --archive "$ARCH" \
  --checksum "$SUM" 2>&1)"
STATUS=$?
set -e

if [[ $STATUS -eq 0 ]]; then
  echo "piped install should have failed on dirty tree without --yes" >&2
  exit 1
fi
if ! grep -q -- '--yes' <<<"$ERR_OUTPUT"; then
  echo "error output should mention --yes, got: $ERR_OUTPUT" >&2
  exit 1
fi

# --- Scenario 3: same dirty tree with --yes succeeds -----------------------
cat "$REPO_ROOT/install.sh" | sh -s -- \
  --target "$CONSUMER2" \
  --version v1.0.0 \
  --archive "$ARCH" \
  --checksum "$SUM" \
  --yes

if [[ ! -f "$CONSUMER2/.squad/install-state.json" ]]; then
  echo "install-state.json missing after --yes install on dirty tree" >&2
  exit 1
fi

echo "install-pipe tests passed"
