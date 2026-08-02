#!/bin/sh
# SyncHub Agent — one-line installer (Linux/macOS).
#
# Intended usage:
#   curl -fsSL https://<host>/install.sh | sh
#   # or, to pair immediately:
#   SYNCHUB_CODE=ABC123 SYNCHUB_HUB=https://synchub.example.com \
#     curl -fsSL https://<host>/install.sh | sh
#
# Downloads the SEA (Single Executable Application) synchub-agent binary
# from GitHub Releases, installs it, and optionally pairs it with a Hub.
# Safe to re-run: it always overwrites the installed binary with the
# requested version (upgrade-in-place).
set -eu

REPO="${SYNCHUB_REPO:-faakhir-habib/synchub}"
VERSION="${SYNCHUB_VERSION:-latest}"

log() {
  echo "[install] $*"
}

err() {
  echo "[install] error: $*" >&2
}

print_help() {
  cat <<'EOF'
SyncHub Agent installer

Usage:
  install.sh [PAIRING_CODE] [HUB_URL]
  curl -fsSL <url>/install.sh | sh
  curl -fsSL <url>/install.sh | sh -s -- ABC123 https://hub.example.com

Environment variables:
  SYNCHUB_VERSION   Release tag to install (default: latest)
  SYNCHUB_CODE      Pairing code (used when no positional args are given —
                     required when piping via `| sh`, since a pipe has no
                     positional args)
  SYNCHUB_HUB       Hub URL (paired with SYNCHUB_CODE)
  SYNCHUB_REPO      GitHub "owner/repo" to install from (default: faakhir-habib/synchub)

Options:
  -h, --help        Show this help and exit

The script downloads the synchub-agent binary for your OS/arch from GitHub
Releases, installs it to /usr/local/bin (falling back to ~/.local/bin if
that isn't writable), and — if a pairing code + hub URL were given — runs
`synchub-agent pair`. Otherwise it prints the next steps. Re-running the
script upgrades the installed binary in place.
EOF
}

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      print_help
      exit 0
      ;;
  esac
done

# --- 1. Detect OS + arch, map to the release asset name ---------------------

detect_os() {
  uname_s="$(uname -s)"
  case "$uname_s" in
    Linux) echo "linux" ;;
    Darwin) echo "macos" ;;
    *)
      err "unsupported OS: $uname_s (this script supports Linux and macOS; for Windows use install.ps1)"
      exit 1
      ;;
  esac
}

detect_arch() {
  uname_m="$(uname -m)"
  case "$uname_m" in
    x86_64|amd64) echo "x64" ;;
    aarch64|arm64) echo "arm64" ;;
    *)
      err "unsupported architecture: $uname_m"
      exit 1
      ;;
  esac
}

OS="$(detect_os)"
ARCH="$(detect_arch)"
ASSET="synchub-agent-${OS}-${ARCH}"

if [ "$VERSION" = "latest" ]; then
  DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"
else
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${ASSET}"
fi

log "detected ${OS}/${ARCH} -> ${ASSET}"
log "downloading ${DOWNLOAD_URL}"

# --- 2. Download to a temp file, then install --------------------------------

TMP_FILE="$(mktemp "${TMPDIR:-/tmp}/synchub-agent.XXXXXX")"
cleanup() {
  rm -f "$TMP_FILE"
}
trap cleanup EXIT

if ! curl -fsSL "$DOWNLOAD_URL" -o "$TMP_FILE"; then
  err "download failed. Check that a release exists for ${VERSION} with asset ${ASSET}"
  err "(set SYNCHUB_VERSION to pin a specific release tag, or SYNCHUB_REPO to point at a fork)"
  exit 1
fi

chmod +x "$TMP_FILE"

INSTALL_DIR="/usr/local/bin"
if [ ! -w "$INSTALL_DIR" ] 2>/dev/null; then
  INSTALL_DIR="$HOME/.local/bin"
  mkdir -p "$INSTALL_DIR"
  log "no write access to /usr/local/bin — installing to ${INSTALL_DIR} instead"
fi

INSTALL_PATH="${INSTALL_DIR}/synchub-agent"
mv "$TMP_FILE" "$INSTALL_PATH"
chmod +x "$INSTALL_PATH"
trap - EXIT

log "installed synchub-agent -> ${INSTALL_PATH}"

case ":$PATH:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    log "warning: ${INSTALL_DIR} is not on your PATH — add it, e.g.:"
    log "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    ;;
esac

# --- 3. Optionally pair, then print next steps -------------------------------

CODE="${1:-${SYNCHUB_CODE:-}}"
HUB="${2:-${SYNCHUB_HUB:-}}"

if [ -n "$CODE" ] && [ -n "$HUB" ]; then
  log "pairing with ${HUB} ..."
  if "$INSTALL_PATH" pair "$CODE" "$HUB"; then
    log "paired. Register the background service with:"
    log "  ${INSTALL_PATH} install"
  else
    err "pairing failed — you can retry with: ${INSTALL_PATH} pair <CODE> <HUB_URL>"
    exit 1
  fi
else
  log "not paired yet. Next steps:"
  log "  ${INSTALL_PATH} pair <CODE> <HUB_URL>"
  log "  ${INSTALL_PATH} install"
fi
