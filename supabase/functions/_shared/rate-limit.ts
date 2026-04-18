// @ts-nocheck — This file runs on Deno (Supabase Edge Functions)
// ═══════════════════════════════════
// EVENT WAW — In-Memory Rate Limiter
// For Supabase Edge Functions (Deno)
// ═══════════════════════════════════
//
// NOTE: This is per-isolate. Each cold start resets the map.
// For production at scale, consider Upstash Redis.
// This is sufficient for MVP launch protection.

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Periodically clean stale entries to prevent memory growth
let lastCleanup = Date.now();
function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return; // Clean at most every 60s
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}

/**
 * Check if a request should be rate-limited.
 *
 * @param key - Unique identifier (e.g., `checkout:${userId}` or `otp:${userId}`)
 * @param maxRequests - Max requests allowed in the window
 * @param windowMs - Time window in milliseconds
 * @returns true if the request is ALLOWED, false if rate-limited
 */
export function rateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  cleanup();
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= maxRequests) {
    return false;
  }

  entry.count++;
  return true;
}

/**
 * Get remaining requests for a key.
 */
export function getRemainingRequests(key: string, maxRequests: number): number {
  const entry = store.get(key);
  if (!entry || Date.now() > entry.resetAt) return maxRequests;
  return Math.max(0, maxRequests - entry.count);
}
