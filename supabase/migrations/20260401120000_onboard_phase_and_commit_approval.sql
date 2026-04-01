-- Server-driven onboarding chat phase + atomic approve (all DB writes in one transaction).

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS onboard_chat_phase text NOT NULL DEFAULT 'conversation';

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_onboard_chat_phase_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_onboard_chat_phase_check
  CHECK (onboard_chat_phase IN ('conversation', 'recommendation', 'complete'));

COMMENT ON COLUMN public.user_profiles.onboard_chat_phase IS
  'Chat API prompt phase: conversation | recommendation | complete. Server is source of truth.';

CREATE OR REPLACE FUNCTION public.commit_onboard_approval(
  p_user_id uuid,
  p_now timestamptz,
  p_approved_config jsonb,
  p_digest jsonb,
  p_news_topics jsonb,
  p_lesson_topics jsonb,
  p_newsletter_senders text[],
  p_inbox_priority_addresses text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row_count int;
  v_cadence text;
  v_timezone text;
  v_style text;
  v_send_times time[];
  v_module_flags jsonb;
  r_news record;
  r_lesson record;
  v_news_ids jsonb := '[]'::jsonb;
  v_lesson_ids jsonb := '[]'::jsonb;
  v_new_id uuid;
  v_senders text[];
  v_inbox text[];
BEGIN
  -- 1) Profile: finalize onboarding
  UPDATE public.user_profiles
  SET
    approved_config = p_approved_config,
    onboarding_status = 'complete',
    onboarding_completed_at = p_now,
    onboard_chat_phase = 'complete',
    updated_at = p_now
  WHERE user_id = p_user_id;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'user_profiles row not found for user %', p_user_id;
  END IF;

  -- 2) Digest config
  v_cadence := COALESCE(p_digest->>'cadence', 'daily');
  v_timezone := COALESCE(p_digest->>'timezone', 'America/New_York');
  v_style := COALESCE(p_digest->>'style', 'morning-brief');
  v_module_flags := COALESCE(p_digest->'module_flags', '{}'::jsonb);

  v_send_times := COALESCE(
    ARRAY(
      SELECT (elem #>> '{}')::time
      FROM jsonb_array_elements(COALESCE(p_digest->'send_time', '["07:00"]'::jsonb)) AS e(elem)
    ),
    ARRAY['07:00'::time]
  );
  IF v_send_times IS NULL THEN
    v_send_times := ARRAY['07:00'::time];
  END IF;

  INSERT INTO public.digest_configs (
    user_id,
    cadence,
    send_time,
    timezone,
    style,
    rune_name,
    module_flags,
    updated_at
  )
  VALUES (
    p_user_id,
    v_cadence,
    v_send_times,
    v_timezone,
    v_style,
    NULL,
    v_module_flags,
    p_now
  )
  ON CONFLICT (user_id)
  DO UPDATE SET
    cadence = EXCLUDED.cadence,
    send_time = EXCLUDED.send_time,
    timezone = EXCLUDED.timezone,
    style = EXCLUDED.style,
    module_flags = EXCLUDED.module_flags,
    updated_at = EXCLUDED.updated_at;

  -- 3) Replace news topics
  UPDATE public.user_news_topics
  SET active = false, updated_at = p_now
  WHERE user_id = p_user_id AND active = true;

  FOR r_news IN
    SELECT j.elem AS el
    FROM jsonb_array_elements(COALESCE(p_news_topics, '[]'::jsonb)) AS j(elem)
  LOOP
    INSERT INTO public.user_news_topics (
      user_id,
      topic_text,
      topic_raw_text,
      timeframe,
      topic_mapping_json,
      active,
      updated_at
    )
    VALUES (
      p_user_id,
      r_news.el->>'topic_text',
      r_news.el->>'topic_raw_text',
      COALESCE(r_news.el->>'timeframe', '24h'),
      COALESCE(r_news.el->'topic_mapping_json', '{}'::jsonb),
      true,
      p_now
    )
    RETURNING id INTO v_new_id;

    v_news_ids := v_news_ids || jsonb_build_array(v_new_id);
  END LOOP;

  -- 4) Replace lesson topics
  UPDATE public.user_lesson_topics
  SET active = false, updated_at = p_now
  WHERE user_id = p_user_id AND active = true;

  FOR r_lesson IN
    SELECT j.elem AS el
    FROM jsonb_array_elements(COALESCE(p_lesson_topics, '[]'::jsonb)) AS j(elem)
  LOOP
    INSERT INTO public.user_lesson_topics (
      user_id,
      topic_text,
      topic_raw_text,
      curriculum_goal,
      starting_level,
      topic_mapping_json,
      active,
      updated_at
    )
    VALUES (
      p_user_id,
      r_lesson.el->>'topic_text',
      r_lesson.el->>'topic_raw_text',
      NULLIF(r_lesson.el->>'curriculum_goal', ''),
      COALESCE(r_lesson.el->>'starting_level', 'beginner'),
      COALESCE(r_lesson.el->'topic_mapping_json', '{}'::jsonb),
      true,
      p_now
    )
    RETURNING id INTO v_new_id;

    v_lesson_ids := v_lesson_ids || jsonb_build_array(v_new_id);
  END LOOP;

  -- 5) Newsletter selections + inbox disposition
  v_senders := COALESCE(p_newsletter_senders, ARRAY[]::text[]);
  v_inbox := COALESCE(p_inbox_priority_addresses, ARRAY[]::text[]);

  IF cardinality(v_senders) > 0 THEN
    INSERT INTO public.user_newsletter_selections (user_id, sender_key, selected, updated_at)
    SELECT p_user_id, unnest(v_senders), true, p_now
    ON CONFLICT (user_id, sender_key)
    DO UPDATE SET
      selected = true,
      updated_at = EXCLUDED.updated_at;
  END IF;

  IF cardinality(v_inbox) > 0 THEN
    UPDATE public.inbox_analysis
    SET disposition = 'priority'
    WHERE user_id = p_user_id
      AND sender_address = ANY (v_inbox);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'news_topic_ids', v_news_ids,
    'lesson_topic_ids', v_lesson_ids,
    'newsletter_selection_count', COALESCE(cardinality(v_senders), 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commit_onboard_approval(
  uuid, timestamptz, jsonb, jsonb, jsonb, jsonb, text[], text[]
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.commit_onboard_approval(
  uuid, timestamptz, jsonb, jsonb, jsonb, jsonb, text[], text[]
) TO service_role;
