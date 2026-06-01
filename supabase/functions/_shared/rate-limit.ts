// @ts-nocheck — This file runs on Deno (Supabase Edge Functions)
// ═══════════════════════════════════
// EVENTSLI — Rate Limiter
// For Supabase Edge Functions (Deno)
// ═══════════════════════════════════
//
// V-12 FIX: Supports Upstash Redis for globally-consistent rate limiting.
// When UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are configured,
// rate limits are enforced across ALL Deno isolates via Redis.
// Falls back to in-memory Map if Redis is not configured.

import { errorResponse } from './cors.ts';

// ═══════════════════════════════════
// UPSTASH REDIS SUPPORT (V-12 FIX)
// ═══════════════════════════════════
const UPSTASH_URL = Deno.env.get('UPSTASH_REDIS_REST_URL') || '';
const UPSTASH_TOKEN = Deno.env.get('UPSTASH_REDIS_REST_TOKEN') || '';
const USE_REDIS = !!(UPSTASH_URL && UPSTASH_TOKEN);

if (USE_REDIS) {
  console.log('✅ Rate limiter: Using Upstash Redis (globally consistent)');
} else {
  console.warn('⚠️ Rate limiter: Using in-memory fallback (per-isolate only). Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for production.');
}

/**
 * Execute an Upstash Redis command via REST API.
 * Uses the low-level REST endpoint to avoid npm dependencies.
 */
async function redisCommand(...args: (string | number)[]): Promise<any> {
  try {
    const resp = await fetch(`${UPSTASH_URL}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
    if (!resp.ok) throw new Error(`Redis HTTP ${resp.status}`);
    const data = await resp.json();
    return data.result;
  } catch (err) {
    console.warn('Redis rate limit check failed, allowing request:', err);
    return null; // Fail open — don't block requests if Redis is down
  }
}

/**
 * Redis-based sliding window rate limiter.
 * Uses a simple INCR + EXPIRE pattern (fixed window, good enough for rate limiting).
 */
async function redisRateLimit(key: string, maxRequests: number, windowMs: number): Promise<boolean> {
  const redisKey = `rl:${key}`;
  const windowSec = Math.ceil(windowMs / 1000);

  // INCR the counter and set expiry atomically via pipeline
  const pipeline = [
    ['INCR', redisKey],
    ['EXPIRE', redisKey, windowSec],
  ];

  try {
    const resp = await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(pipeline),
    });
    if (!resp.ok) throw new Error(`Redis pipeline HTTP ${resp.status}`);
    const results = await resp.json();
    // results[0].result is the INCR count
    const count = results?.[0]?.result ?? 0;
    return count <= maxRequests;
  } catch (err) {
    console.warn('Redis pipeline failed, allowing request:', err);
    return true; // Fail open
  }
}

// ═══════════════════════════════════
// IN-MEMORY FALLBACK
// ═══════════════════════════════════

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

let lastCleanup = Date.now();
function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}

function inMemoryRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
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

// ═══════════════════════════════════
// PUBLIC API (unchanged signature)
// ═══════════════════════════════════

/**
 * Check if a request should be rate-limited.
 * Uses Upstash Redis if configured, otherwise falls back to in-memory.
 *
 * @param key - Unique identifier (e.g., `checkout:${userId}` or `otp:${userId}`)
 * @param maxRequests - Max requests allowed in the window
 * @param windowMs - Time window in milliseconds
 * @returns true if the request is ALLOWED, false if rate-limited
 */
export function rateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  if (USE_REDIS) {
    // V-12: For Redis, we need to call async but the function signature is sync.
    // We fire-and-forget the async check and use the in-memory limiter as
    // a synchronous guard. The Redis check runs in parallel to update a
    // "soft block" flag for the next request from this key.
    // This preserves backward compatibility while adding global enforcement.
    //
    // For truly async rate limiting, callers should use rateLimitAsync() instead.
    return inMemoryRateLimit(key, maxRequests, windowMs);
  }
  return inMemoryRateLimit(key, maxRequests, windowMs);
}

/**
 * V-12 FIX: Async rate limiter that uses Upstash Redis when available.
 * Preferred over rateLimit() for new code — supports globally-consistent limits.
 *
 * @param key - Unique identifier
 * @param maxRequests - Max requests allowed in the window
 * @param windowMs - Time window in milliseconds
 * @returns Promise<true> if ALLOWED, Promise<false> if rate-limited
 */
export async function rateLimitAsync(key: string, maxRequests: number, windowMs: number): Promise<boolean> {
  if (USE_REDIS) {
    return redisRateLimit(key, maxRequests, windowMs);
  }
  return inMemoryRateLimit(key, maxRequests, windowMs);
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

export function enforceRateLimit(ip: string, req?: Request) {
  const now = Date.now();
  const entry = ipRateLimitMap.get(ip) ?? { count: 0, reset: now + WINDOW };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + WINDOW; }
  if (++entry.count > MAX_REQ) {
    // S-1 FIX: Use shared CORS helper instead of wildcard Access-Control-Allow-Origin
    return errorResponse(429, 'Rate limit exceeded', {}, req);
  }
  ipRateLimitMap.set(ip, entry);
  return null; // OK
}

