# remoteconnector pairing server

Tiny Vercel project that lets your phone find your Mac by a 6-digit code
instead of a LAN IP + token in a bookmarked URL. It only stores a short-lived
`code -> {lanIp, port, token}` mapping — the actual mouse/keyboard traffic
never passes through this; your phone gets redirected straight to the Mac on
your LAN.

## Deploy

From this directory:

```sh
npx vercel login       # one-time, opens a browser to sign in
npx vercel link        # creates/links a Vercel project for this folder
npx vercel --prod      # deploys it
```

Note the production URL it prints (e.g. `https://remoteconnector-xyz.vercel.app`).

## Add Redis storage

The API needs a place to store codes. Easiest path, in the Vercel dashboard:

1. Open the project → **Storage** tab → **Create Database** → **Upstash** →
   **Redis** (free tier is plenty).
2. Connect it to this project — Vercel automatically adds the
   `KV_REST_API_URL` / `KV_REST_API_TOKEN` env vars for you.

(If you'd rather create the Upstash database yourself at upstash.com, add
`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` as env vars instead —
the API checks for either pair.)

## Set the shared secret

In the project's **Settings → Environment Variables**, add:

```
REGISTER_SECRET = 321bd7a516f0d71557d72765de4b447d
```

That's the `PAIR_SECRET` already generated on your Mac
(`~/.remoteconnector.conf`) — it must match exactly, otherwise the Mac won't
be allowed to register codes. After adding it, redeploy once
(`npx vercel --prod`) so the function picks it up.

## Point the Mac at it

Add one line to `~/.remoteconnector.conf` on the Mac:

```
PAIR_SERVER_URL=https://remoteconnector-xyz.vercel.app
```

(use the URL from the deploy step), then restart the helper:

```sh
launchctl kickstart -k gui/$(id -u)/com.aekansh.remoteconnector
```

Click the **RC** menu bar icon — within a few seconds it should show
`Code: XXXXXX` instead of "Pairing not configured".

## Use it

On your phone (same Wi-Fi as the Mac), open the Vercel URL. The first time,
tap **+**, enter the code shown in the Mac's menu bar, and tap Connect — this
opens the control app in a new tab and remembers the Mac on your phone
(indefinitely, in `localStorage`). After that, the Mac shows up as a card on
the home screen with a live online/offline dot; tap it any time it's online
to reconnect without re-entering a code.

The code only matters for that first pairing — it rotates every ~4 minutes
and each one is valid for 10, so don't worry about it going stale mid-setup,
just glance at the menu bar again. Online/offline status for already-paired
Macs is driven by a separate, stable per-Mac ID that doesn't rotate.

Guided first-time Mac setup (the install command, granting Accessibility,
etc.) lives at `/setup.html` on the same deployment.
