#!/usr/bin/env bash
# Build the release app, replace the installed copy and relaunch it.
#   npm run install:app            # builds, then installs to /Applications
#   npm run install:app -- --skip-build
#   DEST=~/Applications npm run install:app
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="${DEST:-/Applications}"
APP="Dagobert.app"
BUILT="src-tauri/target/release/bundle/macos/$APP"

if [[ "${1:-}" != "--skip-build" ]]; then
  npm run tauri build -- --bundles app
fi
[[ -d "$BUILT" ]] || { echo "no build at $BUILT" >&2; exit 1; }

# Quit the running instance (if any) and wait for it to exit.
if pgrep -xq Dagobert; then
  osascript -e 'tell application "Dagobert" to quit' >/dev/null 2>&1 || true
  for _ in $(seq 1 50); do pgrep -xq Dagobert || break; sleep 0.1; done
  pkill -x Dagobert 2>/dev/null || true
fi

rm -rf "$DEST/$APP"
cp -R "$BUILT" "$DEST/$APP"
open "$DEST/$APP"
echo "installed $DEST/$APP"
