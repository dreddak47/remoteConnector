import { Redis } from "@upstash/redis";

// Vercel's Upstash integration sets KV_REST_API_URL / KV_REST_API_TOKEN (or
// UPSTASH_REDIS_REST_URL / _TOKEN if you connected the database manually).
// Support both so setup works either way.
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  throw new Error(
    "Redis is not configured: set KV_REST_API_URL/KV_REST_API_TOKEN " +
      "(or UPSTASH_REDIS_REST_URL/_TOKEN) in the Vercel project's env vars."
  );
}

export const redis = new Redis({ url, token });

// Very small fixed-window rate limiter: allows `limit` calls per `windowSec`
// per key. Good enough to blunt code-guessing / registration spam without
// needing a dedicated rate-limit product.
export async function rateLimit(key, limit, windowSec) {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSec);
  }
  return count <= limit;
}

export function clientIP(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0].trim();
  }
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "unknown";
}
