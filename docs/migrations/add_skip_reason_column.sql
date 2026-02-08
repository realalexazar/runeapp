-- Add skip_reason column to digest_items table
-- This stores the reason why an email was skipped from LLM processing
-- Values: 'EMPTY', 'SPARSE', 'VISUAL_ONLY', 'LINK_ONLY' (nullable)

ALTER TABLE digest_items
ADD COLUMN IF NOT EXISTS skip_reason text;

-- Add comment
COMMENT ON COLUMN digest_items.skip_reason IS 'Reason why email was skipped from LLM processing. Values: EMPTY (no content extracted), SPARSE (content too short), VISUAL_ONLY (image-heavy email), LINK_ONLY (mostly links). NULL means email was processed normally.';

-- Add index for filtering
CREATE INDEX IF NOT EXISTS idx_digest_items_skip_reason ON digest_items(skip_reason) WHERE skip_reason IS NOT NULL;
