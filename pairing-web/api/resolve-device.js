import { redis, rateLimit, clientIP } from "./_redis.js";

const ID_RE = /^[a-zA-Z0-9_-]{8,128}$/;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const ip = clientIP(req);
  if (!(await rateLimit(`rl:resolve-device:${ip}`, 30, 60))) {
    res.status(429).json({ error: "too many attempts, wait a minute" });
    return;
  }

  const id = (req.query.id || "").toString();
  if (!ID_RE.test(id)) {
    res.status(400).json({ error: "invalid device id" });
    return;
  }

  const raw = await redis.get(`device:${id}`);
  if (!raw) {
    res.status(404).json({ error: "device is offline" });
    return;
  }

  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  res.status(200).json(data);
}
