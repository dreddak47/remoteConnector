#!/bin/sh
# install.sh — one-shot guided setup for the remoteconnector Mac helper.
#
# What it does:
#   1. Builds the Go binary (local build -> no Gatekeeper quarantine).
#   2. Copies the LaunchAgent plist into ~/Library/LaunchAgents/.
#   3. Loads the agent with launchctl (RunAtLoad + KeepAlive).
#   4. Opens the Accessibility settings pane so you can grant permission.
#
# The only manual step left for you is clicking the toggle in the pane that
# opens at the end.

set -e

# Resolve the directory this script lives in.
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

# --- Locate Go ---
GO=""
if command -v go >/dev/null 2>&1; then
    GO=$(command -v go)
elif [ -x "$HOME/.local/go-sdk/go/bin/go" ]; then
    GO="$HOME/.local/go-sdk/go/bin/go"
elif [ -x /opt/homebrew/bin/go ]; then
    GO=/opt/homebrew/bin/go
elif [ -x /usr/local/bin/go ]; then
    GO=/usr/local/bin/go
fi

if [ -z "$GO" ]; then
    echo "ERROR: Go was not found on PATH or in common locations."
    echo "Install Go from https://go.dev/dl/ and re-run this script."
    exit 1
fi

echo "==> Using Go at: $GO"
"$GO" version

# --- Build ---
BIN_DIR="$HOME/.local/remoteconnector"
mkdir -p "$BIN_DIR"
BIN="$BIN_DIR/remoteconnector"

echo "==> Building the helper binary..."
(
    cd "$SCRIPT_DIR"
    export PATH="$(dirname "$GO"):$PATH"
    # Work around broken/mismatched macOS SDKs (e.g. a stray beta
    # MacOSX27.0.sdk whose .tbd files use arch tags the installed `ld`
    # doesn't understand, causing "malformed file" link errors). Prefer
    # the SDK matching the running OS version if it's present.
    SDK_DIR="/Library/Developer/CommandLineTools/SDKs"
    OS_VER=$(sw_vers -productVersion | cut -d. -f1,2)
    if [ -d "$SDK_DIR/MacOSX$OS_VER.sdk" ]; then
        export SDKROOT="$SDK_DIR/MacOSX$OS_VER.sdk"
    elif [ -d "$SDK_DIR" ]; then
        # Pick the highest-versioned SDK that is not newer than the
        # running OS (a newer SDK than the OS is a sign of a broken/beta
        # install and its .tbd files may not link with the installed ld).
        MATCH=$(ls -d "$SDK_DIR"/MacOSX[0-9]*.sdk 2>/dev/null \
            | sed -E 's#.*/MacOSX([0-9.]+)\.sdk#\1 &#' \
            | sort -V \
            | awk -v v="$OS_VER" '$1 <= v || $1 ~ "^"v"\\." || $1 == v {print $2}' \
            | tail -1)
        [ -n "$MATCH" ] && export SDKROOT="$MATCH"
    fi
    [ -n "$SDKROOT" ] && echo "==> Using SDKROOT: $SDKROOT"
    "$GO" build -o "$BIN" .
)

echo "==> Binary installed at: $BIN"

# --- Sign consistently (avoids re-triggering the TCC Accessibility prompt) ---
if command -v codesign >/dev/null 2>&1; then
    echo "==> Applying ad-hoc code signature (stable identity for permissions)..."
    # Without an explicit -i identifier, ad-hoc codesign derives the
    # identifier from a hash of the binary's contents (no Info.plist to
    # supply a bundle id). That means every rebuild gets a *different*
    # identity, which silently invalidates any Accessibility permission
    # already granted in System Settings -> the daemon then fails to move
    # the mouse / click / type with no error logged anywhere. Pinning an
    # explicit identifier keeps the TCC grant valid across rebuilds.
    codesign --force --sign - -i com.aekansh.remoteconnector "$BIN" 2>/dev/null || true
fi

# --- Install LaunchAgent plist ---
PLIST_SRC="$SCRIPT_DIR/com.aekansh.remoteconnector.plist"
PLIST="$HOME/Library/LaunchAgents/com.aekansh.remoteconnector.plist"
LOG_DIR="$HOME/Library/Logs"

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$LOG_DIR"

echo "==> Installing LaunchAgent plist..."
sed \
    -e "s#__BINARY_PATH__#$BIN#g" \
    -e "s#__LOG_DIR__#$LOG_DIR#g" \
    "$PLIST_SRC" > "$PLIST"

# --- Load the agent ---
echo "==> Loading the LaunchAgent..."
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"

echo "==> Done. The helper starts at login and stays resident."
echo ""
echo "    Binary:  $BIN"
echo "    Logs:    $LOG_DIR/remoteconnector.log"
echo ""

# --- Prompt for Accessibility permission ---
echo "==> Opening Accessibility settings so you can grant 'remoteconnector' access..."
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility" 2>/dev/null || true

echo ""
echo "In the pane that opened, click the lock (bottom-left) to authenticate,"
echo "then enable the toggle next to 'remoteconnector' (or this terminal app)."
echo "If prompted for Screen Recording, grant that too."
echo ""
echo "After granting, restart the helper:"
echo "    launchctl kickstart -k gui/$(id -u)/com.aekansh.remoteconnector"
echo ""
echo "Your phone URL (find the Mac's LAN IP with: ipconfig getifaddr en0):"
echo "    http://<mac-lan-ip>:8740/?token=$(grep -o 'TOKEN=.*' "$HOME/.remoteconnector.conf" 2>/dev/null | cut -d= -f2)"
echo ""
echo "Then on your phone: open that URL in Chrome, tap the menu -> 'Add to Home screen'."