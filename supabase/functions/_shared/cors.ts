/// <reference types="https://deno.land/x/deploy@0.12.0/types.ts" />
// @ts-nocheck — This file runs on Deno (Supabase Edge Functions)
// ═══════════════════════════════════
// EVENT WAW — Shared CORS & Response Helpers
// Used by all Edge Functions
// ═══════════════════════════════════

// Multiple allowed origins — custom domain + Vercel + localhost dev
const ALLOWED_ORIGINS = [
  'https://eventwaw.com',
  'https://www.eventwaw.com',
  'https://event-waw-platform.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
];

// Also check env var for any additional origin
const envOrigin = Deno.env.get('ALLOWED_ORIGIN');
if (envOrigin && !ALLOWED_ORIGINS.includes(envOrigin)) {
  ALLOWED_ORIGINS.push(envOrigin);
}

/**
 * Get CORS headers for a specific request, matching the Origin dynamically.
 */
function getCorsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers?.get('Origin') || '';
  const matched = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': matched,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
