#!/bin/sh
# SyncHub Agent — one-line uninstaller (Linux/macOS).
#
# Intended usage:
#   curl -fsSL https://<host>/uninstall.sh | sh
#   # keep pairing/config/state (e.g. about to reinstall):
#   curl -fsSL https://<host>/uninstall.sh | sh -s -- --keep-data
#
# Removes everything install.sh put in place: the per-user systemd/launchd
# background service, the synchub-agent binary, and (by default) ~/.synchub
# (config.json/state.json/tombstones.json).
set -eu

log() {
  echo "[uninstall] $*"
}

err() {
  echo "[uninstall] error: $*" >&2
}

print_help() {
  cat <<'EOF'
SyncHub Agent uninstaller

Usage:
  uninstall.sh [--keep-data]
  curl -fsSL <url>/uninstall.sh | sh
  curl -fsSL <url>/uninstall.sh | sh -s -- --keep-data

Options:
  --keep-data       Don't delete ~/.synchub (config/state/tombstones)
  -h, --help        Show this help and exit

Removes the systemd --user / launchd background service and the installed
synchub-agent binary (checked at /usr/local/bin and ~/.local/bin). No sudo
required - the service is a per-user unit either way.
EOF
}

KEEP_DATA=0
for arg in "$@"; do
  case "$arg" in
    -h|--help)
      print_help
      exit 0
      ;;
    --keep-data)
      KEEP_DATA=1
      ;;
  esac
done

# --- 1. Find the installed binary ---------------------------------------------

INSTALL_PATH=""
for candidate in /usr/local/bin/synchub-agent "$HOME/.local/bin/synchub-agent"; do
  if [ -x "$candidate" ]; then
    INSTALL_PATH="$candidate"
    break
  fi
done

# --- 2. Remove the background service ------------------------------------------

if [ -n "$INSTALL_PATH" ]; then
  log "removing background service ..."
  if ! "$INSTALL_PATH" uninstall; then
    err "service removal failed - continuing with binary cleanup anyway"
  fi
else
  log "no synchub-agent binary found on PATH (/usr/local/bin or ~/.local/bin) - nothing to run 'uninstall' with."
fi

# --- 3. Delete the installed binary ---------------------------------------------
#
# Stopping the service (step 2) only stops an instance the service started.
# A synchub-agent launched any other way (manually, via `run` in a terminal)
# is unaffected by that and would otherwise keep running the old binary
# after "uninstall" - unlink it below regardless, but still stop the stray
# process for a clean state (Unix lets you rm a running binary either way).
if [ -n "$INSTALL_PATH" ]; then
  pkill -f "$INSTALL_PATH" 2>/dev/null || true
  if rm -f "$INSTALL_PATH" 2>/dev/null; then
    log "removed $INSTALL_PATH"
  else
    log "no write access to $INSTALL_PATH - retrying with sudo"
    sudo rm -f "$INSTALL_PATH"
    log "removed $INSTALL_PATH"
  fi
fi

# --- 4. Local data ---------------------------------------------------------------

DATA_DIR="$HOME/.synchub"
if [ "$KEEP_DATA" -eq 0 ]; then
  if [ -d "$DATA_DIR" ]; then
    rm -rf "$DATA_DIR"
    log "removed $DATA_DIR"
  fi
else
  log "kept $DATA_DIR (--keep-data)"
fi

log "done."
