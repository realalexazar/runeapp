"use client"

import { useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"

type StyleOption = {
  value: 'morning-brief' | 'deep-read' | 'reference-mode'
  label: string
  description: string
  colorAccent: string // Tailwind classes for color accent
  borderColor: string // Tailwind classes for border color
}

const styleOptions: StyleOption[] = [
  {
    value: 'morning-brief',
    label: 'Morning Brief',
    description: 'One-sentence summaries plus top 3 subject lines. Optimized for speed—scan everything in under a minute.',
    colorAccent: 'bg-amber-500/20 text-amber-200',
    borderColor: 'border-amber-500/30'
  },
  {
    value: 'deep-read',
    label: 'Deep Read',
    description: 'Comprehensive 4-6 sentence summaries covering all key points, plus all subject lines with context. Best when you want full understanding.',
    colorAccent: 'bg-blue-500/20 text-blue-200',
    borderColor: 'border-blue-500/30'
  },
  {
    value: 'reference-mode',
    label: 'Reference Mode',
    description: 'Structured format with key points and topics organized for easy searching. Perfect for saving and referencing later.',
    colorAccent: 'bg-emerald-500/20 text-emerald-200',
    borderColor: 'border-emerald-500/30'
  }
]

type StyleSelectionCardProps = {
  cadence: string
  sendTimes: string[]
  timezone: string
  onComplete: () => void
}

export default function StyleSelectionCard({
  cadence,
  sendTimes,
  timezone,
  onComplete
}: StyleSelectionCardProps) {
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showNameModal, setShowNameModal] = useState(false)
  const [runeName, setRuneName] = useState<string>("")

  const handleContinue = () => {
    if (!selectedStyle) {
      setError("Please select a digest style")
      return
    }
    setShowNameModal(true)
  }

  const handleFinalSubmit = async () => {
    setSaving(true)
    setError(null)

    try {
      const res = await fetch("/api/digest/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          cadence,
          send_time: sendTimes,
          timezone,
          style: selectedStyle,
          rune_name: runeName.trim() || null
        })
      })

      const data = await res.json()

      if (!data.ok) {
        throw new Error(data.error || "Failed to save configuration")
      }

      // Success - navigate to dashboard
      onComplete()
    } catch (e: any) {
      console.error("Error saving digest config:", e)
      setError(e?.message || "Failed to save configuration")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white space-y-6">
      <div>
        <h2 className="text-lg font-medium text-white">Digest Style</h2>
        <p className="mt-1 text-sm text-white/60">
          Choose how you'd like your digest formatted.
        </p>
      </div>

      <div className="space-y-3">
        {styleOptions.map((option) => {
          const isSelected = selectedStyle === option.value
          
          // Get color values for inline styles
          const getBorderColor = () => {
            if (isSelected) {
              if (option.value === 'morning-brief') return 'rgba(245, 158, 11, 0.3)' // amber-500/30
              if (option.value === 'deep-read') return 'rgba(59, 130, 246, 0.3)' // blue-500/30
              if (option.value === 'reference-mode') return 'rgba(16, 185, 129, 0.3)' // emerald-500/30
            }
            return 'rgba(255, 255, 255, 0.1)'
          }
          
          return (
            <button
              key={option.value}
              onClick={() => setSelectedStyle(option.value)}
              className={`w-full text-left p-4 rounded-lg border-2 transition-all relative overflow-hidden ${
                isSelected
                  ? option.colorAccent
                  : 'bg-white/5 hover:bg-white/10'
              }`}
              style={{
                borderColor: getBorderColor()
              }}
            >
              {/* Colored accent bar on left */}
              <div
                className={`absolute left-0 top-0 bottom-0 w-1 transition-opacity ${
                  isSelected ? 'opacity-100' : 'opacity-0'
                }`}
                style={{
                  backgroundColor: 
                    option.value === 'morning-brief' ? 'rgba(245, 158, 11, 0.4)' :
                    option.value === 'deep-read' ? 'rgba(59, 130, 246, 0.4)' :
                    'rgba(16, 185, 129, 0.4)'
                }}
              />
              
              <div className="flex items-start justify-between relative z-10">
                <div className="flex-1">
                  <div className="font-medium text-white">{option.label}</div>
                  <p className={`mt-1 text-sm ${isSelected ? 'text-white/80' : 'text-white/60'}`}>
                    {option.description}
                  </p>
                </div>
                {isSelected && (
                  <svg
                    className="w-5 h-5 text-white flex-shrink-0 ml-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/15 border border-red-500/20 text-red-300 text-sm">
          {error}
        </div>
      )}

      <button
        onClick={handleContinue}
        disabled={!selectedStyle}
        className="w-full px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-white font-medium"
      >
        Continue
      </button>

      {/* Name Your Rune Modal */}
      <Dialog.Root open={showNameModal} onOpenChange={setShowNameModal}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur-md">
            <Dialog.Title className="text-lg font-medium text-white mb-2">
              Name your Rune
            </Dialog.Title>
            <Dialog.Description className="text-sm text-white/60 mb-6">
              Give your digest a personal name. You can change this later in settings.
            </Dialog.Description>

            <div className="space-y-4">
              <div>
                <input
                  type="text"
                  value={runeName}
                  onChange={(e) => setRuneName(e.target.value)}
                  placeholder="e.g., Morning Intel, Daily Brief, My Digest"
                  className="w-full px-4 py-2 rounded-lg bg-white/10 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/20"
                  autoFocus
                />
                <p className="mt-2 text-xs text-white/50">
                  Optional - leave blank to skip for now
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-500/15 border border-red-500/20 text-red-300 text-sm">
                  {error}
                </div>
              )}

              <div className="flex gap-3">
                <Dialog.Close asChild>
                  <button
                    className="flex-1 px-4 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-white font-medium"
                  >
                    Skip
                  </button>
                </Dialog.Close>
                <button
                  onClick={handleFinalSubmit}
                  disabled={saving}
                  className="flex-1 px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-white font-medium"
                >
                  {saving ? "Saving..." : "Start Receiving Digests"}
                </button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
