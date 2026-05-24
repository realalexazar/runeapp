-- Phase 0a run-health query.
-- Joins generated module runs to LLM and external API telemetry.

WITH runs AS (
  SELECT
    id::text AS run_id,
    user_id,
    module,
    status,
    started_at,
    finished_at,
    error,
    EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000 AS run_duration_ms
  FROM public.generated_content_runs
  WHERE started_at >= now() - interval '5 days'
),
llm AS (
  SELECT
    run_id,
    count(*) AS llm_calls,
    count(*) FILTER (WHERE NOT success) AS llm_failed_calls,
    sum(input_tokens) AS llm_input_tokens,
    sum(output_tokens) AS llm_output_tokens,
    sum(estimated_cost_usd) AS llm_estimated_cost_usd,
    sum(latency_ms) AS llm_latency_ms
  FROM public.llm_call_telemetry
  WHERE created_at >= now() - interval '5 days'
  GROUP BY run_id
),
external_api AS (
  SELECT
    run_id,
    count(*) AS external_api_calls,
    count(*) FILTER (WHERE NOT success) AS external_api_failed_calls,
    sum(request_units) AS external_api_request_units,
    sum(estimated_cost_usd) AS external_api_estimated_cost_usd,
    sum(latency_ms) AS external_api_latency_ms
  FROM public.external_api_call_telemetry
  WHERE created_at >= now() - interval '5 days'
  GROUP BY run_id
)
SELECT
  r.run_id,
  r.user_id,
  r.module,
  r.status,
  r.started_at,
  r.finished_at,
  r.run_duration_ms::integer AS run_duration_ms,
  coalesce(llm.llm_calls, 0) AS llm_calls,
  coalesce(llm.llm_failed_calls, 0) AS llm_failed_calls,
  coalesce(llm.llm_input_tokens, 0) AS llm_input_tokens,
  coalesce(llm.llm_output_tokens, 0) AS llm_output_tokens,
  coalesce(llm.llm_estimated_cost_usd, 0) AS llm_estimated_cost_usd,
  coalesce(llm.llm_latency_ms, 0) AS llm_latency_ms,
  coalesce(external_api.external_api_calls, 0) AS external_api_calls,
  coalesce(external_api.external_api_failed_calls, 0) AS external_api_failed_calls,
  coalesce(external_api.external_api_request_units, 0) AS external_api_request_units,
  coalesce(external_api.external_api_estimated_cost_usd, 0) AS external_api_estimated_cost_usd,
  coalesce(external_api.external_api_latency_ms, 0) AS external_api_latency_ms,
  r.error
FROM runs r
LEFT JOIN llm ON llm.run_id = r.run_id
LEFT JOIN external_api ON external_api.run_id = r.run_id
ORDER BY r.started_at DESC;
