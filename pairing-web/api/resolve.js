import { redis, rateLimit, clientIP } from "./_redis.js";

const CODE_RE = /^[0-9]{6}$/;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const ip = clientIP(req);
  // Codes are only 10^6 possibilities, so keep guessing expensive: a real
  // phone doing this by hand won't hit anywhere near this limit.
  if (!(await rateLimit(`rl:resolve:${ip}`, 15, 60))) {
    res.status(429).json({ error: "too many attempts, wait a minute" });
    return;
  }

  const code = (req.query.code || "").toString();
  if (!CODE_RE.test(code)) {
    res.status(400).json({ error: "code must be 6 digits" });
    return;
  }

  const raw = await redis.get(`pair:${code}`);
  if (!raw) {
    res.status(404).json({ error: "code not found or expired" });
    return;
  }

  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  res.status(200).json(data);
}
