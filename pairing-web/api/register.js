import { redis, rateLimit, clientIP } from "./_redis.js";

const CODE_RE = /^[0-9]{6}$/;
const MAX_TTL_SEC = 15 * 60;
// Presence TTL for the stable device:<id> record. Independent of the
// rotating pairing code's TTL -- this just needs to comfortably outlast one
// registration interval (registerEvery in pairing.go) so a device that's
// still actively registering never flickers "offline" between refreshes.
const DEVICE_TTL_SEC = 8 * 60;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const secret = process.env.REGISTER_SECRET;
  if (!secret) {
    res.status(500).json({ error: "server misconfigured: REGISTER_SECRET not set" });
    return;
  }
  if (req.headers["x-register-secret"] !== secret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const ip = clientIP(req);
  if (!(await rateLimit(`rl:register:${ip}`, 30, 60))) {
    res.status(429).json({ error: "too many requests" });
    return;
  }

  const { code, lanIp, port, token, name, deviceId, ttlSeconds } = req.body || {};
  if (!CODE_RE.test(code || "")) {
    res.status(400).json({ error: "code must be 6 digits" });
    return;
  }
  if (!lanIp || !port || !token) {
    res.status(400).json({ error: "lanIp, port, and token are required" });
    return;
  }

  const ttl = Math.min(Math.max(Number(ttlSeconds) || 600, 60), MAX_TTL_SEC);
  const deviceName = name || "Mac";

  const writes = [
    redis.set(
      `pair:${code}`,
      JSON.stringify({ lanIp, port, token, name: deviceName, deviceId: deviceId || null }),
      { ex: ttl }
    ),
  ];

  // deviceId is absent only for a helper build that predates this field
  // (old binary, not yet updated) -- skip the presence record rather than
  // erroring, so pairing by code still works.
  if (deviceId) {
    writes.push(
      redis.set(
        `device:${deviceId}`,
        JSON.stringify({ lanIp, port, token, name: deviceName }),
        { ex: DEVICE_TTL_SEC }
      )
    );
  }

  await Promise.all(writes);

  res.status(200).json({ ok: true, expiresInSeconds: ttl });
}
