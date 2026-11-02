#!/usr/bin/env bash
# Upgrading a 1.x install that has the retired Devin adapter (decision D1):
# T1-T8 from SPEC §17.2. The old release is the current distribution plus the
# eight .devin/ files shipped in v1.4.0 (tests/fixtures/legacy-devin-adapter).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_BASE="$(mktemp -d)"
trap 'rm -rf "$TMP_BASE"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }
LEGACY="$REPO_ROOT/tests/fixtures/legacy-devin-adapter"
DEVIN_FILES="$(cd "$LEGACY" && find .devin -type f | LC_ALL=C sort)"
[ "$(printf '%s\n' "$DEVIN_FILES" | wc -l | tr -d ' ')" = 8 ] || fail "legacy fixture must hold 8 .devin files"

# Run without a controlling terminal so /dev/tty cannot be opened.
notty() { if command -v setsid >/dev/null 2>&1; then setsid -w "$@"; else "$@"; fi; }

repack() { # repack <dir> <archive>
  (cd "$1" && find . -type f | sed 's|^\./||' | LC_ALL=C sort > "$TMP_BASE/files" && tar -cf - -T "$TMP_BASE/files" | gzip -n > "$2")
  shasum -a 256 "$2" | awk '{print $1}' > "$2.sha256"
}

REL="$TMP_BASE/rel"
bash "$REPO_ROOT/scripts/package-release.sh" --version v1.4.0 --output "$REL" >/dev/null
bash "$REPO_ROOT/scripts/package-release.sh" --version v2.0.0 --output "$REL" >/dev/null
OLD="$TMP_BASE/old"; mkdir -p "$OLD"; tar -xzf "$REL/squad-v1.4.0.tar.gz" -C "$OLD"
cp -R "$LEGACY/.devin" "$OLD/.devin"
rm -f "$OLD/.squad/retired.json"
node -e "
const f='$OLD/.squad/squad.json', s=JSON.parse(require('fs').readFileSync(f,'utf8'));
s.version='1.4.0'; s.release_tag='v1.4.0';
s.ownership.upstream_managed.unshift('.devin/agents/**','.devin/skills/**','.devin/rules/**');
s.ownership.consumer_owned.push('.devin/rules/local-*','.devin/agents/local-*');
require('fs').writeFileSync(f, JSON.stringify(s,null,2)+'\n');"
repack "$OLD" "$REL/squad-v1.4.0.tar.gz"

# T8 release: v2.0.0 with an upstream change to a shipped file.
CONFLICT_REL="$TMP_BASE/conflict-rel"; mkdir -p "$CONFLICT_REL" "$TMP_BASE/c8dist"
tar -xzf "$REL/squad-v2.0.0.tar.gz" -C "$TMP_BASE/c8dist"
printf 'upstream edit\n' >> "$TMP_BASE/c8dist/.cursor/agents/tester.md"
repack "$TMP_BASE/c8dist" "$CONFLICT_REL/squad-v2.0.0.tar.gz"

# A 1.x install: the 1.x installer copied .devin/ and recorded it as managed
# (the 2.x installer does neither, so both are reproduced here).
install_1x() {
  mkdir -p "$1"; git -C "$1" init -q
  bash "$REPO_ROOT/install.sh" --target "$1" --version v1.4.0 --archive "$REL/squad-v1.4.0.tar.gz" --checksum "$REL/squad-v1.4.0.tar.gz.sha256" >/dev/null
  cp -R "$OLD/.devin" "$1/.devin"
  node -e "
const fs=require('fs'), c=require('crypto'), t='$1', f=t+'/.squad/install-state.json', s=JSON.parse(fs.readFileSync(f,'utf8'));
for (const rel of process.argv.slice(1)) s.managed_files[rel]=c.createHash('sha256').update(fs.readFileSync(t+'/'+rel)).digest('hex');
delete s.retired_files;
fs.writeFileSync(f, JSON.stringify(s,null,2)+'\n');" $DEVIN_FILES
  git -C "$1" add -A && git -C "$1" -c user.email=t@t -c user.name=t commit -qm 1.x
}
update_to() { # update_to <target> <release-dir> [flags...]
  local t="$1" r="$2"; shift 2
  notty bash "$REPO_ROOT/update.sh" --target "$t" --version v2.0.0 --archive "$r/squad-v2.0.0.tar.gz" --checksum "$r/squad-v2.0.0.tar.gz.sha256" "$@"
}
state() { node -e "const s=JSON.parse(require('fs').readFileSync('$1/.squad/install-state.json','utf8')); console.log(JSON.stringify($2))"; }
no_retired_managed() { [ "$(state "$1" "Object.keys(s.managed_files).filter(k=>k.startsWith('.devin/')).length")" = 0 ] || fail "$2: retired paths left in managed_files"; }

# T1: --yes removes all eight unmodified files and the directory.
C="$TMP_BASE/t1"; install_1x "$C"
OUT="$(update_to "$C" "$REL" --yes </dev/null)" || fail "T1: update failed"
[ -e "$C/.devin" ] && fail "T1: .devin/ left behind"
for f in $DEVIN_FILES; do printf '%s\n' "$OUT" | grep -q "removed   $f" || fail "T1: no removal notice for $f"; done
printf '%s\n' "$OUT" | grep -q 'XQ Squad 2.0.0: the Devin adapter was retired (decision D1: xq-squad supports Cursor only).' || fail "T1: deprecation headline missing"
printf '%s\n' "$OUT" | grep -q 'See "Upgrading from 1.x" in the README.' || fail "T1: README pointer missing"
no_retired_managed "$C" T1
[ "$(state "$C" s.retired_files)" = '{}' ] || fail "T1: retired_files not empty"
[ "$(state "$C" s.version)" = '"2.0.0"' ] || fail "T1: version not 2.0.0"

# T2: non-interactive, no flag -> keep and record in retired_files.
C="$TMP_BASE/t2"; install_1x "$C"
OUT="$(update_to "$C" "$REL" </dev/null)" || fail "T2: update failed"
for f in $DEVIN_FILES; do [ -f "$C/$f" ] || fail "T2: $f removed without consent"; done
printf '%s\n' "$OUT" | grep -q 'kept      .devin/agents/analyst.md   (unmodified; rerun update.sh with --remove-retired to delete)' || fail "T2: kept notice missing"
no_retired_managed "$C" T2
[ "$(state "$C" "Object.keys(s.retired_files).length")" = 8 ] || fail "T2: retired_files does not list 8 files"
[ "$(state "$C" "s.retired_files['.devin/agents/analyst.md'].since")" = '"2.0.0"' ] || fail "T2: since missing"

# T3: one edited retired file is reported as modified, kept; others removed.
C="$TMP_BASE/t3"; install_1x "$C"
printf 'my edit\n' >> "$C/.devin/skills/train-me/SKILL.md"
git -C "$C" -c user.email=t@t -c user.name=t commit -qam edit
OUT="$(update_to "$C" "$REL" --remove-retired </dev/null)" || fail "T3: modified retired file failed the update"
grep -q 'my edit' "$C/.devin/skills/train-me/SKILL.md" || fail "T3: modified file touched"
printf '%s\n' "$OUT" | grep -q 'modified  .devin/skills/train-me/SKILL.md   (retired by D1; keep or delete by hand)' || fail "T3: modified notice missing"
[ -e "$C/.devin/agents" ] && fail "T3: unmodified files not removed"
no_retired_managed "$C" T3
[ "$(state "$C" s.retired_files)" = '{}' ] || fail "T3: modified file recorded in retired_files"

# T4 + T5: consumer local-* files untouched; ownership is the 2.0.0 ownership.
C="$TMP_BASE/t4"; install_1x "$C"
mkdir -p "$C/.devin/rules"
printf 'mine\n' > "$C/.devin/rules/local-mine.md"; printf 'x\n' > "$C/.devin/agents/local-x.md"
OUT="$(update_to "$C" "$REL" --yes </dev/null)" || fail "T4: update failed"
[ "$(cat "$C/.devin/rules/local-mine.md")" = mine ] && [ "$(cat "$C/.devin/agents/local-x.md")" = x ] || fail "T4: consumer local-* files touched"
[ -e "$C/.devin/agents/analyst.md" ] && fail "T4: retired file kept"
printf '%s\n' "$OUT" | grep -q 'Your own .devin/rules/local-\* and .devin/agents/local-\* files were not touched.' || fail "T4: local-* line missing"
[ "$(state "$C" s.ownership)" = "$(node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync('$REPO_ROOT/distribution/.squad/squad.json','utf8')).ownership))")" ] || fail "T5: ownership not refreshed from 2.0.0 squad.json"

# T6: same-version --remove-retired bypasses "Already at" and removes kept files.
C="$TMP_BASE/t6"; install_1x "$C"
update_to "$C" "$REL" </dev/null >/dev/null || fail "T6: first update failed"
update_to "$C" "$REL" </dev/null | grep -q 'Already at v2.0.0' || fail "T6: plain rerun not a no-op"
[ -f "$C/.devin/agents/analyst.md" ] || fail "T6: plain rerun removed files"
OUT="$(update_to "$C" "$REL" --remove-retired </dev/null)" || fail "T6: retired-only pass failed"
printf '%s\n' "$OUT" | grep -q 'removed   .devin/agents/analyst.md' || fail "T6: no removal notice"
[ -e "$C/.devin" ] && fail "T6: kept files not removed"
[ "$(state "$C" s.retired_files)" = '{}' ] || fail "T6: retired_files not cleared"

# T7: piped execution without /dev/tty behaves like T2.
C="$TMP_BASE/t7"; install_1x "$C"
OUT="$(cat "$REPO_ROOT/update.sh" | notty sh -s -- --target "$C" --version v2.0.0 --archive "$REL/squad-v2.0.0.tar.gz" --checksum "$REL/squad-v2.0.0.tar.gz.sha256")" || fail "T7: piped update failed"
for f in $DEVIN_FILES; do [ -f "$C/$f" ] || fail "T7: $f removed without consent"; done
[ "$(state "$C" "Object.keys(s.retired_files).length")" = 8 ] || fail "T7: retired_files does not list 8 files"
printf '%s\n' "$OUT" | grep -q 'kept      .devin/agents/analyst.md' || fail "T7: kept notice missing"

# T8: a real conflict on a shipped file exits 1; retired notices still print.
C="$TMP_BASE/t8"; install_1x "$C"
printf 'consumer edit\n' >> "$C/.cursor/agents/tester.md"
git -C "$C" -c user.email=t@t -c user.name=t commit -qam edit
if update_to "$C" "$CONFLICT_REL" --yes </dev/null >"$TMP_BASE/t8.out" 2>"$TMP_BASE/t8.err"; then fail "T8: conflict did not fail the update"; fi
grep -q '.cursor/agents/tester.md' "$TMP_BASE/t8.err" || fail "T8: conflict not reported"
grep -q 'removed   .devin/agents/analyst.md' "$TMP_BASE/t8.out" || fail "T8: retired notices not printed"
grep -q 'consumer edit' "$C/.cursor/agents/tester.md" || fail "T8: consumer edit lost"

echo "upgrade-retired tests passed"
