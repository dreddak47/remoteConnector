import { redis, rateLimit, clientIP } from "./_redis.js";

const CODE_RE = /^[0-9]{6}$/;
const MAX_TTL_SEC = 15 * 60;

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

  const { code, lanIp, port, token, name, ttlSeconds } = req.body || {};
  if (!CODE_RE.test(code || "")) {
    res.status(400).json({ error: "code must be 6 digits" });
    return;
  }
  if (!lanIp || !port || !token) {
    res.status(400).json({ error: "lanIp, port, and token are required" });
    return;
  }

  const ttl = Math.min(Math.max(Number(ttlSeconds) || 600, 60), MAX_TTL_SEC);

  await redis.set(
    `pair:${code}`,
    JSON.stringify({ lanIp, port, token, name: name || "Mac" }),
    { ex: ttl }
  );

  res.status(200).json({ ok: true, expiresInSeconds: ttl });
}
