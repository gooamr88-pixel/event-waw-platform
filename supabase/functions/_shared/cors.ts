/// <reference types="https://deno.land/x/deploy@0.12.0/types.ts" />
// @ts-nocheck — This file runs on Deno (Supabase Edge Functions)
// ═══════════════════════════════════
// EVENT WAW — Shared CORS & Response Helpers
// Used by all Edge Functions
// ═══════════════════════════════════

const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN');
if (!allowedOrigin) {
  console.error('FATAL: ALLOWED_ORIGIN environment variable is not set.');
}

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': allowedOrigin || 'https://eventwaw.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Handle CORS preflight request.
 */
export function handleCORS(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  return null;
}

/**
 * Return a JSON error response with CORS headers.
 */
export function errorResponse(
  status: number,
  message: string,
  extra: Record<string, unknown> = {}
): Response {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/**
 * Return a JSON success response with CORS headers.
 */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
