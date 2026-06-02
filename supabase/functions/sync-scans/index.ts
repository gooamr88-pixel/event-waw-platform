// @ts-nocheck — This file runs on Deno (Supabase Edge Functions), not Node/Browser
// ═══════════════════════════════════
// EVENTSLI — Sync Offline Scans Edge Function
// Accepts batched offline scans from the Flutter Gatekeeper app
// and processes them via the sync_offline_scans RPC.
// ═══════════════════════════════════
// Deploy: supabase functions deploy sync-scans --no-verify-jwt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { handleCORS, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { authenticateRequest, createAdminClient } from '../_shared/auth.ts';
import { isValidUUID } from '../_shared/validation.ts';
import { rateLimit } from '../_shared/rate-limit.ts';

serve(async (req) => {
  const corsResponse = handleCORS(req);
  if (corsResponse) return corsResponse;

  try {
    // ── Authenticate the scanner user ──
    const { user, error: authError } = await authenticateRequest(req);
    if (!user) return errorResponse(401, authError || 'Unauthorized', {}, req);

    // ── Rate Limit: 10 sync requests per minute (each can have up to 500 scans) ──
    if (!rateLimit(`sync:${user.id}`, 10, 60_000)) {
      return errorResponse(429, 'Too many sync attempts. Please wait.', {}, req);
    }

    // ── Parse request body ──
    let body: any;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, 'Invalid JSON body', {}, req);
    }

    const { event_id, session_id, scans } = body;

    // ── Validate inputs ──
    if (!event_id || !isValidUUID(event_id)) {
      return errorResponse(400, 'Valid event_id (UUID) is required', {}, req);
    }

    if (session_id && !isValidUUID(session_id)) {
      return errorResponse(400, 'session_id must be a valid UUID', {}, req);
    }

    if (!scans || !Array.isArray(scans) || scans.length === 0) {
      return errorResponse(400, 'scans must be a non-empty array', {}, req);
    }

    if (scans.length > 500) {
      return errorResponse(400, 'Maximum 500 scans per sync request', {}, req);
    }

    // Validate each scan entry has a valid ticket_id
    for (const scan of scans) {
      if (!scan.ticket_id || !isValidUUID(scan.ticket_id)) {
        return errorResponse(400, `Invalid ticket_id in scan: ${JSON.stringify(scan)}`, {}, req);
      }
    }

    // ── Commission Debt Kill-Switch (same as verify-ticket) ──
    const supabase = createAdminClient();

    const { data: debtCheck } = await supabase
      .from('commission_debt')
      .select('scanner_locked, commission_balance, lock_reason')
      .eq('event_id', event_id)
      .eq('scanner_locked', true)
      .maybeSingle();

    if (debtCheck?.scanner_locked) {
      console.warn(`⛔ KILL-SWITCH: Sync rejected for event ${event_id} — unpaid commission: ${debtCheck.commission_balance}`);
      return errorResponse(
        423,
        `Scanner Locked: Unpaid Commission\n\nOutstanding balance: ${debtCheck.commission_balance}\n\nPlease settle your commission debt to sync scans.`,
        {
          locked: true,
          reason: 'unpaid_commission',
          balance: debtCheck.commission_balance,
          lock_reason: debtCheck.lock_reason,
        },
        req
      );
    }

    // ── Call sync_offline_scans RPC ──
    const { data: syncResult, error: syncError } = await supabase
      .rpc('sync_offline_scans', {
        p_event_id: event_id,
        p_session_id: session_id || null,
        p_scans: scans,
      });

    if (syncError) {
      console.error('sync_offline_scans RPC error:', syncError.message);
      return errorResponse(500, syncError.message || 'Sync failed', {}, req);
    }

    if (!syncResult) {
      return errorResponse(500, 'No response from sync engine', {}, req);
    }

    // Check for RPC-level errors
    if (syncResult.error) {
      return errorResponse(403, syncResult.error, {}, req);
    }

    // ── Return sync results ──
    return jsonResponse({
      ...syncResult,
      synced_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error('Sync error:', err);
    return errorResponse(500, err.message || 'Sync failed', {}, req);
  }
});
