-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — FULL DATABASE PURGE (Preserve Super Admin)
--
-- Preserves: gooamr88@gmail.com (auth.users + profiles)
-- Deletes:   ALL other data across every table
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
-- LAYER 1: LEAF TABLES (no dependents)
-- ════════════════════════════════════════════════════════════

-- Webhook failure logs
DELETE FROM webhook_failures;

-- Login OTPs (except admin's)
DELETE FROM login_otps
WHERE user_id != (SELECT id FROM auth.users WHERE email = 'gooamr88@gmail.com');

-- Storage objects (ticket PDFs, event covers)
-- ⚠️ Cannot delete via SQL — Supabase blocks it.
-- Clear manually: Dashboard → Storage → ticket-pdfs → Select All → Delete
-- Clear manually: Dashboard → Storage → event-covers → Select All → Delete


-- ════════════════════════════════════════════════════════════
-- LAYER 2: TICKETS + PAYMENTS (depend on orders)
-- ════════════════════════════════════════════════════════════

-- All tickets (no admin exception — admin doesn't buy tickets)
DELETE FROM tickets;

-- All payment records
DELETE FROM payments;


-- ════════════════════════════════════════════════════════════
-- LAYER 3: ORDERS + PAYOUTS (depend on events/organizers)
-- ════════════════════════════════════════════════════════════

DELETE FROM orders;
DELETE FROM payouts;


-- ════════════════════════════════════════════════════════════
-- LAYER 4: RESERVATIONS (depend on ticket_tiers + profiles)
-- ════════════════════════════════════════════════════════════

DELETE FROM reservations;


-- ════════════════════════════════════════════════════════════
-- LAYER 5: SEATING (depend on ticket_tiers)
-- ════════════════════════════════════════════════════════════

-- These tables may not exist if migration-v8 wasn't run.
-- Wrapped in exception handlers for safety.
DO $$ BEGIN DELETE FROM seats; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN DELETE FROM sections; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN DELETE FROM seating_charts; EXCEPTION WHEN undefined_table THEN NULL; END $$;


-- ════════════════════════════════════════════════════════════
-- LAYER 6: PROMO CODES (depend on events)
-- ════════════════════════════════════════════════════════════

DO $$ BEGIN DELETE FROM promo_codes; EXCEPTION WHEN undefined_table THEN NULL; END $$;


-- ════════════════════════════════════════════════════════════
-- LAYER 7: TICKET TIERS (depend on events)
-- ════════════════════════════════════════════════════════════

DELETE FROM ticket_tiers;


-- ════════════════════════════════════════════════════════════
-- LAYER 8: EVENTS (depend on profiles/organizer_id)
-- ════════════════════════════════════════════════════════════

DELETE FROM events;


-- ════════════════════════════════════════════════════════════
-- LAYER 9: ORGANIZERS (depend on profiles)
-- ════════════════════════════════════════════════════════════

-- Keep admin's organizer row if one exists
DELETE FROM organizers
WHERE user_id != (SELECT id FROM auth.users WHERE email = 'gooamr88@gmail.com');


-- ════════════════════════════════════════════════════════════
-- LAYER 10: TERMS VERSIONS (standalone reference table)
-- ════════════════════════════════════════════════════════════

DO $$ BEGIN DELETE FROM terms_versions; EXCEPTION WHEN undefined_table THEN NULL; END $$;


-- ════════════════════════════════════════════════════════════
-- LAYER 11: GATE TEAM MEMBERS (depend on events + profiles)
-- ════════════════════════════════════════════════════════════

DO $$ BEGIN DELETE FROM gate_team; EXCEPTION WHEN undefined_table THEN NULL; END $$;


-- ════════════════════════════════════════════════════════════
-- LAYER 12: PROFILES (depend on auth.users)
-- Keep ONLY the super admin profile
-- ════════════════════════════════════════════════════════════

DELETE FROM profiles
WHERE id != (SELECT id FROM auth.users WHERE email = 'gooamr88@gmail.com');


-- ════════════════════════════════════════════════════════════
-- LAYER 13: AUTH TABLES (Supabase internal)
-- Keep ONLY the super admin
-- ════════════════════════════════════════════════════════════

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
-- LAYER 14: RESET COUNTERS
-- UUID primary keys don't use sequences, but sold_count
-- and other counters on remaining rows need resetting.
-- ════════════════════════════════════════════════════════════

-- Reset ticket_tiers sold_count (all tiers are deleted, but just in case)
UPDATE ticket_tiers SET sold_count = 0 WHERE sold_count > 0;

-- Reset admin profile if needed
UPDATE profiles
SET otp_verified_at = NULL, stripe_customer_id = NULL
WHERE id = (SELECT id FROM auth.users WHERE email = 'gooamr88@gmail.com');


-- ════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES (run after COMMIT to confirm)
-- ════════════════════════════════════════════════════════════

-- Check: only 1 user remains
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
