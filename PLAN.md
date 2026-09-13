# Remote Mac Control from Android Phone (Web-based)

## Context

You want to control your Mac's mouse/keyboard from your Android phone when you're away from your desk (e.g. lying in bed, same Wi-Fi), without a native app, without babysitting a "server," and with minimal latency. The core blocker you flagged — "I can't just leave a server running, I want to start/kill it from my phone" — turns out to rest on an assumption worth correcting: a browser tab cannot inject real OS-level mouse/keyboard events on macOS (that requires Accessibility permissions, which only a native process can hold). So a tiny native helper on the Mac is unavoidable. The good news: that helper can be so lightweight (a Go binary idling in an accept loop) that leaving it resident is functionally free — a few MB of RAM, ~0% CPU — so "starting/stopping" becomes about toggling the *active control session* from the phone's webpage, not manually running/killing a heavy process yourself. This plan builds that: a minimal Go helper on the Mac + a proper web app (PWA) on the phone with a real mousepad UI, connected over your home Wi-Fi via WebSocket, no cloud, no signaling server, no native Android app.

Decisions locked in with you already: same-Wi-Fi-only (no Tailscale/remote access), Go for the Mac helper, simple shared-token auth, web app (not native app) on the phone side. You also want this delivered in two stages: an MVP to prove the idea works end-to-end, then a polish pass — not a bare-bones tool you'll live with permanently.

**Two-stage delivery:**
- **Stage 1 (MVP)**: functional clean mousepad UI on the phone (dark theme, connection status, button row) + a guided one-command install script on the Mac (no raw `go build`/manual terminal fumbling — a setup page walks through one copy-paste command that builds, installs the LaunchAgent, and opens the Accessibility settings pane for you).
- **Stage 2 (polish, after MVP is validated)**: package the Mac helper as a downloadable, double-clickable `.app` bundle (self-installs the LaunchAgent and prompts for permissions on first launch — no Apple Developer account, just an unsigned app opened via right-click-Open once) and refine the phone UI's visual design (animations, gesture hints, icons).

This plan covers Stage 1 in full detail; Stage 2 is scoped at the end for after the MVP is working and tested.

## Architecture

- **Mac helper (Go binary)**: runs at login via a `launchd` LaunchAgent (`RunAtLoad` + `KeepAlive`), idling in `net/http`'s accept loop until a connection comes in. Serves two things: a **setup page** (install instructions + status) and the **control web app** (static files + WebSocket upgrade for the live input stream). Verifies a shared token on WS handshake, then dispatches incoming JSON messages to [go-vgo/robotgo](https://github.com/go-vgo/robotgo) calls that move the cursor, click, scroll, and type.
- **Setup/install flow**: a one-time guided install page (can be a simple static page hosted alongside the repo, e.g. a `README`-driven GitHub Pages page or just the repo's `README.md` rendered on GitHub) walks through a single copy-paste command: `curl ... | sh` or a checked-out `./install.sh` that (1) builds the Go binary, (2) copies the LaunchAgent plist into `~/Library/LaunchAgents/`, (3) runs `launchctl load -w`, and (4) opens `System Settings > Privacy & Security > Accessibility` for you via `open "x-apple.systempreferences:..."` so granting the permission is the only manual click left. This replaces raw terminal fumbling with a guided "one command + one settings click" setup.
- **Phone (PWA, no native app)**: opens `http://<mac-lan-ip>:<port>/?token=...` in Chrome once, "Add to Home Screen." The page is a proper mousepad web app — full-screen touch surface (Pointer Events, not raw Touch Events) for cursor movement, a visible button row (left/right click, scroll-mode toggle, keyboard toggle, end-session), and a connection-status indicator — styled with a clean modern dark theme so it feels like a real app, not a bare HTML page. Drag deltas become mouse-move messages, taps become clicks, and a hidden focusable `<input>` pops the native Android keyboard and relays typed text/keys — all batched via `requestAnimationFrame` and sent over one long-lived WebSocket.
- **Networking**: plain LAN, no mDNS reliance (Android's `.local` resolution is inconsistent) — use a router DHCP reservation so the Mac's IP never changes, bookmark that IP on the phone.
- **Security**: a fixed shared token checked once at WS handshake — sufficient for a private home network, not a public-facing auth system.

## Repo structure

```
remoteConnector/
├── go.mod / go.sum
├── main.go                 # HTTP+WS server, static file serving, token check, dispatch loop
├── input.go                # thin wrapper funcs around robotgo (Move/Click/Scroll/Key/Type)
├── config.go                # loads token + port (env var or a small local config file)
├── install.sh                # one-shot setup: build, install plist, launchctl load, open Accessibility pane
├── static/
│   ├── index.html          # mousepad web app: touch surface, button row, status indicator
│   ├── app.js               # pointer event capture, rAF-batched deltas, WS client, reconnect
│   └── style.css            # clean modern dark theme
└── com.aekansh.remoteconnector.plist   # LaunchAgent, installed to ~/Library/LaunchAgents/
```

## Key implementation details

**Go dependencies**: `github.com/go-vgo/robotgo` (input injection), `github.com/coder/websocket` (maintained successor to the now-archived `gorilla/websocket`; use its `wsjson` subpackage). Stdlib `net/http` for everything else — no web framework needed.

**WS message schema** (one envelope type, dispatched by a `switch` in `main.go`):
```json
{ "type": "move",   "dx": 12, "dy": -4 }
{ "type": "click",  "button": "left", "double": false }
{ "type": "scroll", "dx": 0, "dy": 3 }
{ "type": "key",    "key": "enter", "modifiers": ["cmd"] }
{ "type": "text",   "value": "hello world" }
{ "type": "end" }
```
Token is passed once at handshake (`wss://<ip>:<port>/ws?token=...`), checked before accepting the connection; everything after that is trusted for the socket's lifetime. `input.go` maps each message type directly to a robotgo call (`MoveRelative`, `Click`, `Scroll`, `KeyTap`, `Type`) — dispatch inline, no queueing needed at LAN/human input rates.

**launchd plist** (`~/Library/LaunchAgents/com.aekansh.remoteconnector.plist`): `RunAtLoad=true`, `KeepAlive=true`, `ProgramArguments` pointing at the compiled binary, `ProcessType=Background`, `StandardOutPath`/`StandardErrorPath` to `~/Library/Logs/remoteconnector.log`. Load once with `launchctl load -w ...`.

## One-time setup (Stage 1: guided script, not raw terminal steps)

1. Clone the repo, run `./install.sh` — it builds the binary locally (`go build`, avoiding Gatekeeper quarantine since local builds aren't downloaded files), copies the plist to `~/Library/LaunchAgents/`, runs `launchctl load -w`, and opens the Accessibility settings pane for you (`open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"`).
2. Grant Accessibility (and Screen Recording, if prompted — robotgo can trigger this even unused) in the pane the script just opened for you. This is the only manual click.
3. Set a DHCP reservation for the Mac's Wi-Fi MAC on your router so its LAN IP is stable.
4. On the phone: visit `http://<mac-lan-ip>:<port>/?token=...` in Chrome, "Add to Home Screen" so the mousepad app is bookmarked and reachable in one tap, token included.

## Phone mousepad UI (Stage 1 scope)

- Full-screen touch surface for cursor movement (Pointer Events), dark theme, minimal chrome.
- Button row: left click, right click, scroll-mode toggle (switches the touch surface to two-axis scroll instead of move), keyboard toggle (focuses the hidden `<input>` to summon the Android keyboard), end-session.
- A small connection-status indicator (connected/reconnecting/disconnected) since Wi-Fi drops should be visible, not silent.
- No animations/custom icons/gesture-hint overlays yet — that's Stage 2 polish, once the interaction model is validated by actually using it.

## Known gotchas to watch for

- **Rebuilding the binary may re-trigger the Accessibility prompt** — Go's ad-hoc code signature can be treated as a "new identity" by TCC on rebuild. Avoid rebuilding casually once it's working; if iterating often, consider a consistent `codesign --force --sign -` step.
- **Retina scaling**: robotgo's move coordinates may not match phone-side pixel deltas 1:1 on a Retina display — use `robotgo.GetScaleSize()` to calibrate sensitivity.
- **Multi-monitor**: robotgo's screen-size handling across multiple displays is known to be rough; test explicitly if you use an external monitor.
- **First build may hit cgo friction** — robotgo is a large cgo package; do a throwaway `go build` spike before writing the rest of the app to confirm it compiles cleanly on your machine/Xcode version.
- **Token in the URL** lands in Chrome history/autofill — acceptable for a personal LAN tool, not hardened against local device access.

## Verification

1. After building, run the helper manually first (not via launchd) and load `http://localhost:<port>` in a Mac browser to confirm the page serves and a WS test message (e.g. a small move) actually moves the cursor.
2. Install the LaunchAgent, reboot or `launchctl kickstart`, confirm the process is resident (`ps aux | grep remoteconnector`) with negligible RSS/CPU via Activity Monitor.
3. From the phone, load the bookmarked URL, confirm the WS connects, and test each message type: drag (move), tap (click), two-finger drag (scroll), and typing via the hidden input (text/key).
4. Confirm ending the session (closing the tab / "End Session" button) leaves the Mac-side daemon alive and dormant, ready for the next connection without any manual restart.
5. Rough latency sanity check: drag your finger in a slow arc and confirm the cursor tracks without visible lag or stutter over LAN.

## Stage 2 (after MVP is validated): polish pass

Only start this once Stage 1 has been used for real for a bit and the interaction model feels right. Scope:
- **Downloadable `.app` bundle**: package the Go binary as a proper macOS `.app` (icon, `Info.plist`) that self-installs the LaunchAgent and prompts for permissions on first launch — no Apple Developer account needed, just an unsigned app opened via right-click-Open once (Gatekeeper's one-time exception, not a blocker for personal use). Distribute it as a file you can grab from the setup page instead of running `install.sh`.
- **Visual polish on the phone UI**: refine the mousepad's look and feel — subtle gesture-hint overlays on first use, smoother button styling/icons, transition animations, possibly a settings panel (sensitivity slider, scroll direction toggle).
- Re-evaluate whether a menu-bar status icon on the Mac (showing "session active/idle") is worth adding, purely cosmetic/confidence-building, not functionally required.