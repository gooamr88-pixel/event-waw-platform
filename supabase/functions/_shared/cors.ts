/// <reference types="https://deno.land/x/deploy@0.12.0/types.ts" />
// @ts-nocheck — This file runs on Deno (Supabase Edge Functions)
// ═══════════════════════════════════
// EVENTSLI — Shared CORS & Response Helpers
// Used by all Edge Functions
// ═══════════════════════════════════

// S-3 FIX: Gate localhost origins behind environment variable
// In production, set ENVIRONMENT=production to exclude localhost
const IS_PRODUCTION = (Deno.env.get('ENVIRONMENT') || '').toLowerCase() === 'production';

// Multiple allowed origins — custom domain + Vercel deploy
const ALLOWED_ORIGINS: string[] = [
  'https://eventsli.com',
  'https://www.eventsli.com',
  'https://eventwaw.com',
  'https://www.eventwaw.com',
  'https://event-waw-platform.vercel.app',  // Keep during DNS transition; remove post-launch
];

// S-3 FIX: Only include localhost origins in non-production environments
if (!IS_PRODUCTION) {
  ALLOWED_ORIGINS.push(
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8080',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:8080',
    'http://127.0.0.1:5500',  // VS Code Live Server
    'http://localhost:5500',
  );
}

// Also check env var for any additional origin
const envOrigin = Deno.env.get('ALLOWED_ORIGIN');
if (envOrigin && !ALLOWED_ORIGINS.includes(envOrigin)) {
  ALLOWED_ORIGINS.push(envOrigin);
}

/**
 * Check if an origin is allowed (supports Vercel preview URLs).
 * S-2 FIX: Rejects null/empty origin to prevent CSRF via sandboxed iframes.
 */
function isAllowedOrigin(origin: string): boolean {
  if (!origin || origin === 'null') return false; // S-2 FIX: Reject null/empty origin
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Allow only OUR Vercel preview deployments (project-scoped)
  if (/^https:\/\/event-waw-platform(-[a-z0-9]+)?(-[a-z0-9]+)?\.vercel\.app$/.test(origin)) return true;
  return false;
}

/**
 * Get CORS headers for a specific request, matching the Origin dynamically.
 */
export function getCorsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers?.get('Origin') || '';
  // For null/empty origin, return primary domain (never wildcard — prevents credential leaks)
  const allowOrigin = (!origin || origin === 'null')
    ? ALLOWED_ORIGINS[0]
    : isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
}

/**
 * Handle CORS preflight request.
 */
export function handleCORS(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }
  return null;
}

/**
 * Return a JSON error response with CORS headers.
 */
export function errorResponse(
  status: number,
  message: string,
  extra: Record<string, unknown> = {},
  req?: Request
): Response {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  });
}

/**
 * Return a JSON success response with CORS headers.
 */
export function jsonResponse(data: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  });
}
