// @ts-nocheck — This file runs on Deno (Supabase Edge Functions), not Node/Browser
// ═══════════════════════════════════
// EVENTSLI — Execute Payout Edge Function
// Processes approved payout requests by executing Stripe payouts
// on Express connected accounts with manual payout schedules.
// ═══════════════════════════════════
// Deploy: supabase functions deploy execute-payout --no-verify-jwt
//
// Architecture:
//   1. Admin calls this with a payout_id
//   2. We validate the payout is 'pending' and escrow has cleared
//   3. We resolve the organizer's Stripe Express account ID
//   4. We call stripe.payouts.create() on their connected account
//   5. We update payouts.status → 'completed' + save external_ref
//
// Security:
//   - Admin-only (role check via profiles.role)
//   - Idempotent (rejects already-processed payouts)
//   - Atomic DB updates with failure rollback

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@17?target=deno';
import { handleCORS, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { authenticateRequest, createAdminClient } from '../_shared/auth.ts';
import { rateLimit } from '../_shared/rate-limit.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);

serve(async (req) => {
  const corsResponse = handleCORS(req);
  if (corsResponse) return corsResponse;

  try {
    // ── Authenticate ──
    const { user, error: authError } = await authenticateRequest(req);
    if (!user) return errorResponse(401, authError || 'Unauthorized', {}, req);

    // ── Rate Limit: 10 payout executions per 5 minutes ──
    if (!rateLimit(`payout:${user.id}`, 10, 300_000)) {
      return errorResponse(429, 'Too many requests. Please wait.', {}, req);
    }

    const supabase = createAdminClient();

    // ── Admin-Only Access ──
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || !['admin', 'super_admin'].includes(profile.role)) {
      return errorResponse(403, 'Only admins can execute payouts', {}, req);
    }

    // ── Parse Request ──
    const body = await req.json();
    const { payout_id } = body;

    if (!payout_id) {
      return errorResponse(400, 'Missing payout_id', {}, req);
    }

    // ═══════════════════════════════════
    // STEP 1: Fetch and validate the payout request
    // ═══════════════════════════════════

    const { data: payout, error: payoutErr } = await supabase
      .from('payouts')
      .select(`
        id, organizer_id, net_amount, currency, status,
        payout_method, payout_destination, eligible_at, external_ref,
        organizers (
          id, user_id, stripe_account_id, stripe_onboarding_complete,
          payout_method, bank_name, bank_account_holder
        )
      `)
      .eq('id', payout_id)
      .single();

    if (payoutErr || !payout) {
      return errorResponse(404, 'Payout request not found', {}, req);
    }

    // ── Idempotency: reject already-processed payouts ──
    if (payout.status === 'completed') {
      return jsonResponse({
        success: true,
        duplicate: true,
        payout_id: payout.id,
        external_ref: payout.external_ref,
        message: 'Payout already completed',
      }, 200, req);
    }

    if (payout.status !== 'pending') {
      return errorResponse(
        409,
        `Cannot execute payout in '${payout.status}' status. Only 'pending' payouts can be executed.`,
        { current_status: payout.status },
        req
      );
    }

    // ── Validate amount ──
    const amountDecimal = parseFloat(payout.net_amount);
    if (!amountDecimal || amountDecimal <= 0) {
      return errorResponse(400, 'Invalid payout amount', { amount: payout.net_amount }, req);
    }

    // ── Validate escrow has cleared ──
    if (payout.eligible_at) {
      const eligibleDate = new Date(payout.eligible_at);
      if (eligibleDate > new Date()) {
        return errorResponse(
          403,
          `Payout is still in escrow. Eligible at ${eligibleDate.toISOString()}`,
          { eligible_at: payout.eligible_at },
          req
        );
      }
    }

    // ── Resolve organizer's Stripe account ──
    const organizer = payout.organizers;

    if (!organizer) {
      await markPayoutFailed(supabase, payout_id, user.id, 'Organizer record not found');
      return errorResponse(400, 'Organizer record not found for this payout', {}, req);
    }

    if (!organizer.stripe_account_id) {
      await markPayoutFailed(supabase, payout_id, user.id, 'No Stripe account connected');
      return errorResponse(
        400,
        'Organizer does not have a connected Stripe account. They must complete Stripe onboarding first.',
        {},
        req
      );
    }

    if (!organizer.stripe_onboarding_complete) {
      await markPayoutFailed(supabase, payout_id, user.id, 'Stripe onboarding incomplete');
      return errorResponse(
        400,
        'Organizer Stripe onboarding is not complete. Payouts cannot be processed.',
        {},
        req
      );
    }

    // ═══════════════════════════════════
    // STEP 2: Mark as processing (optimistic lock)
    // ═══════════════════════════════════
    // This prevents duplicate execution if the admin clicks twice
    // or if there's a concurrent request.

    const { error: lockErr, count: lockCount } = await supabase
      .from('payouts')
      .update({
        status: 'processing',
        processed_by: user.id,
      })
      .eq('id', payout_id)
      .eq('status', 'pending'); // Only transition from 'pending'

    if (lockErr || lockCount === 0) {
      return errorResponse(
        409,
        'Payout is no longer in pending state. It may have been processed by another admin.',
        {},
        req
      );
    }

    // ═══════════════════════════════════
    // STEP 3: Verify Stripe account is active
    // ═══════════════════════════════════

    let stripeAccount: any;
    try {
      stripeAccount = await stripe.accounts.retrieve(organizer.stripe_account_id);
    } catch (stripeErr: any) {
      await markPayoutFailed(
        supabase, payout_id, user.id,
        `Stripe account retrieval failed: ${stripeErr.message}`
      );
      return errorResponse(
        502,
        `Failed to retrieve Stripe account: ${stripeErr.message}`,
        {},
        req
      );
    }

    if (!stripeAccount.payouts_enabled) {
      await markPayoutFailed(
        supabase, payout_id, user.id,
        `Stripe account ${organizer.stripe_account_id} has payouts disabled`
      );
      return errorResponse(
        400,
        'Organizer Stripe account does not have payouts enabled. They may need to complete verification.',
        {},
        req
      );
    }

    // ═══════════════════════════════════
    // STEP 4: Execute the Stripe payout
    // ═══════════════════════════════════
    // stripe.payouts.create() on an Express account with manual
    // payout schedule triggers a transfer from the connected
    // account's Stripe balance to their external bank account.

    const amountCents = Math.round(amountDecimal * 100);
    const currency = (payout.currency || 'usd').toLowerCase();

    let stripePayout: any;
    try {
      stripePayout = await stripe.payouts.create(
        {
          amount: amountCents,
          currency: currency,
          description: `Eventsli payout ${payout_id}`,
          metadata: {
            payout_id: payout_id,
            organizer_id: organizer.id,
            platform: 'eventsli',
          },
        },
        {
          stripeAccount: organizer.stripe_account_id,
        }
      );
    } catch (stripeErr: any) {
      // ── Stripe payout failed ──
      // Common reasons: insufficient balance, account restricted,
      // bank account rejected, etc.
      console.error(`CRITICAL: Stripe payout failed for ${payout_id}:`, stripeErr);

      await markPayoutFailed(
        supabase, payout_id, user.id,
        `Stripe error: ${stripeErr.code || stripeErr.type} — ${stripeErr.message}`
      );

      return errorResponse(
        502,
        `Stripe payout failed: ${stripeErr.message}`,
        {
          stripe_error_code: stripeErr.code,
          stripe_error_type: stripeErr.type,
        },
        req
      );
    }

    // ═══════════════════════════════════
    // STEP 5: Mark payout as completed
    // ═══════════════════════════════════

    const { error: completeErr } = await supabase
      .from('payouts')
      .update({
        status: 'completed',
        processed_at: new Date().toISOString(),
        processed_by: user.id,
        external_ref: stripePayout.id, // e.g. "po_1Abc2DefGhi3Jk"
        notes: `Stripe payout executed. Arrival: ${stripePayout.arrival_date ? new Date(stripePayout.arrival_date * 1000).toISOString() : 'pending'}`,
      })
      .eq('id', payout_id);

    if (completeErr) {
      // CRITICAL: Stripe payout succeeded but DB update failed.
      // The money IS moving — we must log this for reconciliation.
      console.error(
        `CRITICAL RECONCILIATION NEEDED: Stripe payout ${stripePayout.id} succeeded ` +
        `but DB update failed for payout ${payout_id}:`, completeErr
      );

      // Attempt to log to webhook_failures for admin visibility
      try {
        await supabase.from('webhook_failures').insert({
          stripe_session_id: stripePayout.id,
          order_id: null,
          error: `PAYOUT_DB_UPDATE_FAILED: Stripe payout ${stripePayout.id} succeeded, ` +
                 `but payouts row ${payout_id} was not updated. Manual reconciliation required.`,
          payload: JSON.stringify({
            payout_id,
            stripe_payout_id: stripePayout.id,
            amount: amountDecimal,
            currency,
            organizer_stripe_account: organizer.stripe_account_id,
          }),
        });
      } catch (logErr) {
        console.error('Failed to log payout reconciliation issue:', logErr);
      }

      // Still return success — the money IS being transferred
      return jsonResponse({
        success: true,
        warning: 'Stripe payout executed but database update failed. Reconciliation needed.',
        payout_id,
        stripe_payout_id: stripePayout.id,
      }, 200, req);
    }

    // ═══════════════════════════════════
    // SUCCESS
    // ═══════════════════════════════════

    console.log(
      `✅ Payout executed: ${payout_id} → ${stripePayout.id}, ` +
      `${currency.toUpperCase()} ${amountDecimal} → ${organizer.stripe_account_id}`
    );

    return jsonResponse({
      success: true,
      payout_id,
      stripe_payout_id: stripePayout.id,
      amount: amountDecimal,
      currency: currency.toUpperCase(),
      stripe_account: organizer.stripe_account_id,
      stripe_status: stripePayout.status, // 'pending', 'in_transit', 'paid'
      arrival_date: stripePayout.arrival_date
        ? new Date(stripePayout.arrival_date * 1000).toISOString()
        : null,
    }, 200, req);

  } catch (err: any) {
    console.error('execute-payout error:', err);
    return errorResponse(500, err.message || 'Internal server error', {}, req);
  }
});


// ═══════════════════════════════════
// Helper: Mark payout as failed
// ═══════════════════════════════════
// Rolls back status from 'processing' to 'failed' and records the reason.

async function markPayoutFailed(
  supabase: any,
  payoutId: string,
  adminId: string,
  reason: string
) {
  try {
    await supabase
      .from('payouts')
      .update({
        status: 'failed',
        processed_at: new Date().toISOString(),
        processed_by: adminId,
        failure_reason: reason,
      })
      .eq('id', payoutId);
  } catch (err) {
    console.error(`Failed to mark payout ${payoutId} as failed:`, err);
  }
}
