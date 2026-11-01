#!/usr/bin/env bash
# Dual-runtime install/upgrade: Cursor adapter alongside Devin, consumer-owned
# Cursor files preserved, Devin-only installs upgraded, deterministic packaging.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_BASE="$(mktemp -d)"
trap 'rm -rf "$TMP_BASE"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }
state_has() { node -e "process.exit(JSON.parse(require('fs').readFileSync('$1/.squad/install-state.json','utf8')).managed_files['$2'] ? 0 : 1)"; }

REL="$TMP_BASE/releases"
bash "$REPO_ROOT/scripts/package-release.sh" --version v1.3.0 --output "$REL" >/dev/null
bash "$REPO_ROOT/scripts/package-release.sh" --version v1.4.0 --output "$REL" >/dev/null
bash "$REPO_ROOT/scripts/package-release.sh" --version v1.4.0 --output "$TMP_BASE/again" >/dev/null
cmp -s "$REL/squad-v1.4.0.tar.gz.sha256" "$TMP_BASE/again/squad-v1.4.0.tar.gz.sha256" || fail "packaging is not deterministic"
LISTING="$(tar -tzf "$REL/squad-v1.4.0.tar.gz")"
for f in .cursor/rules/xq-squad.mdc .cursor/hooks.json .cursor/agents/tester.md .cursor/skills/squad-delivery/SKILL.md .cursor/hooks/xq-squad-git-guard.mjs .devin/agents/tester.md; do
  printf '%s\n' "$LISTING" | grep -qx "$f" || fail "archive missing $f"
done

# Devin-only v1.3.0: same release with no .cursor/ files.
OLD="$TMP_BASE/old"; mkdir -p "$OLD"
tar -xzf "$REL/squad-v1.3.0.tar.gz" -C "$OLD"
rm -rf "$OLD/.cursor"
(cd "$OLD" && find . -type f | sed 's|^\./||' | LC_ALL=C sort > "$TMP_BASE/old-files" && GZIP=-n tar -czf "$REL/squad-v1.3.0.tar.gz" -T "$TMP_BASE/old-files")
shasum -a 256 "$REL/squad-v1.3.0.tar.gz" | awk '{print $1}' > "$REL/squad-v1.3.0.tar.gz.sha256"

install_v() { bash "$REPO_ROOT/install.sh" --target "$1" --version "$2" --archive "$REL/squad-$2.tar.gz" --checksum "$REL/squad-$2.tar.gz.sha256"; }
update_v() { bash "$REPO_ROOT/update.sh" --target "$1" --version "$2" --archive "$REL/squad-$2.tar.gz" --checksum "$REL/squad-$2.tar.gz.sha256" "${@:3}"; }

# 1. Fresh install into a repo that already has Cursor config.
C1="$TMP_BASE/c1"; mkdir -p "$C1/.cursor/rules" "$C1/.cursor/agents"; git -C "$C1" init -q
printf -- '---\ndescription: team\nalwaysApply: true\n---\nteam rule\n' > "$C1/.cursor/rules/team.mdc"
printf 'consumer tester\n' > "$C1/.cursor/agents/tester.md"
printf '{"version":1,"hooks":{"afterFileEdit":[{"command":"./fmt.sh"}]}}\n' > "$C1/.cursor/hooks.json"
OUT="$(install_v "$C1" v1.4.0)"
grep -q 'team rule' "$C1/.cursor/rules/team.mdc" || fail "consumer rule changed"
[ "$(cat "$C1/.cursor/agents/tester.md")" = "consumer tester" ] || fail "consumer agent overwritten"
[ -f "$C1/.cursor/agents/tester.md.squad-upstream" ] || fail "no sidecar for kept consumer agent"
printf '%s\n' "$OUT" | grep -q '.cursor/agents/tester.md' || fail "kept file not reported"
state_has "$C1" .cursor/agents/tester.md && fail "kept consumer file recorded as managed"
state_has "$C1" .cursor/agents/analyst.md || fail ".cursor files not tracked"
state_has "$C1" .devin/agents/analyst.md || fail ".devin files not tracked"
node -e "
const h=JSON.parse(require('fs').readFileSync('$C1/.cursor/hooks.json','utf8')).hooks;
if(h.afterFileEdit[0].command!=='./fmt.sh') process.exit(1);
if(!h.beforeShellExecution.some(e=>e.command.includes('xq-squad-git-guard'))) process.exit(1);" || fail "hooks.json not merged"
[ -f "$C1/.cursor/skills/squad-delivery/SKILL.md" ] && [ -f "$C1/.devin/skills/squad-delivery/SKILL.md" ] || fail "both adapters not installed"
node "$REPO_ROOT/scripts/validate-cursor-adapter.mjs" "$REPO_ROOT/distribution" || fail "adapter invalid"
if install_v "$C1" v1.4.0 >/dev/null 2>&1; then fail "repeat install should refuse"; fi

# 2. Upgrade a Devin-only v1.3.0 install with consumer Cursor files.
C2="$TMP_BASE/c2"; mkdir -p "$C2"; git -C "$C2" init -q
install_v "$C2" v1.3.0 >/dev/null
[ -d "$C2/.cursor" ] && fail "v1.3.0 fixture should be Devin-only"
mkdir -p "$C2/.cursor/rules"
printf 'mine\n' > "$C2/.cursor/rules/local-mine.mdc"
printf '{"version":1,"hooks":{"stop":[{"command":"./mine.sh"}]}}\n' > "$C2/.cursor/hooks.json"
update_v "$C2" v1.4.0 >/dev/null
[ "$(cat "$C2/.cursor/rules/local-mine.mdc")" = "mine" ] || fail "consumer-owned rule changed"
[ -f "$C2/.cursor/agents/reviewer.md" ] || fail ".cursor agents not adopted"
state_has "$C2" .cursor/agents/reviewer.md || fail "adopted files not tracked"
node -e "
const h=JSON.parse(require('fs').readFileSync('$C2/.cursor/hooks.json','utf8')).hooks;
if(h.stop[0].command!=='./mine.sh'||h.stop.length!==2) process.exit(1);" || fail "consumer stop hook lost"
update_v "$C2" v1.4.0 | grep -q 'Already at v1.4.0' || fail "repeat update not a no-op"

# 3. Modified managed Cursor file + upstream change -> conflict, consumer kept.
C3="$TMP_BASE/c3"; mkdir -p "$C3"; git -C "$C3" init -q
install_v "$C3" v1.3.0 >/dev/null
update_v "$C3" v1.4.0 >/dev/null
printf 'consumer edit\n' >> "$C3/.cursor/agents/tester.md"
NEXT="$TMP_BASE/next"; mkdir -p "$NEXT"; tar -xzf "$REL/squad-v1.4.0.tar.gz" -C "$NEXT"
printf 'upstream edit\n' >> "$NEXT/.cursor/agents/tester.md"
(cd "$NEXT" && find . -type f | sed 's|^\./||' | LC_ALL=C sort > "$TMP_BASE/next-files" && GZIP=-n tar -czf "$REL/squad-v1.4.1.tar.gz" -T "$TMP_BASE/next-files")
shasum -a 256 "$REL/squad-v1.4.1.tar.gz" | awk '{print $1}' > "$REL/squad-v1.4.1.tar.gz.sha256"
if update_v "$C3" v1.4.1 >"$TMP_BASE/u3.log" 2>&1; then fail "conflicting update should exit non-zero"; fi
grep -q '.cursor/agents/tester.md' "$TMP_BASE/u3.log" || fail "conflict not reported"
grep -q 'consumer edit' "$C3/.cursor/agents/tester.md" || fail "consumer edit lost"
grep -q 'upstream edit' "$C3/.cursor/agents/tester.md" && fail "upstream silently merged"
grep -q 'upstream edit' "$C3/.cursor/agents/tester.md.squad-upstream" || fail "sidecar missing"

echo "install-cursor tests passed"
