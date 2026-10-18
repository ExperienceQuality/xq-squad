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

# Preflight: commands. Node.js is optional (POSIX fallbacks below cover its
# tasks); exactly one SHA-256 tool is required and detected via sha256_file.
for cmd in git curl tar; do
  command -v "$cmd" >/dev/null 2>&1 || error "required command not found: $cmd"
done

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}';
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}';
  elif command -v openssl >/dev/null 2>&1; then openssl dgst -sha256 "$1" | awk '{print $NF}';
  else error "no SHA-256 tool found (need shasum, sha256sum, or openssl)"; fi
}

# Preflight: target exists and is git repo
[ -d "$TARGET" ] || error "target directory does not exist: $TARGET"
[ -d "$TARGET/.git" ] || error "target is not a git repository: $TARGET"

# Preflight: git state. Untracked files and uncommitted changes outside the
# squad-managed paths (AGENTS.md, .devin/, .squad/) are the consumer's own —
# they trigger a note only. Dirty paths that overlap squad files require
# confirmation (or --yes non-interactively).
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
        *) error "installation cancelled by user" ;;
      esac
    else
      error "uncommitted changes overlap squad-managed paths and stdin is not interactive; commit them or pass --yes to proceed"
    fi
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
ACTUAL="$(sha256_file "$TMP_DIR/$ARCHIVE_NAME")"
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

# POSIX fallback for merge-agents.mjs, used when Node.js is unavailable.
# Strips any existing managed block (between the marker lines, inclusive) from
# the target AGENTS.md, then appends the managed block extracted from the new
# distributed AGENTS.md at the end. All other content is preserved.
# Args: existing_path distributed_path output_path
merge_agents_posix() {
  _managed="$(sed -n '/<!-- XQ_SQUAD_MANAGED_START/,/<!-- XQ_SQUAD_MANAGED_END -->/p' "$2")"
  [ -n "$_managed" ] || error "distributed AGENTS.md missing managed section"
  _stripped="$(awk '
    /<!-- XQ_SQUAD_MANAGED_START/ { skip = 1 }
    !skip { print }
    /<!-- XQ_SQUAD_MANAGED_END -->/ { skip = 0 }
  ' "$1")"
  if [ -n "$_stripped" ]; then
    printf '%s\n\n%s\n' "$_stripped" "$_managed" > "$3"
  else
    printf '%s\n' "$_managed" > "$3"
  fi
}

# POSIX fallback for write-install-state.mjs, used when Node.js is unavailable.
# Emits .squad/install-state.json with the same structure as the Node version.
# Args: target_dir version extract_dir
write_install_state_posix() {
  _squad_json="$3/.squad/squad.json"
  _release_tag="$(sed -n 's/.*"release_tag"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$_squad_json")"
  _config_sv="$(sed -n 's/.*"config_schema_version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$_squad_json")"
  _memory_sv="$(sed -n 's/.*"memory_schema_version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$_squad_json")"
  mkdir -p "$1/.squad"
  {
    printf '{\n'
    printf '  "version": "%s",\n' "${2#v}"
    printf '  "release_tag": "%s",\n' "$_release_tag"
    printf '  "config_schema_version": "%s",\n' "$_config_sv"
    printf '  "memory_schema_version": "%s",\n' "$_memory_sv"
    printf '  "installed_at": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '  "managed_files": {\n'
    _first=1
    find "$3" -type f | LC_ALL=C sort | while IFS= read -r _f; do
      _rel="${_f#$3/}"
      case "$_rel" in
        AGENTS.md|.devin/*|.squad/*) ;;
        *) continue ;;
      esac
      _hash="$(sha256_file "$_f")"
      if [ "$_first" -eq 0 ]; then printf ',\n'; fi
      _first=0
      printf '    "%s": "%s"' "$_rel" "$_hash"
    done
    printf '\n  },\n'
    # Copy the ownership object verbatim from squad.json (from the
    # "ownership": { line through its closing brace at the same indentation).
    sed -n '/"ownership"[[:space:]]*:[[:space:]]*{/,/^  }/p' "$_squad_json"
    printf '}\n'
  } > "$1/.squad/install-state.json"
}

# Copy distribution files to target
for item in AGENTS.md .devin .squad; do
  src="$EXTRACT_DIR/$item"
  [ -e "$src" ] || continue
  if [ "$item" = "AGENTS.md" ]; then
    if [ -f "$TARGET/AGENTS.md" ]; then
      # Merge managed section
      if command -v node >/dev/null 2>&1; then
        node "$MERGE_AGENTS" "$TARGET/AGENTS.md" "$src" "$TARGET/AGENTS.md"
      else
        merge_agents_posix "$TARGET/AGENTS.md" "$src" "$TARGET/AGENTS.md"
      fi
    else
      cp "$src" "$TARGET/AGENTS.md"
    fi
  else
    # Copy directories recursively, preserving consumer-owned files later handled by update logic
    cp -R "$src" "$TARGET/"
  fi
done

# Record install state
if command -v node >/dev/null 2>&1; then
  node "$WRITE_STATE" "$TARGET" "$VERSION" "$EXTRACT_DIR"
else
  write_install_state_posix "$TARGET" "$VERSION" "$EXTRACT_DIR"
fi

echo "XQ Squad $VERSION installed into $TARGET"
