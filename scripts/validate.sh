#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${REPO_ROOT}/distribution"

errors=0

error() {
  echo "Error: $1" >&2
  errors=$((errors + 1))
}

[[ -d "$DIST_DIR" ]] || error "distribution directory missing"
[[ -f "$DIST_DIR/AGENTS.md" ]] || error "AGENTS.md missing"
[[ -f "$DIST_DIR/.squad/squad.json" ]] || error ".squad/squad.json missing"
[[ -f "$DIST_DIR/.squad/schemas/memory-record.schema.json" ]] || error "memory schema missing"
[[ -f "$DIST_DIR/.squad/schemas/squad-config.schema.json" ]] || error "config schema missing"
[[ -f "$DIST_DIR/.squad/schemas/delivery-session.schema.json" ]] || error "delivery-session schema missing"
[[ -f "$DIST_DIR/.squad/workflows/concurrent-delivery.md" ]] || error "concurrent-delivery workflow missing"
for m in delivery-scope delivery-registry delivery-worktree delivery-session delivery-verify; do
  [[ -f "$DIST_DIR/.squad/scripts/$m.mjs" ]] || error "concurrent-delivery helper missing: .squad/scripts/$m.mjs"
done
[[ -f "$DIST_DIR/.devin/skills/squad-delivery/SKILL.md" ]] || error "delivery skill missing"
[[ -f "$DIST_DIR/.squad/agents/lead.md" ]] || error "Lead contract missing"

# AGENTS.md size check (16 KiB limit for Devin auto-injection)
if [[ -f "$DIST_DIR/AGENTS.md" ]]; then
  size=$(wc -c < "$DIST_DIR/AGENTS.md")
  if [[ "$size" -gt 16384 ]]; then
    error "AGENTS.md exceeds 16 KiB: $size bytes"
  fi

  if ! awk '
    /<!-- XQ_SQUAD_MANAGED_START/ {
      if (inside || starts++) invalid = 1
      inside = 1
      next
    }
    /<!-- XQ_SQUAD_MANAGED_END -->/ {
      if (!inside || ends++) invalid = 1
      inside = 0
      next
    }
    !inside && /[^[:space:]]/ { invalid = 1 }
    END {
      if (inside || starts != 1 || ends != 1 || invalid) exit 1
    }
  ' "$DIST_DIR/AGENTS.md"; then
    error "AGENTS.md has content outside its managed section or invalid markers"
  fi

  if ! sed -n '/XQ_SQUAD_MANAGED_START/,/XQ_SQUAD_MANAGED_END/p' "$DIST_DIR/AGENTS.md" |
    grep -q 'Agent Lead'; then
    error "AGENTS.md managed section is missing the Agent Lead contract"
  fi
fi

# Validate JSON
find "$DIST_DIR" -type f -name '*.json' -print0 | while IFS= read -r -d '' f; do
  if ! node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" 2>/dev/null; then
    error "invalid JSON: $f"
  fi
done

# Validate squad.json against schema
if [[ -f "$DIST_DIR/.squad/squad.json" && -f "$DIST_DIR/.squad/schemas/squad-config.schema.json" ]]; then
  node "${REPO_ROOT}/scripts/validate-squad-config.mjs" "$DIST_DIR/.squad/schemas/squad-config.schema.json" "$DIST_DIR/.squad/squad.json" || error "squad.json does not validate against squad-config.schema.json"
fi

# Concurrent-delivery helpers: import/export sanity (opt-in feature, Node >= 20)
if command -v node >/dev/null 2>&1; then
  if ! SQ_DIST="$DIST_DIR" node --input-type=module - 2>/dev/null <<'NODE'
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const dist = process.env.SQ_DIST;
if (!dist) throw new Error('SQ_DIST unset');
const load = (rel) => import(pathToFileURL(path.join(dist, rel)).href);
const s = await load('.squad/scripts/delivery-session.mjs');
const r = await load('.squad/scripts/delivery-registry.mjs');
const v = await load('.squad/scripts/delivery-verify.mjs');
if (typeof s.runSessionCommand !== 'function') throw new Error('missing runSessionCommand');
if (typeof r.readRegistry !== 'function' || typeof r.withRegistryLock !== 'function' || typeof r.readOwnedClaim !== 'function') throw new Error('missing registry exports');
if (typeof v.captureDeliverySnapshot !== 'function' || typeof v.verifyDeliveryWrites !== 'function') throw new Error('missing verifier exports');
NODE
  then
    error "concurrent-delivery helpers fail import/export sanity"
  fi
fi

# README version pins (release-asset URLs, --version flags, archive names)
# must track squad.json release_tag. On a version bump the README snippets
# are updated in the same change; this runs before tagging in the release
# workflow, so a stale pin blocks the release instead of shipping it.
if [[ -f "$REPO_ROOT/README.md" && -f "$DIST_DIR/.squad/squad.json" ]]; then
  RELEASE_TAG="$(sed -n 's/.*"release_tag"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$DIST_DIR/.squad/squad.json")"
  if [[ -n "$RELEASE_TAG" ]]; then
    while IFS= read -r pin; do
      [[ -z "$pin" ]] && continue
      [[ "$pin" == "$RELEASE_TAG" ]] || \
        error "README pins $pin but squad.json release_tag is $RELEASE_TAG — sync README version snippets on version bump"
    done < <(grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' "$REPO_ROOT/README.md" | sort -u)
  fi
fi

# No forbidden executables in distribution
find "$DIST_DIR" -type f \( -name '*.py' -o -name '*.rb' -o -name '*.pl' -o -name '*.exe' -o -name '*.bin' \) -print | while read -r f; do
  error "forbidden executable file in distribution: $f"
done

# Ensure source-only files are not in distribution
for forbidden in install.sh update.sh scripts tests .git .gitignore README.md CHANGELOG.md CONTRIBUTING.md; do
  if [[ -e "$DIST_DIR/$forbidden" ]]; then
    error "source-only file in distribution: $forbidden"
  fi
done

if [[ "$errors" -gt 0 ]]; then
  echo "Validation failed with $errors error(s)" >&2
  exit 1
fi

echo "Distribution validation passed"
