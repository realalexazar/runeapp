-- Phase 0b: raw-output capture for LLM schema validation failures.
-- Service-role only. Raw output is retained temporarily for prompt/schema debugging.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.llm_validation_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),

  run_id text,
  user_id uuid,
  rune_id uuid,
  slot_id uuid,
  slot_run_id uuid,

  call_site_name text NOT NULL,
  file_path text NOT NULL,
  function_name text NOT NULL,

  provider text NOT NULL CHECK (provider IN ('anthropic', 'openai', 'openrouter')),
  model text NOT NULL,
  output_shape_name text NOT NULL,

  raw_output text NOT NULL,
  validation_error jsonb NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS llm_validation_failures_created_at_idx
  ON public.llm_validation_failures (created_at DESC);

CREATE INDEX IF NOT EXISTS llm_validation_failures_expires_at_idx
  ON public.llm_validation_failures (expires_at);

CREATE INDEX IF NOT EXISTS llm_validation_failures_call_site_created_idx
  ON public.llm_validation_failures (call_site_name, created_at DESC);

CREATE INDEX IF NOT EXISTS llm_validation_failures_run_id_idx
  ON public.llm_validation_failures (run_id)
  WHERE run_id IS NOT NULL;

ALTER TABLE public.llm_validation_failures ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.llm_validation_failures FROM anon, authenticated;
GRANT ALL ON public.llm_validation_failures TO service_role;

COMMENT ON TABLE public.llm_validation_failures IS
  'Phase 0b temporary raw-output capture for failed LLM schema validations. Service-role only; default retention is 30 days.';
