-- Phase 0c: durable onboarding state machine.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.runes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL DEFAULT 'Daily Rune',
  status text NOT NULL DEFAULT 'onboarding',
  is_alpha_primary boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT runes_status_check CHECK (status IN ('onboarding', 'active', 'paused', 'archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS runes_alpha_primary_user_idx
  ON public.runes (user_id)
  WHERE is_alpha_primary = true;

CREATE INDEX IF NOT EXISTS runes_user_status_idx
  ON public.runes (user_id, status);

CREATE TABLE IF NOT EXISTS public.onboarding_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  rune_id uuid NOT NULL REFERENCES public.runes(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'conversation',
  version integer NOT NULL DEFAULT 1,
  minimum_intent_gate jsonb NOT NULL DEFAULT '{"passed":false,"missing_fields":["slot_type","meaningful_focus","delivery_preference","inbox_preference"]}'::jsonb,
  structured_intent jsonb,
  inbox_preference text NOT NULL DEFAULT 'unknown',
  gmail_status text NOT NULL DEFAULT 'unknown',
  current_recommendation_version_id uuid,
  config_version integer NOT NULL DEFAULT 0,
  failure jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_sessions_state_check CHECK (state IN (
    'conversation',
    'intent_ready',
    'gmail_needed',
    'scanning',
    'scan_complete',
    'recommendation_generating',
    'recommendation_ready',
    'refining',
    'approved',
    'complete',
    'failed'
  )),
  CONSTRAINT onboarding_sessions_inbox_preference_check CHECK (inbox_preference IN ('wanted', 'not_wanted', 'skipped', 'unknown')),
  CONSTRAINT onboarding_sessions_gmail_status_check CHECK (gmail_status IN ('unknown', 'connected', 'disconnected', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS onboarding_sessions_rune_idx
  ON public.onboarding_sessions (rune_id);

CREATE INDEX IF NOT EXISTS onboarding_sessions_user_state_idx
  ON public.onboarding_sessions (user_id, state);

CREATE TABLE IF NOT EXISTS public.onboarding_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  rune_id uuid NOT NULL REFERENCES public.runes(id) ON DELETE CASCADE,
  onboarding_session_id uuid NOT NULL REFERENCES public.onboarding_sessions(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_messages_role_check CHECK (role IN ('user', 'rune', 'system'))
);

CREATE INDEX IF NOT EXISTS onboarding_messages_session_created_idx
  ON public.onboarding_messages (onboarding_session_id, created_at);

CREATE TABLE IF NOT EXISTS public.onboarding_scan_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  rune_id uuid NOT NULL REFERENCES public.runes(id) ON DELETE CASCADE,
  onboarding_session_id uuid NOT NULL REFERENCES public.onboarding_sessions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'not_started',
  provider text NOT NULL DEFAULT 'gmail',
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  sender_count integer NOT NULL DEFAULT 0,
  candidate_count integer NOT NULL DEFAULT 0,
  selected_count integer NOT NULL DEFAULT 0,
  failure jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_scan_artifacts_status_check CHECK (status IN ('not_started', 'running', 'complete', 'empty', 'failed'))
);

CREATE INDEX IF NOT EXISTS onboarding_scan_artifacts_session_created_idx
  ON public.onboarding_scan_artifacts (onboarding_session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.onboarding_recommendation_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  rune_id uuid NOT NULL REFERENCES public.runes(id) ON DELETE CASCADE,
  onboarding_session_id uuid NOT NULL REFERENCES public.onboarding_sessions(id) ON DELETE CASCADE,
  config_version integer NOT NULL,
  cards jsonb NOT NULL DEFAULT '[]'::jsonb,
  user_facing_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_recommendation jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS onboarding_recommendation_versions_session_config_idx
  ON public.onboarding_recommendation_versions (onboarding_session_id, config_version);

CREATE TABLE IF NOT EXISTS public.onboarding_state_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  rune_id uuid NOT NULL REFERENCES public.runes(id) ON DELETE CASCADE,
  onboarding_session_id uuid NOT NULL REFERENCES public.onboarding_sessions(id) ON DELETE CASCADE,
  previous_state text,
  next_state text NOT NULL,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS onboarding_state_transitions_session_created_idx
  ON public.onboarding_state_transitions (onboarding_session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.onboarding_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name text NOT NULL,
  user_id uuid NOT NULL,
  rune_id uuid NOT NULL REFERENCES public.runes(id) ON DELETE CASCADE,
  onboarding_session_id uuid NOT NULL REFERENCES public.onboarding_sessions(id) ON DELETE CASCADE,
  state text NOT NULL,
  previous_state text,
  source text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_events_source_check CHECK (source IN ('client', 'server'))
);

CREATE INDEX IF NOT EXISTS onboarding_events_session_created_idx
  ON public.onboarding_events (onboarding_session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS onboarding_events_name_created_idx
  ON public.onboarding_events (event_name, created_at DESC);

ALTER TABLE public.runes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_scan_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_recommendation_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_state_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.runes FROM anon, authenticated;
REVOKE ALL ON public.onboarding_sessions FROM anon, authenticated;
REVOKE ALL ON public.onboarding_messages FROM anon, authenticated;
REVOKE ALL ON public.onboarding_scan_artifacts FROM anon, authenticated;
REVOKE ALL ON public.onboarding_recommendation_versions FROM anon, authenticated;
REVOKE ALL ON public.onboarding_state_transitions FROM anon, authenticated;
REVOKE ALL ON public.onboarding_events FROM anon, authenticated;

GRANT ALL ON public.runes TO service_role;
GRANT ALL ON public.onboarding_sessions TO service_role;
GRANT ALL ON public.onboarding_messages TO service_role;
GRANT ALL ON public.onboarding_scan_artifacts TO service_role;
GRANT ALL ON public.onboarding_recommendation_versions TO service_role;
GRANT ALL ON public.onboarding_state_transitions TO service_role;
GRANT ALL ON public.onboarding_events TO service_role;

COMMENT ON TABLE public.runes IS
  'Phase 0c Rune shell. Alpha keeps one primary Rune per user while preserving a rune_id boundary.';

COMMENT ON TABLE public.onboarding_sessions IS
  'Server-owned onboarding state machine. Frontend renders snapshots from this state.';

COMMENT ON TABLE public.onboarding_recommendation_versions IS
  'Immutable typed recommendation snapshots. config_version increments on accepted edits, patches, and regenerations.';
