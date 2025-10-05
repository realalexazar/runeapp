"use client"

import { useCallback, useMemo, useState } from "react"

type Json = Record<string, unknown>

export default function BackfillParseControls() {
  const [backfillLoading, setBackfillLoading] = useState(false)
  const [backfillResult, setBackfillResult] = useState<Json | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)

  const [parseLimit, setParseLimit] = useState<number>(300)
  const [parseLoading, setParseLoading] = useState(false)
  const [parseResult, setParseResult] = useState<Json | null>(null)
  const [parsedTotal, setParsedTotal] = useState(0)
  const [totals, setTotals] = useState<{ raw: number, clean: number, newsletters: number, remaining: number } | null>(null)
  const [rawDelta, setRawDelta] = useState<number | null>(null)

  const backfillSummary = useMemo(() => {
    if (!backfillResult) return ""
    const r = backfillResult as any
    const core = `scanned: ${r.messages_scanned ?? 0}, uploaded: ${r.uploaded ?? 0}, inserted: ${r.inserted ?? 0}, failed: ${r.failed ?? 0}`
    const q = r.query ? ` • query: ${r.query}` : ""
    return core + q
  }, [backfillResult])

  const parseSummary = useMemo(() => {
    if (!parseResult) return ""
    const r = parseResult as any
    const errs = Array.isArray(r.errors) ? r.errors.length : 0
    return `parsed: ${r.parsed ?? 0} (this run), errors: ${errs}, total this session: ${parsedTotal}`
  }, [parseResult, parsedTotal])

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

  const runParseOnce = useCallback(async () => {
    setParseLoading(true)
    try {
      // update totals before
      try {
        const t = await fetch("/api/parse/progress", { credentials: "include", cache: "no-store" }).then(r => r.json())
        if (t && t.ok) setTotals(t)
      } catch {}
      const res = await fetch("/api/parse/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ limit: parseLimit })
      })
      const json = await res.json()
      setParseResult(json)
      if (typeof json.parsed === "number") {
        setParsedTotal((t) => t + json.parsed)
      }
      // update totals after
      try {
        const t = await fetch("/api/parse/progress", { credentials: "include", cache: "no-store" }).then(r => r.json())
        if (t && t.ok) setTotals(t)
      } catch {}
    } catch (e) {
      setParseResult({ ok: false, error: String(e) })
    } finally {
      setParseLoading(false)
    }
  }, [parseLimit])

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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

  const runParseUntilDone = useCallback(async () => {
    setParsedTotal(0)
    setParseResult(null)
    setParseLoading(true)
    try {
      // initial totals
      try {
        const t = await fetch("/api/parse/progress", { credentials: "include", cache: "no-store" }).then(r => r.json())
        if (t && t.ok) setTotals(t)
      } catch {}
      // loop until parsed == 0
      // add a small delay to avoid hammering
      // bail on unexpected network errors
      // respect current parseLimit
      for (let i = 0; i < 1000; i++) {
        const res = await fetch("/api/parse/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ limit: parseLimit })
        })
        if (res.status === 401) {
          setParseResult({ ok: false, error: "Unauthorized. Refresh the page and sign in again." })
          break
        }
        const json = await res.json()
        setParseResult(json)
        if (typeof json.parsed === "number") {
          setParsedTotal((t) => t + json.parsed)
          if (json.parsed === 0) break
        } else {
          break
        }
        try {
          const t = await fetch("/api/parse/progress", { credentials: "include", cache: "no-store" }).then(r => r.json())
          if (t && t.ok) setTotals(t)
        } catch {}
        await sleep(250)
      }
    } catch (e) {
      setParseResult({ ok: false, error: String(e) })
    } finally {
      setParseLoading(false)
    }
  }, [parseLimit])

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white space-y-6">
      <div className="space-y-2">
        <div className="text-lg font-medium">Backfill (Primary + Updates)</div>
        <div className="text-white/60 text-sm">First run: ~30 days. Subsequent runs: ~2 days overlap. Safe to re-run.</div>
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
        <div className="text-lg font-medium">Parse Unprocessed (clean + classify)</div>
        <div className="text-white/60 text-sm">Parses only emails without a cleaned record; idempotent. If remaining = 0, you're all caught up.</div>
        <div className="flex items-center gap-3">
          <label className="text-white/70 text-sm">
            Limit
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={500}
              value={parseLimit}
              onChange={(e) => setParseLimit(Math.max(1, Math.min(500, Number(e.target.value) || 0)))}
              className="ml-2 w-24 rounded-md border border-white/15 bg-transparent px-2 py-1 text-white/90 outline-none"
            />
          </label>
          <button
            onClick={runParseOnce}
            disabled={parseLoading}
            className="rounded-md bg-white/15 px-3 py-2 hover:bg-white/25 disabled:opacity-50"
          >{parseLoading ? "Parsing…" : "Parse Once"}</button>
          <button
            onClick={runParseUntilDone}
            disabled={parseLoading}
            className="rounded-md bg-white/15 px-3 py-2 hover:bg-white/25 disabled:opacity-50"
          >{parseLoading ? "Parsing…" : "Parse Until Done"}</button>
        </div>
        {parseResult && (
          <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-black/30 p-3 text-xs text-white/80">
            {JSON.stringify(parseResult, null, 2)}
          </pre>
        )}
        {totals && (
          <div className="text-white/70 text-sm">
            raw: {totals.raw} • cleaned: {totals.clean} • newsletters: {totals.newsletters} • remaining: {totals.remaining} • parsed this session (this tab): {parsedTotal}
          </div>
        )}
        {totals && totals.remaining === 0 && (
          <div className="text-emerald-300/90 text-sm">All caught up — no unprocessed emails.</div>
        )}
        {parsedTotal > 0 && (
          <div className="text-white/70 text-sm">{parseSummary}</div>
        )}
      </div>
    </div>
  )
}


