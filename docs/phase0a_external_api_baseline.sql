-- Phase 0a external API baseline query.
-- Run after applying supabase/migrations/20260522090000_phase0a_telemetry.sql
-- and collecting real Tavily/search usage.

SELECT
  call_site_name,
  file_path,
  function_name,
  provider,
  endpoint,
  count(*) AS calls,
  count(*) FILTER (WHERE success) AS successful_calls,
  count(*) FILTER (WHERE NOT success) AS failed_calls,
  sum(request_units) AS request_units,
  sum(estimated_cost_usd) AS estimated_cost_usd,
  avg(latency_ms)::integer AS avg_latency_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::integer AS p95_latency_ms,
  sum((metadata->>'result_count')::integer) FILTER (WHERE metadata ? 'result_count') AS result_count
FROM public.external_api_call_telemetry
WHERE created_at >= now() - interval '5 days'
GROUP BY
  call_site_name,
  file_path,
  function_name,
  provider,
  endpoint
ORDER BY calls DESC, estimated_cost_usd DESC NULLS LAST;
