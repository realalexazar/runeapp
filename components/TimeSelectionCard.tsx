"use client"

import { useState, useEffect, useRef } from "react"
import CustomTimePicker from "./CustomTimePicker"

type TimeSelectionCardProps = {
  cadence: string
  selectedTimes: string[]
  selectedTimezone: string
  onSelect: (times: string[], timezone: string) => void
}

export default function TimeSelectionCard({
  cadence,
  selectedTimes,
  selectedTimezone,
  onSelect
}: TimeSelectionCardProps) {
  const [time1, setTime1] = useState<string>(selectedTimes[0] || '08:00')
  const [time2, setTime2] = useState<string>(selectedTimes[1] || '20:00')
  const [timezone, setTimezone] = useState<string>(selectedTimezone)
  const initializedRef = useRef(false)
  const onSelectRef = useRef(onSelect)

  // Keep onSelect ref up to date without triggering effects
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  // Auto-detect timezone on mount
  useEffect(() => {
    if (initializedRef.current) return
    
    try {
      const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      setTimezone(detectedTimezone)
      initializedRef.current = true
      
      // Initialize with default times if not already set
      if (selectedTimes.length === 0) {
        const defaultTimes = cadence === 'twice-daily' ? ['08:00', '20:00'] : ['08:00']
        onSelectRef.current(defaultTimes, detectedTimezone)
      } else {
        // Use provided times with detected timezone
        onSelectRef.current(selectedTimes, detectedTimezone)
      }
    } catch (e) {
      console.error("Error detecting timezone:", e)
      setTimezone('UTC')
      initializedRef.current = true
    }
  }, [cadence, selectedTimes])

  // Update parent when times or timezone change (after initialization)
  useEffect(() => {
    if (!initializedRef.current) return
    
    const times = cadence === 'twice-daily' ? [time1, time2] : [time1]
    onSelectRef.current(times, timezone)
  }, [time1, time2, cadence, timezone])

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white space-y-6">
      <div>
        <h2 className="text-lg font-medium text-white">When?</h2>
        <p className="mt-1 text-sm text-white/60">
          Choose what time you'd like to receive your digest.
        </p>
      </div>

      <div className="space-y-4">
        {/* First Time Picker */}
        <CustomTimePicker
          value={time1}
          onChange={(value) => setTime1(value)}
          label={cadence === 'twice-daily' ? 'Morning Time' : 'Delivery Time'}
        />

        {/* Second Time Picker (only for twice-daily) */}
        {cadence === 'twice-daily' && (
          <CustomTimePicker
            value={time2}
            onChange={(value) => setTime2(value)}
            label="Evening Time"
          />
        )}

        {/* Timezone Display */}
        <div className="pt-2 border-t border-white/10">
          <p className="text-sm text-white/60">
            Your timezone: <span className="text-white/80 font-medium">{timezone}</span>
          </p>
          <p className="mt-1 text-xs text-white/50">
            Automatically detected from your browser
          </p>
        </div>
      </div>
    </div>
  )
}
