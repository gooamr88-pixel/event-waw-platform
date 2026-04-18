// @ts-nocheck — This file runs on Deno (Supabase Edge Functions), not Node/Browser
// ═══════════════════════════════════
// EVENT WAW — Stripe Onboarding Edge Function
// Handles Stripe Connect account creation & onboarding links
// ═══════════════════════════════════
// Deploy: supabase functions deploy stripe-onboarding --no-verify-jwt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@17?target=deno';
import { handleCORS, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { authenticateRequest, createAdminClient } from '../_shared/auth.ts';
import { rateLimit } from '../_shared/rate-limit.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN') || 'https://eventwaw.com';

serve(async (req) => {
  const corsResponse = handleCORS(req);
  if (corsResponse) return corsResponse;

  try {
    // ── Authenticate ──
    const { user, error: authError } = await authenticateRequest(req);
    if (!user) return errorResponse(401, authError || 'Unauthorized');

    // ── Rate Limit: 3 onboarding attempts per 10 min ──
    if (!rateLimit(`onboard:${user.id}`, 3, 600_000)) {
      return errorResponse(429, 'Too many requests. Please wait.');
    }

    // ── Parse action ──
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // Default action is 'onboard'
    }
    const action = body.action || 'onboard';

    const supabase = createAdminClient();

    // ── Verify user is an organizer ──
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, stripe_account_id, stripe_onboarding_complete')
      .eq('id', user.id)
      .single();

    if (!profile || !['organizer', 'admin'].includes(profile.role)) {
      return errorResponse(403, 'Only organizers can set up payment accounts');
    }

    // ═══════════════════════════════════
    // ACTION: check-status
    // Returns the current onboarding state
    // ═══════════════════════════════════
    if (action === 'check-status') {
      if (!profile.stripe_account_id) {
        return jsonResponse({ status: 'not_started', onboarding_complete: false });
      }

      try {
        const account = await stripe.accounts.retrieve(profile.stripe_account_id);
        const isComplete = account.charges_enabled && account.details_submitted;

        // Sync completion status to DB if changed
        if (isComplete && !profile.stripe_onboarding_complete) {
          await supabase
            .from('profiles')
            .update({ stripe_onboarding_complete: true })
            .eq('id', user.id);
        }

        return jsonResponse({
          status: isComplete ? 'complete' : 'pending',
          onboarding_complete: isComplete,
          charges_enabled: account.charges_enabled,
          payouts_enabled: account.payouts_enabled,
          details_submitted: account.details_submitted,
        });
      } catch (err) {
        console.error('Failed to retrieve Stripe account:', err);
        return jsonResponse({ status: 'error', onboarding_complete: false });
      }
    }

    // ═══════════════════════════════════
    // ACTION: onboard (default)
    // Creates or retrieves account, returns onboarding link
    // ═══════════════════════════════════
    let accountId = profile.stripe_account_id;

    if (!accountId) {
      // Create a new Standard connected account
      const account = await stripe.accounts.create({
        type: 'standard',
        email: user.email,
        metadata: {
          user_id: user.id,
          platform: 'event_waw',
        },
        business_profile: {
          mcc: '7922', // Theatrical Producers & Ticket Agencies
          url: `https://eventwaw.com`,
        },
      });

      accountId = account.id;

      // Save to profile
      await supabase
        .from('profiles')
        .update({ stripe_account_id: accountId })
        .eq('id', user.id);

      console.log(`🏦 Stripe Connect account created: ${accountId} for user ${user.id}`);
    }

    // Generate onboarding link
    const origin = req.headers.get('origin') || allowedOrigin;
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/dashboard.html?stripe=refresh`,
      return_url: `${origin}/dashboard.html?stripe=complete`,
      type: 'account_onboarding',
    });

    return jsonResponse({
      url: accountLink.url,
      account_id: accountId,
    });

  } catch (err) {
    console.error('Stripe onboarding error:', err);
    return errorResponse(500, err.message || 'Internal server error');
  }
});
