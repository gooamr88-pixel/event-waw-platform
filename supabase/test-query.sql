-- Check and add missing columns to tickets table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tickets' AND column_name = 'attendee_name'
    ) THEN
        ALTER TABLE tickets ADD COLUMN attendee_name TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tickets' AND column_name = 'attendee_email'
    ) THEN
        ALTER TABLE tickets ADD COLUMN attendee_email TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tickets' AND column_name = 'attendee_phone'
    ) THEN
        ALTER TABLE tickets ADD COLUMN attendee_phone TEXT;
    END IF;
END $$;

-- Verify
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'tickets' 
  AND column_name IN ('attendee_name', 'attendee_email', 'attendee_phone');
