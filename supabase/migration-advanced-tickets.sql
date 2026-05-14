-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Add Advanced Ticket Configurations & Promo Codes
-- Idempotent — safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- Add new columns to ticket_tiers if they don't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ticket_tiers' AND column_name = 'min_purchase') THEN
    ALTER TABLE public.ticket_tiers ADD COLUMN min_purchase INT DEFAULT 1;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ticket_tiers' AND column_name = 'max_purchase') THEN
    ALTER TABLE public.ticket_tiers ADD COLUMN max_purchase INT DEFAULT 10;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ticket_tiers' AND column_name = 'sales_start') THEN
    ALTER TABLE public.ticket_tiers ADD COLUMN sales_start TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ticket_tiers' AND column_name = 'sales_end') THEN
    ALTER TABLE public.ticket_tiers ADD COLUMN sales_end TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ticket_tiers' AND column_name = 'is_hidden') THEN
    ALTER TABLE public.ticket_tiers ADD COLUMN is_hidden BOOLEAN DEFAULT false;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ticket_tiers' AND column_name = 'seating_type') THEN
    ALTER TABLE public.ticket_tiers ADD COLUMN seating_type TEXT DEFAULT 'general'; -- general, reserved, tables
  END IF;
END $$;

-- Create promo_codes table
CREATE TABLE IF NOT EXISTS public.promo_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  discount_type TEXT NOT NULL DEFAULT 'percentage', -- 'percentage' or 'fixed'
  discount_value DECIMAL(10,2) NOT NULL,
  max_uses INT DEFAULT NULL,
  current_uses INT DEFAULT 0,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, code)
);

-- Enable RLS on promo_codes
ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'promo_codes_organizer_all' AND tablename = 'promo_codes') THEN
    CREATE POLICY "promo_codes_organizer_all" ON public.promo_codes FOR ALL USING (
      EXISTS (SELECT 1 FROM events e WHERE e.id = promo_codes.event_id AND e.organizer_id = auth.uid())
    );
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'promo_codes_anon_select' AND tablename = 'promo_codes') THEN
    CREATE POLICY "promo_codes_anon_select" ON public.promo_codes FOR SELECT USING (true);
  END IF;
END $$;
