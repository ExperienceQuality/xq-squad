#!/usr/bin/env bash
# Node.js 22 floor and downgrade guard (SPEC §17.3): update.sh refuses Node <22
# or no Node before changing anything; install.sh installs without hooks and
# warns; update.sh refuses a downgrade without --allow-downgrade.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_BASE="$(mktemp -d)"
trap 'rm -rf "$TMP_BASE"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }
BASH_BIN="$(command -v bash)"
HOOK_WARNING='XQ Squad: Node 22+ not found, so Cursor hooks were NOT installed and guardrails are UNENFORCED. Install Node 22+ and rerun update.sh.'

REL="$TMP_BASE/rel"
for v in v1.4.0 v2.0.0 v2.0.1; do bash "$REPO_ROOT/scripts/package-release.sh" --version "$v" --output "$REL" >/dev/null; done

# Fake Node 20 first on PATH.
FAKE20="$TMP_BASE/node20"; mkdir -p "$FAKE20"
printf '#!/bin/sh\n[ "$1" = --version ] && { echo v20.11.1; exit 0; }\necho "fake node 20 must not run scripts" >&2\nexit 1\n' > "$FAKE20/node"
chmod +x "$FAKE20/node"
# PATH without any node at all.
NONODE="$TMP_BASE/nonode"; mkdir -p "$NONODE"
for d in /usr/local/bin /usr/bin /bin; do
  for f in "$d"/*; do
    n="$(basename "$f")"
    case "$n" in node|nodejs|npm|npx|corepack) continue ;; esac
    [ -e "$NONODE/$n" ] || ln -s "$f" "$NONODE/$n"
  done
done
PATH="$NONODE" command -v node >/dev/null 2>&1 && fail "could not build a PATH without node"

install_v() { bash "$REPO_ROOT/install.sh" --target "$1" --version "$2" --archive "$REL/squad-$2.tar.gz" --checksum "$REL/squad-$2.tar.gz.sha256" "${@:3}"; }
update_v() { bash "$REPO_ROOT/update.sh" --target "$1" --version "$2" --archive "$REL/squad-$2.tar.gz" --checksum "$REL/squad-$2.tar.gz.sha256" "${@:3}"; }
new_repo() { mkdir -p "$1"; git -C "$1" init -q; }
snapshot() { (cd "$1" && find . -path ./.git -prune -o -type f -print | LC_ALL=C sort | xargs shasum -a 256); }

# update.sh with Node 20 exits 1 before changing anything.
C="$TMP_BASE/upd20"; new_repo "$C"; install_v "$C" v2.0.0 >/dev/null
BEFORE="$(snapshot "$C")"
if PATH="$FAKE20:$PATH" update_v "$C" v2.0.1 >"$TMP_BASE/o" 2>"$TMP_BASE/e"; then fail "update.sh ran with Node 20"; fi
grep -qx 'XQ Squad: Node.js 22 or newer is required (found v20.11.1). Install Node 22+ and rerun update.sh.' "$TMP_BASE/e" || fail "update.sh Node 20 message: $(cat "$TMP_BASE/e")"
[ "$(snapshot "$C")" = "$BEFORE" ] || fail "update.sh changed files before the Node check"

# update.sh without Node exits 1 and says "found none".
if PATH="$NONODE" "$BASH_BIN" "$REPO_ROOT/update.sh" --target "$C" --version v2.0.1 --archive "$REL/squad-v2.0.1.tar.gz" --checksum "$REL/squad-v2.0.1.tar.gz.sha256" 2>"$TMP_BASE/e"; then fail "update.sh ran without Node"; fi
grep -qx 'XQ Squad: Node.js 22 or newer is required (found none). Install Node 22+ and rerun update.sh.' "$TMP_BASE/e" || fail "update.sh no-Node message: $(cat "$TMP_BASE/e")"
[ "$(snapshot "$C")" = "$BEFORE" ] || fail "update.sh changed files without Node"

# install.sh with Node 20: installs, skips hooks.json, warns.
C="$TMP_BASE/inst20"; new_repo "$C"
PATH="$FAKE20:$PATH" install_v "$C" v2.0.0 >"$TMP_BASE/o" 2>"$TMP_BASE/e" || fail "install.sh failed with Node 20: $(cat "$TMP_BASE/e")"
grep -qxF "$HOOK_WARNING" "$TMP_BASE/e" || fail "install.sh Node 20 warning missing"
[ -f "$C/.cursor/agents/tester.md" ] && [ -f "$C/.squad/squad.json" ] && [ -f "$C/AGENTS.md" ] || fail "install.sh with Node 20 did not install the squad"
[ -e "$C/.cursor/hooks.json" ] && fail "hooks.json written without Node 22"
node -e "process.exit(JSON.parse(require('fs').readFileSync('$C/.squad/install-state.json','utf8')).managed_files['.cursor/hooks.json'] ? 0 : 1)" && fail "unwritten hooks.json recorded as managed"
grep -q '"retired_files": {}' "$C/.squad/install-state.json" || fail "POSIX state writer missing retired_files"
# Rerunning update.sh with Node 22+ at the same version installs the hooks.
update_v "$C" v2.0.0 >/dev/null || fail "same-version update.sh with Node 22 failed"
grep -q 'xq-squad-git-guard' "$C/.cursor/hooks.json" || fail "same-version update.sh did not install hooks"
update_v "$C" v2.0.0 | grep -q 'Already at v2.0.0' || fail "rerun after hooks install not a no-op"

# install.sh with Node 20 leaves a consumer hooks.json untouched.
C="$TMP_BASE/inst20-hooks"; new_repo "$C"; mkdir -p "$C/.cursor"
printf '{"version":1,"hooks":{"stop":[{"command":"./mine.sh"}]}}\n' > "$C/.cursor/hooks.json"
cp "$C/.cursor/hooks.json" "$TMP_BASE/hooks.orig"
PATH="$FAKE20:$PATH" install_v "$C" v2.0.0 >/dev/null 2>"$TMP_BASE/e" || fail "install.sh failed with Node 20 and consumer hooks"
cmp -s "$C/.cursor/hooks.json" "$TMP_BASE/hooks.orig" || fail "consumer hooks.json changed without Node 22"
[ -e "$C/.cursor/hooks.json.squad-upstream" ] && fail "hooks.json sidecar written without Node 22"

# install.sh without Node: same behaviour.
C="$TMP_BASE/inst-none"; new_repo "$C"
PATH="$NONODE" "$BASH_BIN" "$REPO_ROOT/install.sh" --target "$C" --version v2.0.0 --archive "$REL/squad-v2.0.0.tar.gz" --checksum "$REL/squad-v2.0.0.tar.gz.sha256" >/dev/null 2>"$TMP_BASE/e" || fail "install.sh failed without Node: $(cat "$TMP_BASE/e")"
grep -qxF "$HOOK_WARNING" "$TMP_BASE/e" || fail "install.sh no-Node warning missing"
[ -e "$C/.cursor/hooks.json" ] && fail "hooks.json written without Node"

# install.sh with Node 22+: hooks installed, no warning.
C="$TMP_BASE/inst22"; new_repo "$C"
install_v "$C" v2.0.0 >/dev/null 2>"$TMP_BASE/e"
grep -q 'guardrails are UNENFORCED' "$TMP_BASE/e" && fail "warning printed with Node 22"
grep -q 'xq-squad-git-guard' "$C/.cursor/hooks.json" || fail "hooks not installed with Node 22"

# Downgrade guard.
git -C "$C" add -A && git -C "$C" -c user.email=t@t -c user.name=t commit -qm init
if update_v "$C" v1.4.0 >/dev/null 2>"$TMP_BASE/e"; then fail "downgrade allowed without --allow-downgrade"; fi
grep -q 'refusing to downgrade from 2.0.0 to 1.4.0; pass --allow-downgrade' "$TMP_BASE/e" || fail "downgrade message: $(cat "$TMP_BASE/e")"
grep -q '"version": "2.0.0"' "$C/.squad/install-state.json" || fail "refused downgrade changed install-state"
update_v "$C" v1.4.0 --allow-downgrade >/dev/null || fail "--allow-downgrade did not proceed"
grep -q '"version": "1.4.0"' "$C/.squad/install-state.json" || fail "--allow-downgrade did not record 1.4.0"

echo "node-floor tests passed"
