"use client"

import { useState, useEffect } from "react"

type CustomTimePickerProps = {
  value: string // Format: "HH:MM" (24-hour)
  onChange: (value: string) => void
  label?: string
}

export default function CustomTimePicker({
  value,
  onChange,
  label
}: CustomTimePickerProps) {
  // Parse value into hours and minutes (24-hour format)
  const parseValue = () => {
    if (!value) return { hour24: 8, minute: 0 }
    const [h, m] = value.split(':').map(Number)
    return { hour24: h || 8, minute: m || 0 }
  }

  const { hour24, minute } = parseValue()
  
  // Convert 24-hour to 12-hour for display
  const hour12 = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24
  const period: 'AM' | 'PM' = hour24 >= 12 ? 'PM' : 'AM'

  const [selectedHour12, setSelectedHour12] = useState<number>(hour12)
  const [selectedMinute, setSelectedMinute] = useState<number>(minute)
  const [selectedPeriod, setSelectedPeriod] = useState<'AM' | 'PM'>(period)

  // Sync with prop value changes
  useEffect(() => {
    const { hour24: h24, minute: m } = parseValue()
    const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24
    const p: 'AM' | 'PM' = h24 >= 12 ? 'PM' : 'AM'
    setSelectedHour12(h12)
    setSelectedMinute(m)
    setSelectedPeriod(p)
  }, [value])

  // Convert 12-hour to 24-hour and call onChange
  const convertAndUpdate = (hour12: number, minute: number, period: 'AM' | 'PM') => {
    let hour24 = hour12
    if (period === 'PM' && hour12 !== 12) {
      hour24 = hour12 + 12
    } else if (period === 'AM' && hour12 === 12) {
      hour24 = 0
    }
    
    const timeString = `${hour24.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
    onChange(timeString)
  }

  const handleHourChange = (hour: number) => {
    setSelectedHour12(hour)
    convertAndUpdate(hour, selectedMinute, selectedPeriod)
  }

  const handleMinuteChange = (minute: number) => {
    setSelectedMinute(minute)
    convertAndUpdate(selectedHour12, minute, selectedPeriod)
  }

  const handlePeriodChange = (period: 'AM' | 'PM') => {
    setSelectedPeriod(period)
    convertAndUpdate(selectedHour12, selectedMinute, period)
  }

  // Generate options for dropdowns
  const hourOptions = Array.from({ length: 12 }, (_, i) => i + 1)
  const minuteOptions = Array.from({ length: 60 }, (_, i) => i)

  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-sm font-medium text-white/80">
          {label}
        </label>
      )}
      <div className="flex items-center gap-2">
        {/* Hour Selector */}
        <select
          value={selectedHour12}
          onChange={(e) => handleHourChange(Number(e.target.value))}
          className="flex-1 px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/20 appearance-none cursor-pointer"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23ffffff'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 0.5rem center',
            backgroundSize: '1rem',
            paddingRight: '2.5rem'
          }}
        >
          {hourOptions.map((hour: number) => (
            <option key={hour} value={hour} className="bg-gray-800 text-white">
              {hour.toString().padStart(2, '0')}
            </option>
          ))}
        </select>

        {/* Separator */}
        <span className="text-white/60 text-lg font-medium">:</span>

        {/* Minute Selector */}
        <select
          value={selectedMinute}
          onChange={(e) => handleMinuteChange(Number(e.target.value))}
          className="flex-1 px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/20 appearance-none cursor-pointer"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23ffffff'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 0.5rem center',
            backgroundSize: '1rem',
            paddingRight: '2.5rem'
          }}
        >
          {minuteOptions.map((minute: number) => (
            <option key={minute} value={minute} className="bg-gray-800 text-white">
              {minute.toString().padStart(2, '0')}
            </option>
          ))}
        </select>

        {/* AM/PM Selector */}
        <select
          value={selectedPeriod}
          onChange={(e) => handlePeriodChange(e.target.value as 'AM' | 'PM')}
          className="px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/20 appearance-none cursor-pointer"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23ffffff'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 0.5rem center',
            backgroundSize: '1rem',
            paddingRight: '2.5rem'
          }}
        >
          <option value="AM" className="bg-gray-800 text-white">AM</option>
          <option value="PM" className="bg-gray-800 text-white">PM</option>
        </select>
      </div>
    </div>
  )
}
