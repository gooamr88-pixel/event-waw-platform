// @ts-nocheck — This file runs on Deno (Supabase Edge Functions)
// ═══════════════════════════════════
// EVENT WAW — Shared Auth Helper
// Authenticates users via JWT in Edge Functions
// ═══════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/**
 * Authenticate a user from an incoming request's Authorization header.
 * Returns the user object or null if authentication fails.
 */
export async function authenticateRequest(
  req: Request
): Promise<{ user: any; error: string | null }> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return { user: null, error: 'Missing Authorization header' };
  }

  const token = authHeader.replace('Bearer ', '');
  if (!token || token === authHeader) {
    return { user: null, error: 'Malformed Authorization header' };
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    return { user: null, error: 'Unauthorized' };
  }

  return { user, error: null };
}

/**
 * Create a Supabase admin client (service_role).
 */
export function createAdminClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}
