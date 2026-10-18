#!/usr/bin/env bash
# Minimal-environment install test: proves install.sh works with a restricted
# PATH containing only POSIX-ish tools — no node, no shasum — using the
# sha256_file fallbacks (sha256sum or openssl) and the POSIX AGENTS.md merge /
# install-state fallbacks.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_BASE="$(mktemp -d)"
trap 'rm -rf "$TMP_BASE"' EXIT

# Build the real v1.0.1 release archive under the normal PATH.
RELEASE_DIR="$TMP_BASE/releases"
bash "$REPO_ROOT/scripts/package-release.sh" --version v1.0.1 --output "$RELEASE_DIR" >/dev/null
ARCH="$RELEASE_DIR/squad-v1.0.1.tar.gz"
SUM="$ARCH.sha256"

# Resolve a tool to an absolute path: command -v first (covers builtins that
# return a bare name), then the usual binary directories.
resolve_tool() {
  local tool="$1" resolved cand
  resolved="$(command -v "$tool" 2>/dev/null || true)"
  if [[ "$resolved" == */* && -x "$resolved" ]]; then
    printf '%s' "$resolved"
    return 0
  fi
  for cand in /usr/bin /bin /sbin /usr/sbin /usr/local/bin /opt/homebrew/bin; do
    if [[ -x "$cand/$tool" ]]; then
      printf '%s' "$cand/$tool"
      return 0
    fi
  done
  return 1
}

# Populate a fake bin dir with symlinks to exactly the listed tools.
make_fakebin() {
  local dir="$1"; shift
  mkdir -p "$dir"
  local tool resolved
  for tool in "$@"; do
    if ! resolved="$(resolve_tool "$tool")"; then
      echo "cannot resolve required tool for fakebin: $tool" >&2
      return 1
    fi
    ln -sf "$resolved" "$dir/$tool"
  done
}

# Commands install.sh may invoke under the restricted PATH. Deliberately
# excludes node and shasum.
TOOLS_COMMON=(
  git curl tar grep sed awk tr printf mktemp cp mkdir cat file sh
  date dirname basename xargs find sort rm env head tail gzip
)

run_piped_install() {
  local fakebin="$1" target="$2"
  cat "$REPO_ROOT/install.sh" | env PATH="$fakebin" /bin/sh -s -- \
    --target "$target" \
    --version v1.0.1 \
    --archive "$ARCH" \
    --checksum "$SUM" \
    --yes
}

check_install() {
  local target="$1"
  for f in AGENTS.md .squad/squad.json .squad/install-state.json .devin/agents/analyst.md; do
    if [[ ! -e "$target/$f" ]]; then
      echo "Missing $f after minimal install" >&2
      exit 1
    fi
  done
  # install-state.json must be valid JSON with the expected fields (node is
  # available here in the test's own PATH).
  node -e "
    const s = JSON.parse(require('fs').readFileSync('$target/.squad/install-state.json', 'utf8'));
    if (s.version !== '1.0.1') throw new Error('version=' + s.version);
    if (s.release_tag !== 'v1.0.1') throw new Error('release_tag=' + s.release_tag);
    if (!s.config_schema_version) throw new Error('missing config_schema_version');
    if (!s.memory_schema_version) throw new Error('missing memory_schema_version');
    if (!s.installed_at) throw new Error('missing installed_at');
    if (!s.managed_files || Object.keys(s.managed_files).length === 0) throw new Error('empty managed_files');
    if (!s.ownership || !Array.isArray(s.ownership.upstream_managed)) throw new Error('bad ownership');
    if (!s.managed_files['AGENTS.md']) throw new Error('AGENTS.md not in managed_files');
  "
  if ! grep -q 'XQ_SQUAD_MANAGED_START version:v1.0.1' "$target/AGENTS.md"; then
    echo "managed section missing or wrong version in AGENTS.md" >&2
    exit 1
  fi
}

# --- Scenario 1: sha256sum available, no node, no shasum ---------------------
FAKEBIN_SUM="$TMP_BASE/fakebin-sha256sum"
make_fakebin "$FAKEBIN_SUM" "${TOOLS_COMMON[@]}" sha256sum
for absent in node shasum; do
  if [[ -e "$FAKEBIN_SUM/$absent" ]]; then
    echo "fakebin should not contain $absent" >&2
    exit 1
  fi
done

CONSUMER1="$TMP_BASE/consumer1"
mkdir -p "$CONSUMER1"
git -C "$CONSUMER1" init -q

run_piped_install "$FAKEBIN_SUM" "$CONSUMER1"
check_install "$CONSUMER1"

# --- Scenario 2: existing AGENTS.md merged via POSIX awk fallback ------------
CONSUMER2="$TMP_BASE/consumer2"
mkdir -p "$CONSUMER2"
git -C "$CONSUMER2" init -q
cp "$REPO_ROOT/tests/fixtures/existing-agents.md" "$CONSUMER2/AGENTS.md"

run_piped_install "$FAKEBIN_SUM" "$CONSUMER2"
check_install "$CONSUMER2"
if ! grep -q 'existing consumer rule' "$CONSUMER2/AGENTS.md"; then
  echo "existing AGENTS.md content not preserved by POSIX merge" >&2
  exit 1
fi

# --- Scenario 3: openssl only (no sha256sum, no shasum, no node) -------------
FAKEBIN_SSL="$TMP_BASE/fakebin-openssl"
make_fakebin "$FAKEBIN_SSL" "${TOOLS_COMMON[@]}" openssl
for absent in node shasum sha256sum; do
  if [[ -e "$FAKEBIN_SSL/$absent" ]]; then
    echo "fakebin should not contain $absent" >&2
    exit 1
  fi
done

CONSUMER3="$TMP_BASE/consumer3"
mkdir -p "$CONSUMER3"
git -C "$CONSUMER3" init -q

run_piped_install "$FAKEBIN_SSL" "$CONSUMER3"
check_install "$CONSUMER3"

echo "install-minimal tests passed"
