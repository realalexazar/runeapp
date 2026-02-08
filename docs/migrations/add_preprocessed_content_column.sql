-- Add preprocessed_content column to digest_items table
-- This stores the exact content sent to LLM (post HTML conversion, boilerplate stripping, truncation)
-- Useful for testing and debugging

ALTER TABLE digest_items 
ADD COLUMN IF NOT EXISTS preprocessed_content text;

-- Add comment
COMMENT ON COLUMN digest_items.preprocessed_content IS 'Exact content sent to LLM after HTML conversion, boilerplate stripping, and truncation. Stored for testing/debugging purposes.';
