"use client"

import { useCallback, useMemo, useState } from "react"

type Json = Record<string, unknown>

export default function BackfillParseControls() {
  const [backfillLoading, setBackfillLoading] = useState(false)
  const [backfillResult, setBackfillResult] = useState<Json | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)

  const [classifyLoading, setClassifyLoading] = useState(false)
  const [classifyResult, setClassifyResult] = useState<Json | null>(null)
  const [totals, setTotals] = useState<{ raw: number, clean: number, newsletters: number, remaining: number } | null>(null)
  const [rawDelta, setRawDelta] = useState<number | null>(null)

  const backfillSummary = useMemo(() => {
    if (!backfillResult) return ""
    const r = backfillResult as any
    const timeStr = r.time_ms ? ` • time: ${r.time_ms}ms` : ""
    const core = `scanned: ${r.messages_scanned ?? 0}, inserted: ${r.inserted ?? 0}, failed: ${r.failed ?? 0}`
    const fetchFailed = r.fetch_failed ? ` (fetch: ${r.fetch_failed})` : ""
    const upsertFailed = r.upsert_failed ? ` (upsert: ${r.upsert_failed})` : ""
    const q = r.query ? ` • query: ${r.query}` : ""
    return core + fetchFailed + upsertFailed + timeStr + q
  }, [backfillResult])

  const classifySummary = useMemo(() => {
    if (!classifyResult) return ""
    const r = classifyResult as any
    return `classified: ${r.senders_classified ?? 0} senders • positive: ${r.positive ?? 0} • grey: ${r.grey ?? 0} • low: ${r.low ?? 0} • time: ${r.time_ms ?? 0}ms`
  }, [classifyResult])

  const runBackfill = useCallback(async () => {
    setBackfillLoading(true)
    try {
      // get raw before to compute a true delta
      let rawBefore: number | null = null
      try {
        const t = await fetch("/api/parse/progress", { credentials: "include", cache: "no-store" }).then(r => r.json())
        if (t && t.ok && typeof t.raw === "number") rawBefore = t.raw
      } catch {}

      const res = await fetch("/api/backfill/start", { method: "POST", credentials: "include" })
      if (res.status >= 400) {
        let msg = `Error ${res.status}`
        try {
          const j = await res.json()
          if (j?.auth_error) msg = j.auth_error
          else if (j?.error) msg = j.error
          setBackfillResult(j)
        } catch {
          setBackfillResult({ ok: false, error: msg })
        }
        // Mark auth-related problems so we can show reconnect banner
        if (msg === "invalid_grant" || /No connected Google account/i.test(msg) || res.status === 401) {
          setAuthError(msg)
        }
        return
      }
      const json = await res.json()
      setBackfillResult(json)
      setAuthError(null)

      // compute raw delta and refresh totals
      try {
        const t = await fetch("/api/parse/progress", { credentials: "include", cache: "no-store" }).then(r => r.json())
        if (t && t.ok && typeof t.raw === "number") {
          setTotals(t)
          if (rawBefore !== null) setRawDelta(t.raw - rawBefore)
        }
      } catch {}
    } catch (e) {
      setBackfillResult({ ok: false, error: String(e) })
    } finally {
      setBackfillLoading(false)
    }
  }, [])

  const runClassifySenders = useCallback(async () => {
    setClassifyLoading(true)
    try {
      const res = await fetch("/api/onboard/classify-senders", {
        method: "POST",
        credentials: "include"
      })
      if (res.status >= 400) {
        let msg = `Error ${res.status}`
        try {
          const j = await res.json()
          msg = j.error || msg
          setClassifyResult(j)
        } catch {
          setClassifyResult({ ok: false, error: msg })
        }
        return
      }
      const json = await res.json()
      setClassifyResult(json)
      
      // Refresh totals after classification
      try {
        const t = await fetch("/api/parse/progress", { credentials: "include", cache: "no-store" }).then(r => r.json())
        if (t && t.ok) setTotals(t)
      } catch {}
    } catch (e) {
      setClassifyResult({ ok: false, error: String(e) })
    } finally {
      setClassifyLoading(false)
    }
  }, [])

  // live progress polling while backfillLoading is true
  const [progressCount, setProgressCount] = useState<number | null>(null)
  const pollProgress = useCallback(async () => {
    try {
      const res = await fetch("/api/backfill/progress", { cache: "no-store", credentials: "include" })
      const json = await res.json()
      if (typeof json.count === "number") setProgressCount(json.count)
    } catch {}
  }, [])

  // naive interval polling
  if (backfillLoading) {
    // fire-and-forget; React 18 double render safe since it's idempotent enough for UX
    // we don't keep a handle; polling is lightweight
    pollProgress()
    setTimeout(pollProgress, 1000)
    setTimeout(pollProgress, 2500)
    setTimeout(pollProgress, 5000)
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white space-y-6">
      <div className="space-y-2">
        <div className="text-lg font-medium">Backfill (Primary + Updates)</div>
        <div className="text-white/60 text-sm">First run: ~14 days (2 weeks). Subsequent runs: ~2 days overlap. Safe to re-run.</div>
        {authError && (
          <div className="rounded-md bg-red-500/15 px-3 py-2 text-sm text-red-300">Reconnect required ({authError}). Use the Reconnect button above.</div>
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={runBackfill}
            disabled={backfillLoading || !!authError}
            className="rounded-md bg-white/15 px-4 py-2 hover:bg-white/25 disabled:opacity-50"
          >{backfillLoading ? "Running…" : "Start Backfill"}</button>
          {backfillResult && (
            <span className="text-white/70 text-sm">{backfillSummary}{rawDelta !== null ? ` • raw Δ: ${rawDelta}` : ""}</span>
          )}
          {backfillLoading && (
            <span className="text-white/60 text-sm">{progressCount === null ? "scanning…" : `scanned so far: ${progressCount}`}</span>
          )}
        </div>
      </div>

      <div className="h-px w-full bg-white/10" />

      <div className="space-y-3">
        <div className="text-lg font-medium">Classify Senders (LLM-based)</div>
        <div className="text-white/60 text-sm">Classifies senders from last 14 days using subject lines. Groups by domain, applies hard rules, then LLM classification.</div>
        <div className="flex items-center gap-3">
          <button
            onClick={runClassifySenders}
            disabled={classifyLoading}
            className="rounded-md bg-white/15 px-4 py-2 hover:bg-white/25 disabled:opacity-50"
          >{classifyLoading ? "Classifying…" : "Classify Senders"}</button>
          {classifyResult && (
            <span className="text-white/70 text-sm">{classifySummary}</span>
          )}
        </div>
        {classifyResult && (classifyResult as any).ok === false && (
          <div className="rounded-md bg-red-500/15 px-3 py-2 text-sm text-red-300">
            {(classifyResult as any).error || "Classification failed"}
          </div>
        )}
        {totals && (
          <div className="text-white/70 text-sm">
            raw: {totals.raw} • cleaned: {totals.clean} • newsletters: {totals.newsletters}
          </div>
        )}
      </div>
    </div>
  )
}


