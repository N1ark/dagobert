#!/usr/bin/env bash
# Build the iOS app, install it on a connected iPhone and launch it.
#   npm run install:ios                     # first paired device
#   npm run install:ios -- --release        # doesn't link today; see docs/mobile.md
#   npm run install:ios -- --device <udid>
#   npm run install:ios -- --skip-build
# The signing team comes from APPLE_DEVELOPMENT_TEAM, else from the provisioning
# profile Xcode issued for the bundle id.
set -euo pipefail
cd "$(dirname "$0")/.."

BUNDLE_ID=com.n1ark.dagobert
APP="src-tauri/gen/apple/build/dagobert_iOS.xcarchive/Products/Applications/Dagobert.app"
PROFILES="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
DEBUG=--debug
SKIP=
DEVICE=

while [[ $# -gt 0 ]]; do
  case "$1" in
    --debug) DEBUG=--debug; shift ;;
    --release) DEBUG=; shift ;;
    --skip-build) SKIP=1; shift ;;
    --device) DEVICE="${2:?--device needs a udid}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

# The team id is the profile's TeamIdentifier, not the id in the certificate name.
find_team() {
  local p plist
  for p in "$PROFILES"/*.mobileprovision; do
    [[ -e "$p" ]] || continue
    plist=$(security cms -D -i "$p" 2>/dev/null | plutil -p -) || continue
    grep -q "\.$BUNDLE_ID\"" <<<"$plist" || continue
    grep -A1 '"TeamIdentifier"' <<<"$plist" | tail -1 | tr -d ' ",' | sed 's/^0=>//'
    return 0
  done
  return 1
}

find_device() {
  xcrun devicectl list devices 2>/dev/null |
    awk '/physical/ && /available|connected/ { for (i = 1; i <= NF; i++) if ($i == "(UDID)") { print $(i - 1); exit } }'
}

TEAM="${APPLE_DEVELOPMENT_TEAM:-$(find_team || true)}"
[[ -n "$TEAM" ]] || {
  echo "no signing team: add an Apple ID in Xcode and build once from there, or set APPLE_DEVELOPMENT_TEAM" >&2
  exit 1
}

[[ -n "$DEVICE" ]] || DEVICE=$(find_device)
[[ -n "$DEVICE" ]] || {
  echo "no paired iPhone: plug it in, unlock it, and trust this Mac" >&2
  exit 1
}

if [[ -z "$SKIP" ]]; then
  # Always through the CLI: Xcode's build phase calls back into it over a socket.
  APPLE_DEVELOPMENT_TEAM="$TEAM" npx tauri ios build ${DEBUG:+"$DEBUG"} --target aarch64
fi
[[ -d "$APP" ]] || { echo "no build at $APP" >&2; exit 1; }

echo "installing $APP on $DEVICE"
xcrun devicectl device install app --device "$DEVICE" "$APP"
xcrun devicectl device process launch --device "$DEVICE" "$BUNDLE_ID"
