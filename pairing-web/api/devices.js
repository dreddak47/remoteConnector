import { redis, rateLimit, clientIP } from "./_redis.js";

// Matches the deviceId shape written by generateToken() in config.go (32 hex
// chars), but kept loose (any reasonable token-ish string) since this only
// gates a Redis key lookup, not a secret.
const ID_RE = /^[a-zA-Z0-9_-]{8,128}$/;
const MAX_IDS = 25;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const ip = clientIP(req);
  if (!(await rateLimit(`rl:devices:${ip}`, 60, 60))) {
    res.status(429).json({ error: "too many requests" });
    return;
  }

  const raw = (req.query.ids || "").toString();
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && ID_RE.test(s))
    .slice(0, MAX_IDS);

  const results = await Promise.all(
    ids.map(async (id) => {
      const rec = await redis.get(`device:${id}`);
      if (!rec) return { id, online: false };
      const data = typeof rec === "string" ? JSON.parse(rec) : rec;
      return { id, online: true, name: data.name };
    })
  );

  res.status(200).json({ devices: results });
}
