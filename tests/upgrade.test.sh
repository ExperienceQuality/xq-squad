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

# Simulate a genuinely older release that predates the train-me skill so the
# v1.1.0 upgrade exercises new-managed-file adoption (v1.0.0 must not ship it).
OLD_STAGE="$TMP_BASE/old-dist"
mkdir -p "$OLD_STAGE"
tar -xzf "$RELEASE_DIR/squad-v1.0.0.tar.gz" -C "$OLD_STAGE"
rm -f "$OLD_STAGE/.devin/skills/train-me/SKILL.md"
(
  cd "$OLD_STAGE"
  find . -type f | sed 's|^\./||' | LC_ALL=C sort > "$TMP_BASE/old-files"
  GZIP=-n tar -czf "$RELEASE_DIR/squad-v1.0.0.tar.gz" -T "$TMP_BASE/old-files"
)
shasum -a 256 "$RELEASE_DIR/squad-v1.0.0.tar.gz" | awk '{print $1}' \
  > "$RELEASE_DIR/squad-v1.0.0.tar.gz.sha256"

bash "$REPO_ROOT/install.sh" \
  --target "$CONSUMER" \
  --version v1.0.0 \
  --archive "$RELEASE_DIR/squad-v1.0.0.tar.gz" \
  --checksum "$RELEASE_DIR/squad-v1.0.0.tar.gz.sha256"

# Simulate consumer modification to a managed file (not AGENTS.md)
echo "# Consumer override" >> "$CONSUMER/.squad/README.md"

# Simulate consumer-owned delivery memory that must survive the upgrade.
mkdir -p "$CONSUMER/.squad/memory/deliveries"
printf '{"id":"D1","type":"delivery_event","topic":"t","summary":"consumer memory"}\n' \
  > "$CONSUMER/.squad/memory/deliveries/demo.ndjson"

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

# Consumer-owned delivery memory preserved across upgrade
if ! grep -q 'consumer memory' "$CONSUMER/.squad/memory/deliveries/demo.ndjson"; then
  echo "consumer delivery memory was not preserved across upgrade" >&2
  exit 1
fi

# New managed concurrent-delivery helpers present after upgrade
for m in delivery-scope delivery-registry delivery-worktree delivery-session delivery-verify; do
  if [[ ! -f "$CONSUMER/.squad/scripts/$m.mjs" ]]; then
    echo "managed concurrent-delivery helper missing after upgrade: $m.mjs" >&2
    exit 1
  fi
done

# Managed files first shipped in the new release are installed and registered
# even though the previous manifest never recorded them.
if [[ ! -f "$CONSUMER/.devin/skills/train-me/SKILL.md" ]]; then
  echo "new managed file missing after upgrade: .devin/skills/train-me/SKILL.md" >&2
  exit 1
fi
if ! node -e "const s=JSON.parse(require('fs').readFileSync('$CONSUMER/.squad/install-state.json','utf8'));process.exit(s.managed_files['.devin/skills/train-me/SKILL.md']?0:1)"; then
  echo "new managed file not registered in install-state.json managed_files" >&2
  exit 1
fi

# A differing consumer file at a new managed path is not overwritten.
CONFLICT_CONSUMER="$TMP_BASE/conflict-consumer"
mkdir -p "$CONFLICT_CONSUMER"
git -C "$CONFLICT_CONSUMER" init -q
bash "$REPO_ROOT/install.sh" \
  --target "$CONFLICT_CONSUMER" \
  --version v1.0.0 \
  --archive "$RELEASE_DIR/squad-v1.0.0.tar.gz" \
  --checksum "$RELEASE_DIR/squad-v1.0.0.tar.gz.sha256"
mkdir -p "$CONFLICT_CONSUMER/.devin/skills/train-me"
echo "consumer-owned content" > "$CONFLICT_CONSUMER/.devin/skills/train-me/SKILL.md"
git -C "$CONFLICT_CONSUMER" add -A && git -C "$CONFLICT_CONSUMER" -c user.email=t@t -c user.name=t commit -qm init
if bash "$REPO_ROOT/update.sh" \
  --target "$CONFLICT_CONSUMER" \
  --version v1.1.0 \
  --archive "$RELEASE_DIR/squad-v1.1.0.tar.gz" \
  --checksum "$RELEASE_DIR/squad-v1.1.0.tar.gz.sha256" 2>"$TMP_BASE/conflict-err"; then
  echo "update should have reported a conflict on consumer-owned new managed path" >&2
  exit 1
fi
if ! grep -q 'consumer file exists at new managed path' "$TMP_BASE/conflict-err"; then
  echo "expected conflict report for new managed path, got:" >&2
  cat "$TMP_BASE/conflict-err" >&2
  exit 1
fi
if ! grep -q 'consumer-owned content' "$CONFLICT_CONSUMER/.devin/skills/train-me/SKILL.md"; then
  echo "consumer file at new managed path was overwritten" >&2
  exit 1
fi

echo "upgrade tests passed"
