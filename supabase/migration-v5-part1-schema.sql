-- EVENT WAW v5 — Part 1: Schema Changes
-- Run this FIRST, then run Part 2 (functions), then Part 3 (RLS + RPCs)

-- 1. Guest tokens table
CREATE TABLE IF NOT EXISTS guest_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '90 days'),
  used_count INT DEFAULT 0,
  max_uses INT DEFAULT 50,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_guest_tokens_hash ON guest_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_guest_tokens_order ON guest_tokens(order_id);
ALTER TABLE guest_tokens ENABLE ROW LEVEL SECURITY;

-- 2. Make user_id NULLABLE + add guest columns on orders
ALTER TABLE orders ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_guest BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_email TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_phone TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_national_id TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_guest_email ON orders(guest_email) WHERE is_guest = true;

-- 3. Make user_id NULLABLE on tickets
ALTER TABLE tickets ALTER COLUMN user_id DROP NOT NULL;

-- 4. Make user_id NULLABLE on reservations
ALTER TABLE reservations ALTER COLUMN user_id DROP NOT NULL;

-- 5. Grants
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
