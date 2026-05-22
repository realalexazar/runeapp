-- Phase 0a: runtime telemetry for every LLM and paid/quota-sensitive API call site.
-- This table is append-only measurement infrastructure; it does not change product behavior.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.llm_call_telemetry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),

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
  provider_request_id text,

  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric(12, 8),
  latency_ms integer NOT NULL,

  success boolean NOT NULL,
  error_message text,

  validation_status text NOT NULL DEFAULT 'none'
    CHECK (validation_status IN ('none', 'regex', 'schema', 'manual')),
  output_shape_name text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS llm_call_telemetry_created_at_idx
  ON public.llm_call_telemetry (created_at DESC);

CREATE INDEX IF NOT EXISTS llm_call_telemetry_user_created_idx
  ON public.llm_call_telemetry (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS llm_call_telemetry_call_site_created_idx
  ON public.llm_call_telemetry (call_site_name, created_at DESC);

CREATE INDEX IF NOT EXISTS llm_call_telemetry_run_id_idx
  ON public.llm_call_telemetry (run_id)
  WHERE run_id IS NOT NULL;

ALTER TABLE public.llm_call_telemetry ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.llm_call_telemetry FROM anon, authenticated;
GRANT ALL ON public.llm_call_telemetry TO service_role;

COMMENT ON TABLE public.llm_call_telemetry IS
  'Phase 0a append-only cost, latency, success, and validation telemetry for LLM calls.';

COMMENT ON COLUMN public.llm_call_telemetry.validation_status IS
  'Static output contract status at the call site: none | regex | schema | manual.';

CREATE TABLE IF NOT EXISTS public.external_api_call_telemetry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),

  run_id text,
  user_id uuid,
  rune_id uuid,
  slot_id uuid,
  slot_run_id uuid,

  call_site_name text NOT NULL,
  file_path text NOT NULL,
  function_name text NOT NULL,

  provider text NOT NULL CHECK (provider IN ('tavily', 'google_news', 'gmail', 'google_oauth', 'web_fetch')),
  endpoint text NOT NULL,
  request_units numeric(12, 2) NOT NULL DEFAULT 1,
  estimated_cost_usd numeric(12, 8),
  latency_ms integer NOT NULL,
  success boolean NOT NULL,
  status_code integer,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS external_api_call_telemetry_created_at_idx
  ON public.external_api_call_telemetry (created_at DESC);

CREATE INDEX IF NOT EXISTS external_api_call_telemetry_user_created_idx
  ON public.external_api_call_telemetry (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS external_api_call_telemetry_provider_created_idx
  ON public.external_api_call_telemetry (provider, created_at DESC);

CREATE INDEX IF NOT EXISTS external_api_call_telemetry_run_id_idx
  ON public.external_api_call_telemetry (run_id)
  WHERE run_id IS NOT NULL;

ALTER TABLE public.external_api_call_telemetry ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.external_api_call_telemetry FROM anon, authenticated;
GRANT ALL ON public.external_api_call_telemetry TO service_role;

COMMENT ON TABLE public.external_api_call_telemetry IS
  'Phase 0a append-only latency, success, and cost telemetry for paid or quota-sensitive non-LLM API calls.';
