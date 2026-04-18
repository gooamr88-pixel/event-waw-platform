// @ts-nocheck — This file runs on Deno (Supabase Edge Functions)
// ═══════════════════════════════════
// EVENT WAW — Shared Validation Helpers
// Used by Edge Functions
// ═══════════════════════════════════

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate a string is a well-formed UUID v4.
 */
export function isValidUUID(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

/**
 * Validate quantity is an integer between 1 and max.
 */
export function isValidQuantity(value: unknown, max = 10): value is number {
  const num = Number(value);
  return Number.isInteger(num) && num >= 1 && num <= max;
}
