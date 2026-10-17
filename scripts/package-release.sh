#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${REPO_ROOT}/distribution"
RELEASE_DIR="${REPO_ROOT}/.releases"

usage() {
  echo "Usage: package-release.sh --version vX.Y.Z [--output DIR]"
  exit 2
}

VERSION=""
OUTPUT_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --output) OUTPUT_DIR="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  echo "Error: --version is required" >&2
  usage
fi

if ! [[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: version must match vX.Y.Z, got $VERSION" >&2
  exit 1
fi

OUTPUT_DIR="${OUTPUT_DIR:-$RELEASE_DIR}"
mkdir -p "$OUTPUT_DIR"

ARCHIVE_NAME="squad-${VERSION}.tar.gz"
ARCHIVE_PATH="${OUTPUT_DIR}/${ARCHIVE_NAME}"
CHECKSUM_PATH="${OUTPUT_DIR}/${ARCHIVE_NAME}.sha256"

if [[ ! -d "$DIST_DIR" ]]; then
  echo "Error: distribution directory not found at $DIST_DIR" >&2
  exit 1
fi

if [[ ! -f "$DIST_DIR/AGENTS.md" ]]; then
  echo "Error: AGENTS.md missing from distribution" >&2
  exit 1
fi

if [[ ! -f "$DIST_DIR/.squad/squad.json" ]]; then
  echo "Error: .squad/squad.json missing from distribution" >&2
  exit 1
fi

# Validate JSON files
find "$DIST_DIR" -type f -name '*.json' -print0 | while IFS= read -r -d '' f; do
  if ! node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" 2>/dev/null; then
    echo "Error: invalid JSON: $f" >&2
    exit 1
  fi
done

# Stage distribution into temp dir with deterministic structure.
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT

# Use find + sort so archive order is stable.
FILE_LIST="$(mktemp)"
trap 'rm -f "$FILE_LIST"; rm -rf "$STAGE_DIR"' EXIT

(
  cd "$DIST_DIR"
  find . -type f | sed 's|^\./||' | sort > "$FILE_LIST"
)

# Detect forbidden executable extensions outside .sh and .mjs
while IFS= read -r f; do
  case "$f" in
    *.sh|*.mjs|*.md|*.json|*.ndjson) ;;
    *)
      if file "$DIST_DIR/$f" | grep -qE 'executable|script'; then
        echo "Error: forbidden executable file in distribution: $f" >&2
        exit 1
      fi
      ;;
  esac
done < "$FILE_LIST"

# Copy to stage preserving relative paths.
while IFS= read -r f; do
  target="$STAGE_DIR/$f"
  mkdir -p "$(dirname "$target")"
  cp "$DIST_DIR/$f" "$target"
done < "$FILE_LIST"

# Create deterministic archive: gzip -n avoids timestamp, sorted input keeps order.
GZIP=-n tar -czf "$ARCHIVE_PATH" -C "$STAGE_DIR" $(cat "$FILE_LIST")

# Generate checksum.
shasum -a 256 "$ARCHIVE_PATH" | awk '{print $1}' > "$CHECKSUM_PATH"

# Verify checksum.
EXPECTED="$(cat "$CHECKSUM_PATH")"
ACTUAL="$(shasum -a 256 "$ARCHIVE_PATH" | awk '{print $1}')"
if [[ "$EXPECTED" != "$ACTUAL" ]]; then
  echo "Error: checksum mismatch after generation" >&2
  exit 1
fi

echo "Packaged $ARCHIVE_NAME"
echo "Checksum: $EXPECTED"
echo "Files:"
cat "$FILE_LIST" | sed 's/^/  /'
