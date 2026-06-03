-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — FULL DATABASE PURGE (Preserve Super Admin)
--
-- Preserves: gooamr88@gmail.com (auth.users + profiles)
-- Deletes:   ALL other data across every table in correct FK order
--
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ── Step 0: Capture the admin user ID ──
DO $admin_check$
DECLARE
  v_admin_id UUID;
BEGIN
  SELECT id INTO v_admin_id FROM auth.users WHERE email = 'gooamr88@gmail.com';
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'ABORT: Super admin gooamr88@gmail.com not found in auth.users. Refusing to purge.';
  END IF;
  RAISE NOTICE 'Super admin found: % — proceeding with purge.', v_admin_id;
END $admin_check$;


-- ════════════════════════════════════════════════════════════
-- LAYER 1: LEAF / DEDUPLICATION TABLES
-- ════════════════════════════════════════════════════════════

DELETE FROM webhook_failures;

DELETE FROM login_otps
WHERE user_id != (SELECT id FROM auth.users WHERE email = 'gooamr88@gmail.com');

-- Scans (reference tickets)
DO $$ BEGIN DELETE FROM scans; EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Email logs (reference events, orders, tickets)
DO $$ BEGIN DELETE FROM email_logs; EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Commission settlements and debt
DO $$ BEGIN DELETE FROM commission_settlements; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN DELETE FROM commission_debt; EXCEPTION WHEN undefined_table THEN NULL; END $$;


-- ════════════════════════════════════════════════════════════
-- LAYER 2: RESOLVING CIRCULAR REFERENCES & FK DELETIONS
-- ════════════════════════════════════════════════════════════

-- Break foreign key reference from orders to manual_transfer_orders
DO $$ 
BEGIN 
  UPDATE orders SET manual_transfer_order_id = NULL; 
EXCEPTION 
  WHEN undefined_column OR undefined_table THEN NULL; 
END $$;

-- Tickets (reference orders, ticket_tiers, events)
DELETE FROM tickets;

-- Payments (reference orders)
DELETE FROM payments;

-- Orders (reference events, profiles)
DELETE FROM orders;

-- Manual transfer orders (reference reservations, events, profiles)
DO $$ BEGIN DELETE FROM manual_transfer_orders; EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Reservations (reference ticket_tiers, profiles, events)
DELETE FROM reservations;


-- ════════════════════════════════════════════════════════════
-- LAYER 3: SEATING & PROMO CODES
-- ════════════════════════════════════════════════════════════

DO $$ BEGIN DELETE FROM seats; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN DELETE FROM sections; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN DELETE FROM seating_charts; EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN DELETE FROM promo_codes; EXCEPTION WHEN undefined_table THEN NULL; END $$;


-- ════════════════════════════════════════════════════════════
-- LAYER 4: TICKET TIERS & EVENTS
-- ════════════════════════════════════════════════════════════

DELETE FROM ticket_tiers;

DELETE FROM events;


-- ════════════════════════════════════════════════════════════
-- LAYER 5: ORGANIZERS, TERMS, GATE TEAM
-- ════════════════════════════════════════════════════════════

DELETE FROM organizers
WHERE user_id != (SELECT id FROM auth.users WHERE email = 'gooamr88@gmail.com');

DO $$ BEGIN DELETE FROM terms_versions; EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN DELETE FROM gate_team; EXCEPTION WHEN undefined_table THEN NULL; END $$;


-- ════════════════════════════════════════════════════════════
-- LAYER 6: PROFILES & SUPABASE AUTH (Preserves Admin Only)
-- ════════════════════════════════════════════════════════════

DELETE FROM profiles
WHERE id != (SELECT id FROM auth.users WHERE email = 'gooamr88@gmail.com');

-- auth.identities (login providers)
DELETE FROM auth.identities
WHERE user_id != (SELECT id FROM auth.users WHERE email = 'gooamr88@gmail.com');

-- auth.sessions (active sessions — force re-login for non-admin)
DELETE FROM auth.sessions
WHERE user_id != (SELECT id FROM auth.users WHERE email = 'gooamr88@gmail.com');

-- auth.refresh_tokens
DELETE FROM auth.refresh_tokens
WHERE session_id NOT IN (
  SELECT id FROM auth.sessions
  WHERE user_id = (SELECT id FROM auth.users WHERE email = 'gooamr88@gmail.com')
);

-- auth.mfa_factors
DO $$ BEGIN
  DELETE FROM auth.mfa_factors
  WHERE user_id != (SELECT id FROM auth.users WHERE email = 'gooamr88@gmail.com');
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- auth.users — DELETE all non-admin users
DELETE FROM auth.users
WHERE email != 'gooamr88@gmail.com';


-- ════════════════════════════════════════════════════════════
-- LAYER 7: RESET COUNTERS
-- ════════════════════════════════════════════════════════════

UPDATE ticket_tiers SET sold_count = 0 WHERE sold_count > 0;

UPDATE profiles
SET otp_verified_at = NULL, stripe_customer_id = NULL
WHERE id = (SELECT id FROM auth.users WHERE email = 'gooamr88@gmail.com');


-- ════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES (run after COMMIT to confirm)
-- ════════════════════════════════════════════════════════════

DO $verify$
DECLARE
  v_user_count INT;
  v_profile_count INT;
  v_order_count INT;
  v_ticket_count INT;
  v_event_count INT;
BEGIN
  SELECT COUNT(*) INTO v_user_count FROM auth.users;
  SELECT COUNT(*) INTO v_profile_count FROM profiles;
  SELECT COUNT(*) INTO v_order_count FROM orders;
  SELECT COUNT(*) INTO v_ticket_count FROM tickets;
  SELECT COUNT(*) INTO v_event_count FROM events;

  RAISE NOTICE '══════════════════════════════════';
  RAISE NOTICE '  PURGE COMPLETE — VERIFICATION';
  RAISE NOTICE '══════════════════════════════════';
  RAISE NOTICE '  auth.users:  % (expected: 1)', v_user_count;
  RAISE NOTICE '  profiles:    % (expected: 1)', v_profile_count;
  RAISE NOTICE '  orders:      % (expected: 0)', v_order_count;
  RAISE NOTICE '  tickets:     % (expected: 0)', v_ticket_count;
  RAISE NOTICE '  events:      % (expected: 0)', v_event_count;
  RAISE NOTICE '══════════════════════════════════';

  IF v_user_count != 1 THEN
    RAISE EXCEPTION 'VERIFICATION FAILED: Expected 1 user, found %', v_user_count;
  END IF;
END $verify$;

COMMIT;
