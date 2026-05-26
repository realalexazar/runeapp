"use client"

import { useCallback, useEffect, useState } from "react"

type Sender = {
  newsletter_name: string
  sender_key: string
  status: "Yes" | "Grey" | "No"
  messages: number
  confidence: string
  selected: boolean
}

type ApiResponse = {
  ok: boolean
  senders?: Sender[]
  error?: string
  message?: string
}

type NewsletterSelectionCardProps = {
  onFinalized?: () => void
}

export default function NewsletterSelectionCard({ onFinalized }: NewsletterSelectionCardProps = {}) {
  const [senders, setSenders] = useState<Sender[]>([])
  const [localSelections, setLocalSelections] = useState<Map<string, boolean>>(new Map())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showNoSection, setShowNoSection] = useState(false)

  const fetchSenders = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/onboard/classified-senders", {
        credentials: "include"
      })
      
      // Handle 401 Unauthorized (session expired)
      if (res.status === 401) {
        setError("Your session has expired. Please refresh the page or sign in again.")
        setLoading(false)
        return
      }
      
      const data: ApiResponse = await res.json()
      
      if (!data.ok) {
        throw new Error(data.error || "Failed to fetch senders")
      }

      if (data.senders) {
        setSenders(data.senders)
        // Initialize local selections from fetched data
        const selectionsMap = new Map<string, boolean>()
        data.senders.forEach(sender => {
          selectionsMap.set(sender.sender_key, sender.selected)
        })
        setLocalSelections(selectionsMap)
      }
    } catch (e: any) {
      console.error("Error fetching senders:", e)
      setError(e?.message || "Failed to load newsletters")
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch senders on mount
  useEffect(() => {
    fetchSenders()
  }, [fetchSenders])

  const handleToggle = useCallback((senderKey: string) => {
    setLocalSelections(prev => {
      const next = new Map(prev)
      const current = next.get(senderKey) ?? false
      next.set(senderKey, !current)
      return next
    })
    setSuccess(null) // Clear success message on change
  }, [])

  const handleFinalize = useCallback(async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      // Build selections array (only changed items, or all if we want to be explicit)
      // For simplicity, send all current selections
      const selections = Array.from(localSelections.entries()).map(([sender_key, selected]) => ({
        sender_key,
        selected
      }))

      const res = await fetch("/api/onboard/finalize-selections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ selections })
      })

      const data = await res.json()

      if (!data.ok) {
        throw new Error(data.error || "Failed to save selections")
      }

      setSuccess(data.message || `Successfully saved ${data.saved} selection(s).`)
      
      // Call callback to advance to next step BEFORE refreshing
      // This ensures the step transition happens immediately
      if (onFinalized) {
        onFinalized()
      }
      
      // Refresh senders to get updated state (non-blocking)
      fetchSenders().catch(console.error)
    } catch (e: any) {
      console.error("Error finalizing selections:", e)
      setError(e?.message || "Failed to save selections")
    } finally {
      setSaving(false)
    }
  }, [localSelections, fetchSenders, onFinalized])

  // Group senders by status
  const yesSenders = senders.filter(s => s.status === "Yes")
  const greySenders = senders.filter(s => s.status === "Grey")
  const noSenders = senders.filter(s => s.status === "No")

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="text-lg font-medium">Newsletter Selection</div>
        <div className="text-white/60 text-sm">
          Rune's AI has analyzed your inbox and identified newsletters you might want to follow. Review and customize your selection below.
        </div>
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="rounded-md bg-red-500/15 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300">
          {success}
        </div>
      )}

      {/* Scrollable Content */}
      <div className="max-h-[500px] overflow-y-auto space-y-4 pr-2">
        {loading ? (
          <div className="text-white/60 text-sm">Loading newsletters...</div>
        ) : senders.length === 0 ? (
          <div className="text-white/60 text-sm">
            No newsletters found. Run "Classify Senders" first.
          </div>
        ) : (
          <>
            {/* Yes Section */}
            {yesSenders.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium text-white/80">Recommended Newsletters</div>
                {yesSenders.map(sender => {
                  const isSelected = localSelections.get(sender.sender_key) ?? sender.selected
                  return (
                    <NewsletterRow
                      key={sender.sender_key}
                      sender={sender}
                      isSelected={isSelected}
                      onToggle={() => handleToggle(sender.sender_key)}
                      illuminated={isSelected}
                    />
                  )
                })}
              </div>
            )}

            {/* Grey Section */}
            {greySenders.length > 0 && (
              <div className="space-y-2">
                {yesSenders.length > 0 && <div className="h-px w-full bg-white/10" />}
                <div className="text-sm font-medium text-white/80">Uncertain</div>
                {greySenders.map(sender => {
                  const isSelected = localSelections.get(sender.sender_key) ?? sender.selected
                  return (
                    <NewsletterRow
                      key={sender.sender_key}
                      sender={sender}
                      isSelected={isSelected}
                      onToggle={() => handleToggle(sender.sender_key)}
                      illuminated={isSelected}
                    />
                  )
                })}
              </div>
            )}

            {/* No Section (Collapsible) */}
            {noSenders.length > 0 && (
              <div className="space-y-2">
                {(yesSenders.length > 0 || greySenders.length > 0) && (
                  <div className="h-px w-full bg-white/10" />
                )}
                <button
                  onClick={() => setShowNoSection(!showNoSection)}
                  className="flex w-full items-center justify-between text-sm font-medium text-white/80 hover:text-white"
                >
                  <span>Non-Newsletters</span>
                  <span className="text-white/60">
                    {showNoSection ? "▼" : "▶"} {noSenders.length}
                  </span>
                </button>
                {showNoSection && (
                  <div className="space-y-2 pl-4">
                    {noSenders.map(sender => {
                      const isSelected = localSelections.get(sender.sender_key) ?? sender.selected
                      return (
                        <NewsletterRow
                          key={sender.sender_key}
                          sender={sender}
                          isSelected={isSelected}
                          onToggle={() => handleToggle(sender.sender_key)}
                          illuminated={isSelected}
                        />
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Finalize Button */}
      {!loading && senders.length > 0 && (
        <div className="pt-2">
          <button
            onClick={handleFinalize}
            disabled={saving}
            className="rounded-md bg-white/15 px-4 py-2 hover:bg-white/25 disabled:opacity-50 text-sm font-medium"
          >
            {saving ? "Saving..." : "Finalize Selections"}
          </button>
        </div>
      )}
    </div>
  )
}

// Newsletter Row Component
function NewsletterRow({
  sender,
  isSelected,
  onToggle,
  illuminated
}: {
  sender: Sender
  isSelected: boolean
  onToggle: () => void
  illuminated: boolean
}) {
  return (
    <label
      className={`
        flex items-center gap-3 rounded-md px-3 py-2 cursor-pointer transition-all
        ${illuminated ? "bg-white/15 border border-white/20" : "bg-white/5 hover:bg-white/10"}
      `}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={onToggle}
        className="h-4 w-4 rounded border-white/20 bg-white/10 text-white focus:ring-2 focus:ring-white/20"
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white">{sender.newsletter_name}</div>
        <div className="text-xs text-white/60">{sender.sender_key}</div>
      </div>
      <div className="text-xs text-white/50">{sender.messages} msgs</div>
    </label>
  )
}
