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

// ═════════════════════════════════════════════════════════
// IP-BASED GLOBAL RATE LIMITING
// ═════════════════════════════════════════════════════════

// Rate limit: 5 requests per minute per IP
const ipRateLimitMap = new Map<string, { count: number; reset: number }>();
const MAX_REQ = 5, WINDOW = 60_000;

// M-5: Cleanup expired entries to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipRateLimitMap.entries()) {
    if (now > entry.reset) ipRateLimitMap.delete(ip);
  }
}, 60_000);

export function enforceRateLimit(ip: string) {
  const now = Date.now();
  const entry = ipRateLimitMap.get(ip) ?? { count: 0, reset: now + WINDOW };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + WINDOW; }
  if (++entry.count > MAX_REQ) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: { 
        'Retry-After': '60',
        'Content-Type': 'application/json',
        // Need to ensure CORS headers are present on the error response
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }
  ipRateLimitMap.set(ip, entry);
  return null; // OK
}

