-- ====================================================================
-- EVENT WAW — Total Database Cleanup Script
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
-- ====================================================================

-- 1. Delete all events. 
-- Because of ON DELETE CASCADE in the schema, this will automatically delete:
-- ticket_tiers, reservations, orders, and tickets associated with them.
DELETE FROM public.events;

-- 2. Delete any orphaned records just to be absolutely sure
DELETE FROM public.orders;
DELETE FROM public.tickets;
DELETE FROM public.reservations;
DELETE FROM public.ticket_tiers;

-- 3. Delete all users EXCEPT the admin 'gooamr88@gmail.com'.
-- Because of ON DELETE CASCADE, this will automatically delete their profiles
-- and any login OTPs associated with them.
DELETE FROM auth.users WHERE email != 'gooamr88@gmail.com';

-- 4. Delete login OTPs for the admin to start completely fresh
DELETE FROM public.login_otps;

-- At this point, the database is completely wiped clean, 
-- leaving only the 'gooamr88@gmail.com' user in auth.users and public.profiles.
