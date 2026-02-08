"use client"

import { useState } from "react"

type CadenceOption = {
  value: 'twice-daily' | 'daily' | 'every-other-day' | 'weekly'
  label: string
  description: string
  recommended?: boolean
}

const cadenceOptions: CadenceOption[] = [
  {
    value: 'twice-daily',
    label: 'Twice Daily',
    description: 'Morning and evening updates',
    recommended: true
  },
  {
    value: 'daily',
    label: 'Daily',
    description: 'Once per day'
  },
  {
    value: 'every-other-day',
    label: 'Every Other Day',
    description: 'Every 48 hours'
  },
  {
    value: 'weekly',
    label: 'Weekly',
    description: 'Once per week'
  }
]

type CadenceSelectionCardProps = {
  selectedCadence: string | null
  onSelect: (cadence: string) => void
}

export default function CadenceSelectionCard({
  selectedCadence,
  onSelect
}: CadenceSelectionCardProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white space-y-6">
      <div>
        <h2 className="text-lg font-medium text-white">How often?</h2>
        <p className="mt-1 text-sm text-white/60">
          Choose how frequently you'd like to receive your Rune digest.
        </p>
      </div>

      <div className="space-y-3">
        {cadenceOptions.map((option) => {
          const isSelected = selectedCadence === option.value
          return (
            <button
              key={option.value}
              onClick={() => onSelect(option.value)}
              className={`w-full text-left p-4 rounded-lg border transition-all ${
                isSelected
                  ? 'bg-white/15 border-white/20'
                  : 'bg-white/5 border-white/10 hover:bg-white/10'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">{option.label}</span>
                    {option.recommended && (
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-500/20 text-emerald-200">
                        Recommended
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-white/60">{option.description}</p>
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
    </div>
  )
}
