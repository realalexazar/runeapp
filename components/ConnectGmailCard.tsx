"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"

export default function ConnectGmailCard({ isConnected }: { isConnected: boolean }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConnect() {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch("/api/connect/gmail/start")
      if (!res.ok) throw new Error("Failed to start OAuth")
      const { url } = await res.json()
      if (!url) throw new Error("Missing redirect URL")
      location.assign(url)
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong")
      setLoading(false)
    }
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6 shadow-xl backdrop-blur-md">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_60%_at_20%_0%,rgba(168,85,247,0.15),transparent),radial-gradient(80%_60%_at_80%_100%,rgba(59,130,246,0.15),transparent)]" />
      <div className="relative z-10">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 bg-white/10 text-white">📧</div>
            <div>
              <h3 className="text-lg font-semibold text-white">Connect Gmail</h3>
              <p className="text-sm text-white/60">Authorize read-only access to your newsletters.</p>
            </div>
          </div>
          <span className={"rounded-full px-3 py-1 text-xs font-medium " + (isConnected ? "bg-emerald-500/20 text-emerald-200" : "bg-white/10 text-white/80")}>{isConnected ? "Connected" : "Not connected"}</span>
        </div>
        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
        <Button onClick={handleConnect} disabled={loading} className="bg-white/15 text-white hover:bg-white/25">
          {loading ? "Redirecting..." : isConnected ? "Reconnect" : "Connect Gmail"}
        </Button>
      </div>
    </div>
  )
}
