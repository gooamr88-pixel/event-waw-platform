-- ═══════════════════════════════════
-- EVENT WAW — Google OAuth Profile Sync
-- Ensures Google sign-in users get a profile row
-- ═══════════════════════════════════

-- The existing trigger (on_auth_user_created -> handle_new_user)
-- already fires for Google OAuth users. However, Google OAuth
-- provides metadata in a different shape:
--   raw_user_meta_data = {
--     "full_name": "John Doe",
--     "avatar_url": "https://lh3.googleusercontent.com/...",
--     "email": "john@gmail.com",
--     "iss": "https://accounts.google.com",
--     "provider_id": "..."
--   }

-- Update the trigger to handle both email signup and Google OAuth:
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, phone, role, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      ''
    ),
    COALESCE(NEW.raw_user_meta_data->>'phone', NULL),
    COALESCE(NEW.raw_user_meta_data->>'role', 'attendee')::user_role,
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NULL)
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url),
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════
-- Storage bucket for event cover images
-- Run this in your Supabase SQL editor
-- ═══════════════════════════════════
INSERT INTO storage.buckets (id, name, public)
VALUES ('event-covers', 'event-covers', true)
ON CONFLICT (id) DO NOTHING;

-- Allow organizers to upload files to event-covers bucket
CREATE POLICY "Organizers can upload event covers"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'event-covers'
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'organizer'
    )
  );

-- Allow anyone to view event cover images (public bucket)
CREATE POLICY "Public can view event covers"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'event-covers');

-- Allow organizers to update their own covers
CREATE POLICY "Organizers can update their event covers"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'event-covers'
    AND auth.uid() IS NOT NULL
  );

-- Allow organizers to delete their own covers
CREATE POLICY "Organizers can delete their event covers"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'event-covers'
    AND auth.uid() IS NOT NULL
  );
