-- Phase 0a baseline query.
-- Run after applying supabase/migrations/20260522090000_phase0a_telemetry.sql
-- and collecting at least 5 consecutive days of real usage.

WITH recent_calls AS (
  SELECT *
  FROM public.llm_call_telemetry
  WHERE created_at >= now() - interval '5 days'
),
call_site_rollup AS (
  SELECT
    call_site_name,
    file_path,
    function_name,
    provider,
    model,
    validation_status,
    output_shape_name,
    count(*) AS calls,
    count(*) FILTER (WHERE success) AS successful_calls,
    count(*) FILTER (WHERE NOT success) AS failed_calls,
    sum(input_tokens) AS input_tokens,
    sum(output_tokens) AS output_tokens,
    sum(estimated_cost_usd) AS estimated_cost_usd,
    avg(latency_ms)::integer AS avg_latency_ms,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::integer AS p95_latency_ms
  FROM recent_calls
  GROUP BY
    call_site_name,
    file_path,
    function_name,
    provider,
    model,
    validation_status,
    output_shape_name
),
run_rollup AS (
  SELECT
    coalesce(run_id, user_id::text || ':' || created_at::date::text) AS baseline_run_key,
    user_id,
    min(created_at) AS first_call_at,
    max(created_at) AS last_call_at,
    count(*) AS calls,
    count(*) FILTER (WHERE NOT success) AS failed_calls,
    sum(input_tokens) AS input_tokens,
    sum(output_tokens) AS output_tokens,
    sum(estimated_cost_usd) AS estimated_cost_usd,
    sum(latency_ms) AS total_llm_latency_ms
  FROM recent_calls
  GROUP BY baseline_run_key, user_id
)
SELECT
  'call_site' AS row_type,
  call_site_name AS key,
  file_path,
  function_name,
  provider,
  model,
  validation_status,
  output_shape_name,
  calls,
  successful_calls,
  failed_calls,
  input_tokens,
  output_tokens,
  estimated_cost_usd,
  avg_latency_ms,
  p95_latency_ms,
  NULL::timestamptz AS first_call_at,
  NULL::timestamptz AS last_call_at,
  NULL::bigint AS total_llm_latency_ms
FROM call_site_rollup

UNION ALL

SELECT
  'run' AS row_type,
  baseline_run_key AS key,
  NULL AS file_path,
  NULL AS function_name,
  NULL AS provider,
  NULL AS model,
  NULL AS validation_status,
  NULL AS output_shape_name,
  calls,
  calls - failed_calls AS successful_calls,
  failed_calls,
  input_tokens,
  output_tokens,
  estimated_cost_usd,
  NULL::integer AS avg_latency_ms,
  NULL::integer AS p95_latency_ms,
  first_call_at,
  last_call_at,
  total_llm_latency_ms
FROM run_rollup

ORDER BY row_type, estimated_cost_usd DESC NULLS LAST, calls DESC;
