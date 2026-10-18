#!/bin/sh
# POSIX sh compatible: may be executed as `sh update.sh`, `bash update.sh`,
# or piped via `curl ... | sh -s -- ...`.
set -eu
(set -o pipefail 2>/dev/null) || true

VERSION=""
TARGET=""
REPO="ExperienceQuality/xq-squad"
ASSUME_YES=false
LOCAL_ARCHIVE=""
LOCAL_CHECKSUM=""

usage() {
  echo "Usage: update.sh --target PATH --version vX.Y.Z [--repo OWNER/REPO] [--archive PATH] [--checksum PATH] [--yes]"
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --archive) LOCAL_ARCHIVE="$2"; shift 2 ;;
    --checksum) LOCAL_CHECKSUM="$2"; shift 2 ;;
    --yes) ASSUME_YES=true; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done

if [ -z "$TARGET" ] || [ -z "$VERSION" ]; then
  echo "Error: --target and --version are required" >&2
  usage
fi

if ! echo "$VERSION" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "Error: version must match vX.Y.Z, got $VERSION" >&2
  exit 1
fi

TARGET="$(cd "$TARGET" && pwd)"
ARCHIVE_NAME="squad-${VERSION}.tar.gz"
CHECKSUM_NAME="${ARCHIVE_NAME}.sha256"

error() {
  echo "Error: $1" >&2
  exit 1
}

for cmd in git curl tar; do
  command -v "$cmd" >/dev/null 2>&1 || error "required command not found: $cmd"
done
command -v node >/dev/null 2>&1 || error "Node.js >= 20 required for upgrade (runs .squad/scripts/upgrade-managed.mjs). Install Node or report issue."

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}';
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}';
  elif command -v openssl >/dev/null 2>&1; then openssl dgst -sha256 "$1" | awk '{print $NF}';
  else error "no SHA-256 tool found (need shasum, sha256sum, or openssl)"; fi
}

[ -d "$TARGET" ] || error "target directory does not exist: $TARGET"
[ -d "$TARGET/.git" ] || error "target is not a git repository: $TARGET"

STATE_FILE="$TARGET/.squad/install-state.json"
[ -f "$STATE_FILE" ] || error "no existing squad installation found; use install.sh"

CURRENT_VERSION="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$STATE_FILE','utf8')).version)")"
if [ "$CURRENT_VERSION" = "${VERSION#v}" ]; then
  echo "Already at $VERSION. No update needed."
  exit 0
fi

# Preflight: git state. Untracked files and uncommitted changes outside the
# squad-managed paths (AGENTS.md, .devin/, .squad/) trigger a note only. Dirty
# paths that overlap squad files require confirmation (or --yes).
DIRTY_PATHS="$(git -C "$TARGET" status --porcelain --untracked-files=no 2>/dev/null | sed -e 's/^...//' -e 's/.* -> //' -e 's/^"//' -e 's/"$//' || true)"
if [ -n "$DIRTY_PATHS" ]; then
  OVERLAP="$(printf '%s\n' "$DIRTY_PATHS" | grep -E '^(AGENTS\.md|\.devin/|\.squad/)' || true)"
  if [ -z "$OVERLAP" ]; then
    echo "Note: uncommitted changes exist outside squad-managed paths; proceeding."
  else
    echo "Warning: uncommitted changes overlap squad-managed paths:" >&2
    printf '%s\n' "$OVERLAP" | sed 's/^/  /' >&2
    if [ "$ASSUME_YES" = true ]; then
      :
    elif [ -t 0 ]; then
      printf '%s' "Continue? [y/N] "
      read -r confirm || true
      case "$confirm" in
        y|Y) ;;
        *) error "update cancelled by user" ;;
      esac
    else
      error "uncommitted changes overlap squad-managed paths and stdin is not interactive; commit them or pass --yes to proceed"
    fi
  fi
fi

# Download
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if [ -n "$LOCAL_ARCHIVE" ] && [ -n "$LOCAL_CHECKSUM" ]; then
  cp "$LOCAL_ARCHIVE" "$TMP_DIR/$ARCHIVE_NAME"
  cp "$LOCAL_CHECKSUM" "$TMP_DIR/$CHECKSUM_NAME"
else
  RELEASE_URL="https://github.com/${REPO}/releases/download/${VERSION}/${ARCHIVE_NAME}"
  CHECKSUM_URL="https://github.com/${REPO}/releases/download/${VERSION}/${CHECKSUM_NAME}"

  echo "Downloading ${ARCHIVE_NAME}..."
  if ! curl -fsL "$RELEASE_URL" -o "$TMP_DIR/$ARCHIVE_NAME"; then
    error "failed to download archive from $RELEASE_URL"
  fi
  if ! curl -fsL "$CHECKSUM_URL" -o "$TMP_DIR/$CHECKSUM_NAME"; then
    error "failed to download checksum from $CHECKSUM_URL"
  fi
fi

EXPECTED="$(cat "$TMP_DIR/$CHECKSUM_NAME" | tr -d ' \n' | awk '{print $1}')"
ACTUAL="$(sha256_file "$TMP_DIR/$ARCHIVE_NAME")"
[ "$EXPECTED" = "$ACTUAL" ] || error "checksum mismatch"

# Extract new release. Resolve to the physical path so the helper scripts'
# main-module check (import.meta.url vs argv[1]) works on symlinked temp dirs.
NEW_DIR="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP_DIR" "$NEW_DIR"' EXIT
tar -xzf "$TMP_DIR/$ARCHIVE_NAME" -C "$NEW_DIR"

# Run three-way merge using the helper shipped inside the new release so a
# piped updater is self-contained.
UPGRADE_MANAGED="$NEW_DIR/.squad/scripts/upgrade-managed.mjs"
[ -f "$UPGRADE_MANAGED" ] || error "archive missing .squad/scripts/upgrade-managed.mjs"
node "$UPGRADE_MANAGED" "$TARGET" "$NEW_DIR" "$VERSION"

echo "XQ Squad updated to $VERSION in $TARGET"
