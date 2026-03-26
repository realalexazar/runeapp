-- Add module_flags JSONB column to digest_configs
-- Stores which suite modules are enabled per user

ALTER TABLE digest_configs
ADD COLUMN IF NOT EXISTS module_flags jsonb NOT NULL
DEFAULT '{"enable_newsletter_digest": true, "enable_daily_news_topics": false, "enable_daily_lessons": false}'::jsonb;

COMMENT ON COLUMN digest_configs.module_flags IS
'Per-user module enablement flags. Keys: enable_newsletter_digest, enable_daily_news_topics, enable_daily_lessons.';

