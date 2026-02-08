"use client"

import { useState, useEffect } from "react"

type VerificationStatus = {
  user_id: string
  user_email: string | null
  has_google_connection: boolean
  oauth_token_valid: boolean | null // null = not tested, true = valid, false = expired
  has_newsletter_selections: boolean
  newsletter_count: number
  has_digest_config: boolean
  digest_config: any | null
  has_messages_raw: boolean
  messages_count: number
  ready_for_digest: boolean
  missing_requirements: string[]
}

export default function DigestStatusCard() {
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<VerificationStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reconnecting, setReconnecting] = useState(false)

  async function handleReconnect() {
    try {
      setReconnecting(true)
      setError(null)
      const res = await fetch("/api/connect/gmail/start")
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to start OAuth")
      }
      const { url } = data
      if (!url) throw new Error("Missing redirect URL")
      location.assign(url)
    } catch (e: any) {
      console.error("OAuth start error:", e)
      setError(e?.message ?? "Something went wrong")
      setReconnecting(false)
    }
  }

  useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await fetch("/api/digest/verify")
        const data = await res.json()
        
        if (!data.ok) {
          throw new Error(data.error || "Failed to fetch status")
        }
        
        setStatus(data.verification)
      } catch (e: any) {
        setError(e?.message || "Failed to load status")
      } finally {
        setLoading(false)
      }
    }
    
    fetchStatus()
  }, [])

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white">
        <div className="text-white/60">Loading status...</div>
      </div>
    )
  }

  if (error || !status) {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-white">
        <div className="text-red-300">Error: {error || "Failed to load status"}</div>
      </div>
    )
  }

  const isReady = status.ready_for_digest

  return (
    <div className={`rounded-2xl border p-6 ${
      isReady 
        ? "border-emerald-500/20 bg-emerald-500/10" 
        : "border-white/10 bg-white/5"
    } text-white`}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg font-medium text-white">Digest Status</h2>
          <p className={`mt-1 text-sm ${isReady ? "text-emerald-200" : "text-white/60"}`}>
            {isReady 
              ? "✅ Ready to generate digests" 
              : `❌ Missing ${status.missing_requirements.length} requirement(s)`}
          </p>
        </div>
        {isReady && (
          <div className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-200 text-xs font-medium">
            Ready
          </div>
        )}
      </div>

      <div className="space-y-3">
        {status.has_google_connection && status.oauth_token_valid === false ? (
          <div className="flex items-center justify-between">
            <span className="text-sm text-white/60">Google Connection</span>
            <button
              onClick={handleReconnect}
              disabled={reconnecting}
              className="px-3 py-1 rounded-lg bg-white/15 hover:bg-white/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium text-red-300 border border-red-500/20"
            >
              {reconnecting ? "Redirecting..." : "Reconnect"}
            </button>
          </div>
        ) : (
          <StatusItem 
            label="Google Connection" 
            value={status.has_google_connection ? "Connected" : "Not connected"}
            ok={status.has_google_connection && status.oauth_token_valid !== false}
          />
        )}
        <StatusItem 
          label="Newsletter Selections" 
          value={status.newsletter_count > 0 ? `${status.newsletter_count} selected` : "None selected"}
          ok={status.has_newsletter_selections}
        />
        <StatusItem 
          label="Digest Configuration" 
          value={status.has_digest_config ? "Configured" : "Not configured"}
          ok={status.has_digest_config}
        />
        <StatusItem 
          label="Email Messages" 
          value={status.messages_count > 0 ? `${status.messages_count} messages` : "No messages"}
          ok={status.has_messages_raw}
        />
      </div>

      {status.missing_requirements.length > 0 && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <p className="text-sm text-white/60 mb-2">Missing requirements:</p>
          <ul className="space-y-1">
            {status.missing_requirements.map((req, i) => (
              <li key={i} className="text-sm text-red-300">• {req}</li>
            ))}
          </ul>
        </div>
      )}

      {status.has_digest_config && status.digest_config && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <p className="text-sm text-white/60 mb-2">Your Configuration:</p>
          <div className="text-sm space-y-1">
            <div className="text-white/80">
              <span className="text-white/60">Cadence:</span> {status.digest_config.cadence}
            </div>
            <div className="text-white/80">
              <span className="text-white/60">Send Times:</span> {Array.isArray(status.digest_config.send_time) ? status.digest_config.send_time.join(", ") : status.digest_config.send_time}
            </div>
            <div className="text-white/80">
              <span className="text-white/60">Style:</span> {status.digest_config.style}
            </div>
            {status.digest_config.rune_name && (
              <div className="text-white/80">
                <span className="text-white/60">Rune Name:</span> {status.digest_config.rune_name}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function StatusItem({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-white/60">{label}</span>
      <span className={`text-sm font-medium ${ok ? "text-emerald-200" : "text-red-300"}`}>
        {ok ? "✓" : "✗"} {value}
      </span>
    </div>
  )
}
