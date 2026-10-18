import { getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";
import { clerkConfigured } from "./require-auth";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;
const USER_LIMIT = 240;
const PUBLIC_MARKET_LIMIT = 30;

const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, WINDOW_MS);
cleanup.unref?.();

export function apiRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const isPublicMarket =
    req.originalUrl.startsWith("/api/market/") ||
    req.path.startsWith("/market/");
  const limit = isPublicMarket ? PUBLIC_MARKET_LIMIT : USER_LIMIT;
  const principal = clerkConfigured()
    ? (getAuth(req).userId ?? req.ip ?? "unknown")
    : (req.ip ?? "local");
  const key = `${isPublicMarket ? "market" : "api"}:${principal}`;
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  res.setHeader("RateLimit-Limit", String(limit));
  res.setHeader("RateLimit-Remaining", String(Math.max(0, limit - bucket.count)));
  res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
  if (bucket.count > limit) {
    res.setHeader(
      "Retry-After",
      String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))),
    );
    res.status(429).json({ error: "Request limit reached. Try again shortly." });
    return;
  }
  next();
}