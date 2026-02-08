"use client"

import { useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"

type VerificationStatus = {
  user_id: string
  user_email: string | null
  has_google_connection: boolean
  has_newsletter_selections: boolean
  newsletter_count: number
  has_digest_config: boolean
  digest_config: any | null
  has_messages_raw: boolean
  messages_count: number
  ready_for_digest: boolean
  missing_requirements: string[]
}

export default function DevModePanel() {
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [results, setResults] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [lookbackOverride, setLookbackOverride] = useState<string>("14") // days
  const [showStyleModal, setShowStyleModal] = useState(false)
  const [selectedStyle, setSelectedStyle] = useState<string>("morning-brief") // Default for dev

  const handleVerify = async () => {
    setLoading("verify")
    setError(null)
    try {
      const res = await fetch("/api/digest/verify")
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || "Verification failed")
      setVerificationStatus(data.verification)
      setResults({ type: "verify", data: data.verification })
    } catch (e: any) {
      setError(e?.message || "Verification failed")
    } finally {
      setLoading(null)
    }
  }

  const handleFetchEmails = async () => {
    setLoading("fetch")
    setError(null)
    try {
      const res = await fetch("/api/digest/fetch-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lookback_days: parseInt(lookbackOverride) })
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || "Failed to fetch emails")
      setResults({ type: "fetch", data })
    } catch (e: any) {
      setError(e?.message || "Failed to fetch emails")
    } finally {
      setLoading(null)
    }
  }

  const handleGenerateSummariesClick = (regenerate: boolean = false) => {
    if (regenerate) {
      // For regenerate, use default style and skip modal
      handleGenerateSummaries("morning-brief", true)
    } else {
      setShowStyleModal(true)
    }
  }

  const handleGenerateSummaries = async (style: string, regenerate: boolean = false) => {
    setShowStyleModal(false)
    setLoading("summaries")
    setError(null)
    try {
      const res = await fetch("/api/digest/generate-summaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          lookback_days: parseInt(lookbackOverride),
          style: style, // Pass selected style
          regenerate: regenerate // Pass regenerate flag
        })
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || "Failed to generate summaries")
      setResults({ type: "summaries", data })
    } catch (e: any) {
      setError(e?.message || "Failed to generate summaries")
    } finally {
      setLoading(null)
    }
  }

  const handleFormatDigest = async () => {
    setLoading("format")
    setError(null)
    try {
      const res = await fetch("/api/digest/format", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lookback_days: parseInt(lookbackOverride) })
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || "Failed to format digest")
      setResults({ type: "format", data })
    } catch (e: any) {
      setError(e?.message || "Failed to format digest")
    } finally {
      setLoading(null)
    }
  }

  const handleSendDigest = async () => {
    setLoading("send")
    setError(null)
    try {
      const res = await fetch("/api/digest/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lookback_days: parseInt(lookbackOverride) })
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || "Failed to send digest")
      setResults({ type: "send", data })
    } catch (e: any) {
      setError(e?.message || "Failed to send digest")
    } finally {
      setLoading(null)
    }
  }

  const handleFullGenerate = async () => {
    setLoading("full")
    setError(null)
    try {
      const res = await fetch("/api/digest/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lookback_days: parseInt(lookbackOverride) })
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || "Failed to generate digest")
      setResults({ type: "full", data })
    } catch (e: any) {
      setError(e?.message || "Failed to generate digest")
    } finally {
      setLoading(null)
    }
  }

  // Only show in development (check happens server-side via conditional render)

  return (
    <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/5 p-6 text-white">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-yellow-200">Dev Mode Panel</h2>
          <p className="mt-1 text-sm text-yellow-200/60">
            Step-by-step testing tools (dev only)
          </p>
        </div>
        <div className="px-3 py-1 rounded-full bg-yellow-500/20 text-yellow-200 text-xs font-medium">
          DEV ONLY
        </div>
      </div>

      {/* Lookback Override */}
      <div className="mb-4 p-3 rounded-lg bg-white/5 border border-white/10">
        <label className="text-sm text-white/60 mb-2 block">
          Lookback Override (days) - Overrides config for testing
        </label>
        <input
          type="number"
          value={lookbackOverride}
          onChange={(e) => setLookbackOverride(e.target.value)}
          min="1"
          max="30"
          className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-yellow-500/20"
        />
      </div>

      {/* Step-by-step buttons */}
      <div className="space-y-2 mb-4">
        <button
          onClick={handleVerify}
          disabled={loading !== null}
          className="w-full px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-white text-sm font-medium text-left"
        >
          {loading === "verify" ? "Checking..." : "1. Check Status"}
        </button>

        <button
          onClick={handleFetchEmails}
          disabled={loading !== null || !verificationStatus?.ready_for_digest}
          className="w-full px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-white text-sm font-medium text-left"
        >
          {loading === "fetch" ? "Fetching..." : "2. Fetch Selected Emails"}
        </button>

        <div className="flex gap-2">
          <button
            onClick={() => handleGenerateSummariesClick(false)}
            disabled={loading !== null || !verificationStatus?.ready_for_digest}
            className="flex-[2] px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-white text-sm font-medium text-left"
          >
            {loading === "summaries" ? "Generating..." : "3a. Generate Summaries (LLM)"}
          </button>

          <button
            onClick={() => handleGenerateSummariesClick(true)}
            disabled={loading !== null || !verificationStatus?.ready_for_digest}
            className="flex-1 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-white text-sm font-medium text-left"
          >
            {loading === "summaries" ? "Regenerating..." : "3b. Regenerate"}
          </button>
        </div>

        {/* Style Selection Modal */}
        <Dialog.Root open={showStyleModal} onOpenChange={setShowStyleModal}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur-md">
              <Dialog.Title className="text-lg font-medium text-white mb-2">
                Select Summary Style
              </Dialog.Title>
              <Dialog.Description className="text-sm text-white/60 mb-6">
                Choose how you want the newsletters summarized
              </Dialog.Description>
              <div className="space-y-3 mb-6">
                <button
                  onClick={() => setSelectedStyle("morning-brief")}
                  className={`w-full p-4 rounded-lg border text-left transition-colors ${
                    selectedStyle === "morning-brief"
                      ? "border-emerald-500/50 bg-emerald-500/10"
                      : "border-white/10 bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <div className="font-medium text-white mb-1">Morning Brief</div>
                  <div className="text-sm text-white/60">1-2 sentence summaries. Focus on key takeaways.</div>
                </button>
                <button
                  onClick={() => setSelectedStyle("deep-read")}
                  className={`w-full p-4 rounded-lg border text-left transition-colors ${
                    selectedStyle === "deep-read"
                      ? "border-emerald-500/50 bg-emerald-500/10"
                      : "border-white/10 bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <div className="font-medium text-white mb-1">Deep Read</div>
                  <div className="text-sm text-white/60">4-6 sentence summaries with context and insights.</div>
                </button>
                <button
                  onClick={() => setSelectedStyle("reference-mode")}
                  className={`w-full p-4 rounded-lg border text-left transition-colors ${
                    selectedStyle === "reference-mode"
                      ? "border-emerald-500/50 bg-emerald-500/10"
                      : "border-white/10 bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <div className="font-medium text-white mb-1">Reference Mode</div>
                  <div className="text-sm text-white/60">Structured summaries with main topics and key points.</div>
                </button>
              </div>
              <div className="flex gap-3">
                <Dialog.Close asChild>
                  <button className="flex-1 px-4 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-white font-medium">
                    Cancel
                  </button>
                </Dialog.Close>
                <button
                  onClick={() => handleGenerateSummaries(selectedStyle, false)}
                  className="flex-1 px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25 transition-colors text-white font-medium"
                >
                  Generate Summaries
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <button
          onClick={handleFormatDigest}
          disabled={loading !== null || !verificationStatus?.ready_for_digest}
          className="w-full px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-white text-sm font-medium text-left"
        >
          {loading === "format" ? "Formatting..." : "4. Format Digest (Style-based)"}
        </button>

        <button
          onClick={handleSendDigest}
          disabled={loading !== null || !verificationStatus?.ready_for_digest}
          className="w-full px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-white text-sm font-medium text-left"
        >
          {loading === "send" ? "Sending..." : "5. Send to Inbox (Resend)"}
        </button>
      </div>

      {/* Full generate button */}
      <div className="pt-4 border-t border-white/10">
        <button
          onClick={handleFullGenerate}
          disabled={loading !== null || !verificationStatus?.ready_for_digest}
          className="w-full px-4 py-2 rounded-lg bg-yellow-500/20 hover:bg-yellow-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-yellow-200 font-medium"
        >
          {loading === "full" ? "Generating Full Digest..." : "🚀 Generate Full Digest (All Steps)"}
        </button>
      </div>

      {/* Results */}
      {error && (
        <div className="mt-4 p-3 rounded-lg bg-red-500/15 border border-red-500/20 text-red-300 text-sm">
          {error}
        </div>
      )}

      {results && (
        <div className="mt-4 p-3 rounded-lg bg-white/5 border border-white/10">
          <div className="text-xs text-white/60 mb-2">
            Last Result: {results.type}
          </div>
          <pre className="text-xs text-white/80 overflow-auto max-h-40">
            {JSON.stringify(results.data, null, 2)}
          </pre>
        </div>
      )}

      {/* Verification Status Summary */}
      {verificationStatus && (
        <div className="mt-4 p-3 rounded-lg bg-white/5 border border-white/10">
          <div className="text-xs text-white/60 mb-2">Status:</div>
          <div className="text-xs space-y-1">
            <div className={verificationStatus.has_google_connection ? "text-green-300" : "text-red-300"}>
              {verificationStatus.has_google_connection ? "✅" : "❌"} Google: {verificationStatus.messages_count} messages
            </div>
            <div className={verificationStatus.has_newsletter_selections ? "text-green-300" : "text-red-300"}>
              {verificationStatus.has_newsletter_selections ? "✅" : "❌"} Newsletters: {verificationStatus.newsletter_count} selected
            </div>
            <div className={verificationStatus.has_digest_config ? "text-green-300" : "text-red-300"}>
              {verificationStatus.has_digest_config ? "✅" : "❌"} Config: {verificationStatus.has_digest_config ? "Set" : "Missing"}
            </div>
            <div className={verificationStatus.ready_for_digest ? "text-green-300 font-medium" : "text-red-300 font-medium"}>
              {verificationStatus.ready_for_digest ? "✅ READY" : "❌ NOT READY"}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
