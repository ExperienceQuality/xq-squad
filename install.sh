#!/bin/sh
# POSIX sh compatible: may be executed as `sh install.sh`, `bash install.sh`,
# or piped via `curl ... | sh -s -- ...`.
set -eu
(set -o pipefail 2>/dev/null) || true

VERSION=""
TARGET=""
REPO="ExperienceQuality/xq-squad"
DRY_RUN=false
ASSUME_YES=false
LOCAL_ARCHIVE=""
LOCAL_CHECKSUM=""

usage() {
  echo "Usage: install.sh --target PATH --version vX.Y.Z [--repo OWNER/REPO] [--archive PATH] [--checksum PATH] [--dry-run] [--yes]"
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --archive) LOCAL_ARCHIVE="$2"; shift 2 ;;
    --checksum) LOCAL_CHECKSUM="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
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

# Preflight: commands
for cmd in git curl tar shasum node; do
  command -v "$cmd" >/dev/null 2>&1 || error "required command not found: $cmd"
done

# Preflight: target exists and is git repo
[ -d "$TARGET" ] || error "target directory does not exist: $TARGET"
[ -d "$TARGET/.git" ] || error "target is not a git repository: $TARGET"

# Preflight: git state. Only tracked modifications count as dirty; untracked
# files are the consumer's own and are never touched by the installer.
if [ -n "$(git -C "$TARGET" status --porcelain --untracked-files=no 2>/dev/null)" ]; then
  echo "Warning: target repository has uncommitted changes." >&2
  echo "Run from a clean working tree, or confirm no overlapping files before proceeding." >&2
  if [ "$ASSUME_YES" = true ]; then
    :
  elif [ -t 0 ]; then
    printf '%s' "Continue? [y/N] "
    read -r confirm || true
    case "$confirm" in
      y|Y) ;;
      *) error "installation cancelled by user" ;;
    esac
  else
    error "uncommitted changes detected and stdin is not interactive; run interactively to confirm or pass --yes to proceed"
  fi
fi

# Preflight: existing squad detection
if [ -d "$TARGET/.squad" ] || [ -f "$TARGET/.squad/install-state.json" ]; then
  echo "Existing squad installation detected. Use update.sh instead of install.sh." >&2
  error "existing installation"
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

# Verify checksum
EXPECTED="$(cat "$TMP_DIR/$CHECKSUM_NAME" | tr -d ' \n' | awk '{print $1}')"
ACTUAL="$(shasum -a 256 "$TMP_DIR/$ARCHIVE_NAME" | awk '{print $1}')"
if [ "$EXPECTED" != "$ACTUAL" ]; then
  error "checksum mismatch: expected $EXPECTED, got $ACTUAL"
fi

# Validate archive contents: no path traversal
if tar -tzf "$TMP_DIR/$ARCHIVE_NAME" | grep -qE '^\.\./|^\./\.\./|^/'; then
  error "archive contains unsafe paths"
fi

# Validate required entry files
if ! tar -tzf "$TMP_DIR/$ARCHIVE_NAME" | grep -qx 'AGENTS.md'; then
  error "archive missing AGENTS.md"
fi
if ! tar -tzf "$TMP_DIR/$ARCHIVE_NAME" | grep -qx '.squad/squad.json'; then
  error "archive missing .squad/squad.json"
fi

if [ "$DRY_RUN" = true ]; then
  echo "Dry run successful for $VERSION into $TARGET"
  exit 0
fi

# Extract. Resolve to the physical path so the helper scripts' main-module
# check (import.meta.url vs argv[1]) works on symlinked temp dirs (e.g.
# /var -> /private/var on macOS).
EXTRACT_DIR="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP_DIR" "$EXTRACT_DIR"' EXIT

tar -xzf "$TMP_DIR/$ARCHIVE_NAME" -C "$EXTRACT_DIR"

# Helper scripts ship inside the archive so a piped installer is self-contained.
MERGE_AGENTS="$EXTRACT_DIR/.squad/scripts/merge-agents.mjs"
WRITE_STATE="$EXTRACT_DIR/.squad/scripts/write-install-state.mjs"
[ -f "$MERGE_AGENTS" ] || error "archive missing .squad/scripts/merge-agents.mjs"
[ -f "$WRITE_STATE" ] || error "archive missing .squad/scripts/write-install-state.mjs"

# Copy distribution files to target
for item in AGENTS.md .devin .squad; do
  src="$EXTRACT_DIR/$item"
  [ -e "$src" ] || continue
  if [ "$item" = "AGENTS.md" ]; then
    if [ -f "$TARGET/AGENTS.md" ]; then
      # Merge managed section
      node "$MERGE_AGENTS" "$TARGET/AGENTS.md" "$src" "$TARGET/AGENTS.md"
    else
      cp "$src" "$TARGET/AGENTS.md"
    fi
  else
    # Copy directories recursively, preserving consumer-owned files later handled by update logic
    cp -R "$src" "$TARGET/"
  fi
done

# Record install state
node "$WRITE_STATE" "$TARGET" "$VERSION" "$EXTRACT_DIR"

echo "XQ Squad $VERSION installed into $TARGET"
