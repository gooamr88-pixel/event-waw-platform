-- ═══════════════════════════════════════════
-- EVENTSLI — Gate Team Table Migration
-- Scanner staff management for organizers
-- ═══════════════════════════════════════════

-- Gate Team: organizers can invite scanner-only staff
CREATE TABLE IF NOT EXISTS public.gate_team (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  staff_email TEXT NOT NULL,
  staff_name TEXT DEFAULT '',
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'removed')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organizer_id, staff_email)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_gate_team_organizer ON public.gate_team(organizer_id);
CREATE INDEX IF NOT EXISTS idx_gate_team_email ON public.gate_team(staff_email);

-- RLS
ALTER TABLE public.gate_team ENABLE ROW LEVEL SECURITY;

-- Organizers can manage their own gate team
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'gate_team_organizer_all' AND tablename = 'gate_team') THEN
    CREATE POLICY gate_team_organizer_all ON public.gate_team
      FOR ALL USING (auth.uid() = organizer_id)
      WITH CHECK (auth.uid() = organizer_id);
  END IF;
END $$;

-- Admin full access
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'gate_team_admin_all' AND tablename = 'gate_team') THEN
    CREATE POLICY gate_team_admin_all ON public.gate_team
      FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
      );
  END IF;
END $$;

-- Scanner staff can read their own invitations
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'gate_team_staff_read' AND tablename = 'gate_team') THEN
    CREATE POLICY gate_team_staff_read ON public.gate_team
      FOR SELECT USING (
        staff_email = (SELECT email FROM auth.users WHERE id = auth.uid())
      );
  END IF;
END $$;

-- ✅ Gate team table created successfully
