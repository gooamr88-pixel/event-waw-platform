-- ═══════════════════════════════════════════════
-- EVENT WAW — Seed Data (Demo Events)
-- ═══════════════════════════════════════════════
-- Run this after a user signs up as organizer.
-- Replace 'ORGANIZER_USER_ID' with the actual UUID.

-- First, update the demo organizer role
-- UPDATE profiles SET role = 'organizer' WHERE email = 'organizer@eventwaw.com';

-- ── Demo Events ──

DO $$
DECLARE
  v_organizer_id UUID;
  v_event1_id UUID;
  v_event2_id UUID;
  v_event3_id UUID;
BEGIN
  -- Get the first organizer (or any user) to use as demo organizer
  SELECT id INTO v_organizer_id FROM profiles WHERE role = 'organizer' LIMIT 1;
  
  -- If no organizer exists, use first user
  IF v_organizer_id IS NULL THEN
    SELECT id INTO v_organizer_id FROM profiles LIMIT 1;
  END IF;

  -- Skip if no users exist
  IF v_organizer_id IS NULL THEN
    RAISE NOTICE 'No users found. Create a user first, then run this seed.';
    RETURN;
  END IF;

  -- Event 1: Music Festival
  INSERT INTO events (id, organizer_id, title, description, cover_image, category, venue, venue_address, city, date, end_date, status)
  VALUES (
    uuid_generate_v4(),
    v_organizer_id,
    'Neon Pulse Music Festival',
    'Experience the ultimate music festival featuring top international and local artists. Three stages, immersive light shows, and unforgettable performances under the Cairo sky.',
    '/images/event-concert.png',
    'music',
    'Cairo International Stadium',
    'Nasr City, Cairo, Egypt',
    'Cairo',
    '2026-05-17 20:00:00+02',
    '2026-05-18 03:00:00+02',
    'published'
  ) RETURNING id INTO v_event1_id;

  -- Event 1 Tiers
  INSERT INTO ticket_tiers (event_id, name, description, price, capacity, sort_order) VALUES
    (v_event1_id, 'General Admission', 'Access to all main areas', 850.00, 500, 1),
    (v_event1_id, 'VIP', 'Premium viewing area, complimentary drinks, VIP lounge', 2500.00, 100, 2),
    (v_event1_id, 'VVIP', 'Front row, private area, full service, meet & greet', 5000.00, 30, 3);

  -- Event 2: Golden Gala
  INSERT INTO events (id, organizer_id, title, description, cover_image, category, venue, venue_address, city, date, end_date, status)
  VALUES (
    uuid_generate_v4(),
    v_organizer_id,
    'The Golden Gala 2026',
    'An evening of elegance and sophistication. Black-tie charity gala featuring live jazz, gourmet dining, and exclusive art exhibitions. Proceeds support local education initiatives.',
    '/images/event-gala.png',
    'gala',
    'Royal Maxim Palace',
    'First Settlement, New Cairo, Egypt',
    'Cairo',
    '2026-06-06 19:30:00+02',
    '2026-06-07 00:00:00+02',
    'published'
  ) RETURNING id INTO v_event2_id;

  -- Event 2 Tiers
  INSERT INTO ticket_tiers (event_id, name, description, price, capacity, sort_order) VALUES
    (v_event2_id, 'Standard', 'Dinner, drinks, and entertainment', 2500.00, 200, 1),
    (v_event2_id, 'Premium Table', 'Reserved table for 8, premium wine selection', 15000.00, 25, 2);

  -- Event 3: Tech Summit
  INSERT INTO events (id, organizer_id, title, description, cover_image, category, venue, venue_address, city, date, end_date, status)
  VALUES (
    uuid_generate_v4(),
    v_organizer_id,
    'Future Tech Summit 2026',
    'Two days of cutting-edge technology talks, workshops, and networking. Featuring speakers from Google, Meta, and leading Egyptian tech startups.',
    '/images/event-conference.png',
    'conference',
    'GrEEK Campus',
    'Downtown Cairo, Egypt',
    'Cairo',
    '2026-06-15 09:00:00+02',
    '2026-06-16 18:00:00+02',
    'published'
  ) RETURNING id INTO v_event3_id;

  -- Event 3 Tiers
  INSERT INTO ticket_tiers (event_id, name, description, price, capacity, sort_order) VALUES
    (v_event3_id, 'Day Pass', 'Single day access to all talks and workshops', 450.00, 300, 1),
    (v_event3_id, 'Full Pass', 'Both days + networking dinner + workshop materials', 750.00, 200, 2),
    (v_event3_id, 'Speaker Access', 'Full pass + speaker lounge + 1-on-1 meetups', 1500.00, 50, 3);

  RAISE NOTICE 'Seed data created successfully!';
END $$;
