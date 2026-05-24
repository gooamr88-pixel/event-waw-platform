/* =============================================
   Migration v43: Venue Templates System
   - Creates venue_templates table
   - RLS policies for organizer + system templates
   - Seeds 5 system Quick Templates (organizer_id = NULL)
   ============================================= */

-- ══════════════════════════════════════════════
-- 1. CREATE TABLE
-- ══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS venue_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,  -- NULL = system template
  name            TEXT NOT NULL,
  description     TEXT,
  thumbnail_url   TEXT,                    -- SVG snapshot stored in Supabase Storage
  layout_json     JSONB NOT NULL,          -- Pure geometry (tier_id stripped to null)

  -- Metadata (precomputed for listing display)
  total_seats     INT NOT NULL DEFAULT 0,
  section_count   INT NOT NULL DEFAULT 0,
  table_count     INT NOT NULL DEFAULT 0,
  canvas_width    INT DEFAULT 1200,
  canvas_height   INT DEFAULT 800,

  -- Visibility
  is_public       BOOLEAN DEFAULT false,   -- Future marketplace
  tags            TEXT[],                   -- e.g. ARRAY['theater', '500+', 'curved']

  -- Versioning
  version         INT NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Organizer-scoped unique name (NULLs are distinct in PG unique constraints)
  CONSTRAINT venue_templates_name_per_organizer UNIQUE(organizer_id, name)
);

-- ══════════════════════════════════════════════
-- 2. INDEXES
-- ══════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_venue_templates_organizer
  ON venue_templates(organizer_id);

CREATE INDEX IF NOT EXISTS idx_venue_templates_system
  ON venue_templates(is_public) WHERE organizer_id IS NULL;

-- ══════════════════════════════════════════════
-- 3. TRIGGER: auto-update updated_at
-- ══════════════════════════════════════════════
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'venue_templates_updated_at'
  ) THEN
    CREATE TRIGGER venue_templates_updated_at
      BEFORE UPDATE ON venue_templates
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ══════════════════════════════════════════════
-- 4. ROW LEVEL SECURITY
-- ══════════════════════════════════════════════
ALTER TABLE venue_templates ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running (idempotent)
DO $$ BEGIN
  DROP POLICY IF EXISTS templates_select_own    ON venue_templates;
  DROP POLICY IF EXISTS templates_select_system  ON venue_templates;
  DROP POLICY IF EXISTS templates_insert         ON venue_templates;
  DROP POLICY IF EXISTS templates_update_own     ON venue_templates;
  DROP POLICY IF EXISTS templates_delete_own     ON venue_templates;
  DROP POLICY IF EXISTS templates_admin_all      ON venue_templates;
END $$;

-- Organizers can read their own templates
CREATE POLICY templates_select_own ON venue_templates FOR SELECT
  USING (organizer_id = auth.uid());

-- ALL authenticated users can read system templates (organizer_id IS NULL)
CREATE POLICY templates_select_system ON venue_templates FOR SELECT
  USING (organizer_id IS NULL);

-- Organizers can insert their own templates
CREATE POLICY templates_insert ON venue_templates FOR INSERT
  WITH CHECK (organizer_id = auth.uid());

-- Organizers can update their own templates
CREATE POLICY templates_update_own ON venue_templates FOR UPDATE
  USING (organizer_id = auth.uid());

-- Organizers can delete their own templates (NOT system templates)
CREATE POLICY templates_delete_own ON venue_templates FOR DELETE
  USING (organizer_id = auth.uid());

-- Admins can do everything (CRUD on all templates including system)
CREATE POLICY templates_admin_all ON venue_templates FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ══════════════════════════════════════════════
-- 5. GRANTS
-- ══════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE, DELETE ON venue_templates TO authenticated;

-- ══════════════════════════════════════════════
-- 6. SEED SYSTEM TEMPLATES
-- ══════════════════════════════════════════════
CREATE OR REPLACE FUNCTION seed_system_venue_templates()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN

  -- ── 1. Theater ──
  INSERT INTO venue_templates (organizer_id, name, description, layout_json, total_seats, section_count, table_count, tags)
  VALUES (
    NULL,
    'Theater',
    'Classic theater layout with orchestra and balcony sections. Curved seating facing a central stage.',
    '{
      "version": 2,
      "template": true,
      "canvas": { "width": 1200, "height": 800 },
      "bgImage": null,
      "elements": [
        { "id": "el-tpl-theater-1", "type": "stage", "x": 400, "y": 30, "w": 400, "h": 60, "rotation": 0, "label": "STAGE", "color": "#d4af37", "cornerRadius": 8, "locked": false },
        { "id": "el-tpl-theater-2", "type": "section", "x": 80, "y": 130, "w": 280, "h": 200, "rotation": 0, "label": "Orchestra Left", "color": "#10B981", "rows": 8, "seatsPerRow": 10, "curve": 80, "tier_id": null, "tier_slot": "section-0", "locked": false },
        { "id": "el-tpl-theater-3", "type": "section", "x": 370, "y": 110, "w": 320, "h": 220, "rotation": 0, "label": "Orchestra Center", "color": "#10B981", "rows": 9, "seatsPerRow": 12, "curve": 120, "tier_id": null, "tier_slot": "section-1", "locked": false },
        { "id": "el-tpl-theater-4", "type": "section", "x": 700, "y": 130, "w": 280, "h": 200, "rotation": 0, "label": "Orchestra Right", "color": "#10B981", "rows": 8, "seatsPerRow": 10, "curve": 80, "tier_id": null, "tier_slot": "section-2", "locked": false },
        { "id": "el-tpl-theater-5", "type": "section", "x": 120, "y": 380, "w": 240, "h": 140, "rotation": 0, "label": "Balcony Left", "color": "#10B981", "rows": 5, "seatsPerRow": 10, "curve": 40, "tier_id": null, "tier_slot": "section-3", "locked": false },
        { "id": "el-tpl-theater-6", "type": "section", "x": 400, "y": 370, "w": 260, "h": 150, "rotation": 0, "label": "Balcony Center", "color": "#10B981", "rows": 5, "seatsPerRow": 12, "curve": 60, "tier_id": null, "tier_slot": "section-4", "locked": false },
        { "id": "el-tpl-theater-7", "type": "section", "x": 700, "y": 380, "w": 240, "h": 140, "rotation": 0, "label": "Balcony Right", "color": "#10B981", "rows": 5, "seatsPerRow": 10, "curve": 40, "tier_id": null, "tier_slot": "section-5", "locked": false },
        { "id": "el-tpl-theater-8", "type": "exit", "x": 20, "y": 550, "w": 80, "h": 80, "rotation": 0, "label": "Exit", "color": "#14b8a6", "cornerRadius": 12, "locked": false },
        { "id": "el-tpl-theater-9", "type": "exit", "x": 980, "y": 550, "w": 80, "h": 80, "rotation": 0, "label": "Exit", "color": "#14b8a6", "cornerRadius": 12, "locked": false },
        { "id": "el-tpl-theater-10", "type": "entrance", "x": 500, "y": 580, "w": 80, "h": 80, "rotation": 0, "label": "Entrance", "color": "#10b981", "cornerRadius": 12, "locked": false }
      ],
      "sections": [],
      "stage": null
    }'::jsonb,
    428, 6, 0,
    ARRAY['theater', 'curved', '500+']
  ) ON CONFLICT ON CONSTRAINT venue_templates_name_per_organizer DO NOTHING;

  -- ── 2. Arena ──
  INSERT INTO venue_templates (organizer_id, name, description, layout_json, total_seats, section_count, table_count, tags)
  VALUES (
    NULL,
    'Arena',
    'Circular arena layout with surrounding seating sections and a VIP area. Central stage/performance area.',
    '{
      "version": 2,
      "template": true,
      "canvas": { "width": 1200, "height": 800 },
      "bgImage": null,
      "elements": [
        { "id": "el-tpl-arena-1", "type": "stage", "x": 350, "y": 320, "w": 400, "h": 60, "rotation": 0, "label": "STAGE", "color": "#d4af37", "cornerRadius": 8, "locked": false },
        { "id": "el-tpl-arena-2", "type": "section", "x": 350, "y": 30, "w": 360, "h": 160, "rotation": 0, "label": "North", "color": "#10B981", "rows": 6, "seatsPerRow": 14, "curve": 200, "tier_id": null, "tier_slot": "section-0", "locked": false },
        { "id": "el-tpl-arena-3", "type": "section", "x": 350, "y": 450, "w": 360, "h": 160, "rotation": 0, "label": "South", "color": "#10B981", "rows": 6, "seatsPerRow": 14, "curve": 200, "tier_id": null, "tier_slot": "section-1", "locked": false },
        { "id": "el-tpl-arena-4", "type": "section", "x": 30, "y": 120, "w": 200, "h": 380, "rotation": 0, "label": "West", "color": "#10B981", "rows": 8, "seatsPerRow": 6, "curve": 0, "tier_id": null, "tier_slot": "section-2", "locked": false },
        { "id": "el-tpl-arena-5", "type": "section", "x": 830, "y": 120, "w": 200, "h": 380, "rotation": 0, "label": "East", "color": "#10B981", "rows": 8, "seatsPerRow": 6, "curve": 0, "tier_id": null, "tier_slot": "section-3", "locked": false },
        { "id": "el-tpl-arena-6", "type": "section", "x": 420, "y": 200, "w": 220, "h": 80, "rotation": 0, "label": "VIP North", "color": "#10B981", "rows": 3, "seatsPerRow": 10, "curve": 100, "tier_id": null, "tier_slot": "section-4", "locked": false },
        { "id": "el-tpl-arena-7", "type": "bar", "x": 30, "y": 30, "w": 160, "h": 40, "rotation": 0, "label": "Bar / Drinks", "color": "#8b5cf6", "cornerRadius": 20, "locked": false },
        { "id": "el-tpl-arena-8", "type": "food", "x": 930, "y": 30, "w": 80, "h": 80, "rotation": 0, "label": "Food Court", "color": "#10B981", "cornerRadius": 12, "locked": false },
        { "id": "el-tpl-arena-9", "type": "restroom", "x": 30, "y": 600, "w": 80, "h": 80, "rotation": 0, "label": "Restroom", "color": "#6b7280", "cornerRadius": 12, "locked": false },
        { "id": "el-tpl-arena-10", "type": "entrance", "x": 930, "y": 600, "w": 80, "h": 80, "rotation": 0, "label": "Entrance", "color": "#10b981", "cornerRadius": 12, "locked": false }
      ],
      "sections": [],
      "stage": null
    }'::jsonb,
    294, 5, 0,
    ARRAY['arena', 'circular', '500+']
  ) ON CONFLICT ON CONSTRAINT venue_templates_name_per_organizer DO NOTHING;

  -- ── 3. Classroom ──
  INSERT INTO venue_templates (organizer_id, name, description, layout_json, total_seats, section_count, table_count, tags)
  VALUES (
    NULL,
    'Classroom',
    'Conference/classroom layout with uniform rows facing a stage and projection screen. Ideal for lectures and presentations.',
    '{
      "version": 2,
      "template": true,
      "canvas": { "width": 1200, "height": 800 },
      "bgImage": null,
      "elements": [
        { "id": "el-tpl-class-1", "type": "stage", "x": 350, "y": 30, "w": 400, "h": 60, "rotation": 0, "label": "STAGE", "color": "#d4af37", "cornerRadius": 8, "locked": false },
        { "id": "el-tpl-class-2", "type": "screen", "x": 350, "y": 100, "w": 200, "h": 20, "rotation": 0, "label": "Screen", "color": "#06b6d4", "cornerRadius": 4, "locked": false },
        { "id": "el-tpl-class-3", "type": "section", "x": 150, "y": 150, "w": 800, "h": 70, "rotation": 0, "label": "Row 1", "color": "#10B981", "rows": 2, "seatsPerRow": 16, "curve": 0, "tier_id": null, "tier_slot": "section-0", "locked": false },
        { "id": "el-tpl-class-4", "type": "section", "x": 150, "y": 250, "w": 800, "h": 70, "rotation": 0, "label": "Row 2", "color": "#10B981", "rows": 2, "seatsPerRow": 16, "curve": 0, "tier_id": null, "tier_slot": "section-1", "locked": false },
        { "id": "el-tpl-class-5", "type": "section", "x": 150, "y": 350, "w": 800, "h": 70, "rotation": 0, "label": "Row 3", "color": "#10B981", "rows": 2, "seatsPerRow": 16, "curve": 0, "tier_id": null, "tier_slot": "section-2", "locked": false },
        { "id": "el-tpl-class-6", "type": "section", "x": 150, "y": 450, "w": 800, "h": 70, "rotation": 0, "label": "Row 4", "color": "#10B981", "rows": 2, "seatsPerRow": 16, "curve": 0, "tier_id": null, "tier_slot": "section-3", "locked": false },
        { "id": "el-tpl-class-7", "type": "section", "x": 150, "y": 550, "w": 800, "h": 70, "rotation": 0, "label": "Row 5", "color": "#10B981", "rows": 2, "seatsPerRow": 16, "curve": 0, "tier_id": null, "tier_slot": "section-4", "locked": false },
        { "id": "el-tpl-class-8", "type": "entrance", "x": 50, "y": 700, "w": 80, "h": 80, "rotation": 0, "label": "Entrance", "color": "#10b981", "cornerRadius": 12, "locked": false },
        { "id": "el-tpl-class-9", "type": "exit", "x": 950, "y": 700, "w": 80, "h": 80, "rotation": 0, "label": "Exit", "color": "#14b8a6", "cornerRadius": 12, "locked": false }
      ],
      "sections": [],
      "stage": null
    }'::jsonb,
    160, 5, 0,
    ARRAY['classroom', 'conference', '100+']
  ) ON CONFLICT ON CONSTRAINT venue_templates_name_per_organizer DO NOTHING;

  -- ── 4. Round Tables ──
  INSERT INTO venue_templates (organizer_id, name, description, layout_json, total_seats, section_count, table_count, tags)
  VALUES (
    NULL,
    'Round Tables',
    'Banquet-style layout with round tables seating 8 guests each. Includes stage, DJ booth, bar, and restroom.',
    '{
      "version": 2,
      "template": true,
      "canvas": { "width": 1200, "height": 800 },
      "bgImage": null,
      "elements": [
        { "id": "el-tpl-tables-1", "type": "stage", "x": 350, "y": 20, "w": 400, "h": 60, "rotation": 0, "label": "STAGE", "color": "#d4af37", "cornerRadius": 8, "locked": false },
        { "id": "el-tpl-tables-2", "type": "dj", "x": 520, "y": 100, "w": 80, "h": 80, "rotation": 0, "label": "DJ Booth", "color": "#ec4899", "cornerRadius": 12, "locked": false },
        { "id": "el-tpl-tables-3", "type": "table", "x": 200, "y": 200, "w": 50, "h": 50, "rotation": 0, "label": "T1", "color": "#22c55e", "shape": "circle", "seats": 8, "tier_id": null, "tier_slot": "table-0", "locked": false },
        { "id": "el-tpl-tables-4", "type": "table", "x": 450, "y": 200, "w": 50, "h": 50, "rotation": 0, "label": "T2", "color": "#22c55e", "shape": "circle", "seats": 8, "tier_id": null, "tier_slot": "table-1", "locked": false },
        { "id": "el-tpl-tables-5", "type": "table", "x": 700, "y": 200, "w": 50, "h": 50, "rotation": 0, "label": "T3", "color": "#22c55e", "shape": "circle", "seats": 8, "tier_id": null, "tier_slot": "table-2", "locked": false },
        { "id": "el-tpl-tables-6", "type": "table", "x": 120, "y": 380, "w": 50, "h": 50, "rotation": 0, "label": "T4", "color": "#22c55e", "shape": "circle", "seats": 8, "tier_id": null, "tier_slot": "table-3", "locked": false },
        { "id": "el-tpl-tables-7", "type": "table", "x": 350, "y": 380, "w": 50, "h": 50, "rotation": 0, "label": "T5", "color": "#22c55e", "shape": "circle", "seats": 8, "tier_id": null, "tier_slot": "table-4", "locked": false },
        { "id": "el-tpl-tables-8", "type": "table", "x": 580, "y": 380, "w": 50, "h": 50, "rotation": 0, "label": "T6", "color": "#22c55e", "shape": "circle", "seats": 8, "tier_id": null, "tier_slot": "table-5", "locked": false },
        { "id": "el-tpl-tables-9", "type": "table", "x": 810, "y": 380, "w": 50, "h": 50, "rotation": 0, "label": "T7", "color": "#22c55e", "shape": "circle", "seats": 8, "tier_id": null, "tier_slot": "table-6", "locked": false },
        { "id": "el-tpl-tables-10", "type": "table", "x": 200, "y": 560, "w": 50, "h": 50, "rotation": 0, "label": "T8", "color": "#22c55e", "shape": "circle", "seats": 8, "tier_id": null, "tier_slot": "table-7", "locked": false },
        { "id": "el-tpl-tables-11", "type": "table", "x": 450, "y": 560, "w": 50, "h": 50, "rotation": 0, "label": "T9", "color": "#22c55e", "shape": "circle", "seats": 8, "tier_id": null, "tier_slot": "table-8", "locked": false },
        { "id": "el-tpl-tables-12", "type": "table", "x": 700, "y": 560, "w": 50, "h": 50, "rotation": 0, "label": "T10", "color": "#22c55e", "shape": "circle", "seats": 8, "tier_id": null, "tier_slot": "table-9", "locked": false },
        { "id": "el-tpl-tables-13", "type": "bar", "x": 40, "y": 700, "w": 160, "h": 40, "rotation": 0, "label": "Bar / Drinks", "color": "#8b5cf6", "cornerRadius": 20, "locked": false },
        { "id": "el-tpl-tables-14", "type": "restroom", "x": 900, "y": 700, "w": 80, "h": 80, "rotation": 0, "label": "Restroom", "color": "#6b7280", "cornerRadius": 12, "locked": false },
        { "id": "el-tpl-tables-15", "type": "entrance", "x": 480, "y": 720, "w": 80, "h": 80, "rotation": 0, "label": "Entrance", "color": "#10b981", "cornerRadius": 12, "locked": false }
      ],
      "sections": [],
      "stage": null
    }'::jsonb,
    80, 0, 10,
    ARRAY['tables', 'banquet', 'gala']
  ) ON CONFLICT ON CONSTRAINT venue_templates_name_per_organizer DO NOTHING;

  -- ── 5. Stadium ──
  INSERT INTO venue_templates (organizer_id, name, description, layout_json, total_seats, section_count, table_count, tags)
  VALUES (
    NULL,
    'Stadium',
    'Large stadium layout with four stands surrounding a central pitch. Includes a VIP box section.',
    '{
      "version": 2,
      "template": true,
      "canvas": { "width": 1200, "height": 800 },
      "bgImage": null,
      "elements": [
        { "id": "el-tpl-stadium-1", "type": "stage", "x": 300, "y": 280, "w": 500, "h": 80, "rotation": 0, "label": "PITCH", "color": "#d4af37", "cornerRadius": 8, "locked": false },
        { "id": "el-tpl-stadium-2", "type": "section", "x": 300, "y": 20, "w": 500, "h": 120, "rotation": 0, "label": "North Stand", "color": "#10B981", "rows": 5, "seatsPerRow": 20, "curve": 300, "tier_id": null, "tier_slot": "section-0", "locked": false },
        { "id": "el-tpl-stadium-3", "type": "section", "x": 300, "y": 410, "w": 500, "h": 120, "rotation": 0, "label": "South Stand", "color": "#10B981", "rows": 5, "seatsPerRow": 20, "curve": 300, "tier_id": null, "tier_slot": "section-1", "locked": false },
        { "id": "el-tpl-stadium-4", "type": "section", "x": 30, "y": 80, "w": 180, "h": 400, "rotation": 0, "label": "West Stand", "color": "#10B981", "rows": 10, "seatsPerRow": 6, "curve": 0, "tier_id": null, "tier_slot": "section-2", "locked": false },
        { "id": "el-tpl-stadium-5", "type": "section", "x": 890, "y": 80, "w": 180, "h": 400, "rotation": 0, "label": "East Stand", "color": "#10B981", "rows": 10, "seatsPerRow": 6, "curve": 0, "tier_id": null, "tier_slot": "section-3", "locked": false },
        { "id": "el-tpl-stadium-6", "type": "section", "x": 400, "y": 180, "w": 300, "h": 60, "rotation": 0, "label": "VIP Box", "color": "#10B981", "rows": 2, "seatsPerRow": 14, "curve": 80, "tier_id": null, "tier_slot": "section-4", "locked": false },
        { "id": "el-tpl-stadium-7", "type": "entrance", "x": 50, "y": 580, "w": 80, "h": 80, "rotation": 0, "label": "Entrance", "color": "#10b981", "cornerRadius": 12, "locked": false },
        { "id": "el-tpl-stadium-8", "type": "entrance", "x": 1000, "y": 580, "w": 80, "h": 80, "rotation": 0, "label": "Entrance", "color": "#10b981", "cornerRadius": 12, "locked": false },
        { "id": "el-tpl-stadium-9", "type": "food", "x": 50, "y": 20, "w": 80, "h": 80, "rotation": 0, "label": "Food Court", "color": "#10B981", "cornerRadius": 12, "locked": false },
        { "id": "el-tpl-stadium-10", "type": "restroom", "x": 1000, "y": 20, "w": 80, "h": 80, "rotation": 0, "label": "Restroom", "color": "#6b7280", "cornerRadius": 12, "locked": false }
      ],
      "sections": [],
      "stage": null
    }'::jsonb,
    348, 5, 0,
    ARRAY['stadium', 'sports', '1000+']
  ) ON CONFLICT ON CONSTRAINT venue_templates_name_per_organizer DO NOTHING;

END;
$$;

-- Execute the seeding function
SELECT seed_system_venue_templates();
