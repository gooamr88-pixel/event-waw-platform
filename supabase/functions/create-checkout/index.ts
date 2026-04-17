// ═══════════════════════════════════
// EVENT WAW — Create Checkout Edge Function
// Supabase Edge Function (Deno)
// ═══════════════════════════════════
// Deploy: supabase functions deploy create-checkout --no-verify-jwt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@13?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' });
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get authenticated user
    const authHeader = req.headers.get('Authorization')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { tier_id, quantity = 1 } = await req.json();

    if (!tier_id) {
      return new Response(JSON.stringify({ error: 'tier_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create atomic reservation (locks the row, checks capacity)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: reservation, error: resError } = await adminClient
      .rpc('create_reservation', {
        p_user_id: user.id,
        p_tier_id: tier_id,
        p_quantity: quantity,
      });

    if (resError) {
      return new Response(JSON.stringify({ error: resError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const res = reservation[0];

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: 'egp',
            product_data: {
              name: `${res.event_title} — ${res.tier_name}`,
              description: `${quantity}x ticket(s)`,
            },
            unit_amount: Math.round(res.tier_price * 100), // Stripe uses cents
          },
          quantity,
        },
      ],
      metadata: {
        reservation_id: res.reservation_id,
        user_id: user.id,
        event_id: res.event_id,
        tier_id: tier_id,
        quantity: String(quantity),
      },
      success_url: `${req.headers.get('origin')}/checkout-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.get('origin')}/event-detail.html?id=${res.event_id}`,
      expires_at: Math.floor(Date.now() / 1000) + 600, // 10 minutes to match reservation
    });

    return new Response(
      JSON.stringify({ checkout_url: session.url, reservation_id: res.reservation_id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Checkout error:', err);
    return new Response(
      JSON.stringify({ error: err.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
