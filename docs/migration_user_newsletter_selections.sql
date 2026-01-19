-- Migration: Create user_newsletter_selections table
-- Purpose: Store user preferences for which newsletters to include in their feed
-- Run this in Supabase SQL Editor before implementing the newsletter selection UI

CREATE TABLE IF NOT EXISTS user_newsletter_selections (
  user_id uuid NOT NULL,
  sender_key text NOT NULL,
  selected boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, sender_key),
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_newsletter_selections_user 
ON user_newsletter_selections(user_id);

-- Add comment for documentation
COMMENT ON TABLE user_newsletter_selections IS 'Stores user preferences for which newsletters to include in their feed. Separate from classification results (digest_candidates).';
