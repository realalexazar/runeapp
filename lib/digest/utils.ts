/**
 * Digest Generation Utilities
 * 
 * Functions for calculating lookback windows, timezone conversions, etc.
 */

/**
 * Calculate lookback window for twice-daily digests
 * Based on the time difference between morning and evening send times
 */
export function calculateTwiceDailyWindow(
  currentSendTime: Date,
  morningTime: string, // "08:00"
  eveningTime: string, // "20:00"
  generationBuffer: number = 10 * 60 * 1000 // 10 minutes in ms
): { start: Date; end: Date } {
  const generationTime = new Date(currentSendTime.getTime() - generationBuffer)
  
  // Parse times
  const [morningHour, morningMin] = morningTime.split(':').map(Number)
  const [eveningHour, eveningMin] = eveningTime.split(':').map(Number)
  
  // Create Date objects for today
  const today = new Date(currentSendTime)
  today.setHours(0, 0, 0, 0)
  
  const morningToday = new Date(today)
  morningToday.setHours(morningHour, morningMin, 0, 0)
  
  const eveningToday = new Date(today)
  eveningToday.setHours(eveningHour, eveningMin, 0, 0)
  
  // Determine which digest this is (morning or evening)
  const currentHour = currentSendTime.getHours()
  const currentMin = currentSendTime.getMinutes()
  
  // Check if we're closer to morning or evening
  // If current time is before morning OR after evening, it's morning digest
  const isMorningDigest = 
    (currentHour < morningHour) || 
    (currentHour === morningHour && currentMin < morningMin) ||
    (currentHour > eveningHour) ||
    (currentHour === eveningHour && currentMin > eveningMin)
  
  let startTime: Date
  
  if (isMorningDigest) {
    // Morning digest: look back to previous evening
    const yesterdayEvening = new Date(eveningToday)
    yesterdayEvening.setDate(yesterdayEvening.getDate() - 1)
    startTime = yesterdayEvening
  } else {
    // Evening digest: look back to same-day morning
    startTime = morningToday
  }
  
  return {
    start: startTime,
    end: generationTime
  }
}

/**
 * Calculate lookback window based on cadence
 */
export function calculateLookbackWindow(
  cadence: string,
  sendTime: Date,
  sendTimes?: string[], // For twice-daily: ['08:00', '20:00']
  generationBuffer: number = 10 * 60 * 1000 // 10 minutes in ms
): { start: Date; end: Date } {
  const generationTime = new Date(sendTime.getTime() - generationBuffer)
  
  if (cadence === 'twice-daily' && sendTimes && sendTimes.length === 2) {
    // Dynamic window based on time difference
    return calculateTwiceDailyWindow(sendTime, sendTimes[0], sendTimes[1], generationBuffer)
  }
  
  // Fixed windows for other cadences
  const windows: Record<string, number> = {
    'daily': 24 * 60 * 60 * 1000,
    'every-other-day': 48 * 60 * 60 * 1000,
    'weekly': 7 * 24 * 60 * 60 * 1000
  }
  
  const windowMs = windows[cadence] || windows['daily']
  const startTime = new Date(generationTime.getTime() - windowMs)
  
  return {
    start: startTime,
    end: generationTime
  }
}

/**
 * Convert user's local time to UTC for cron scheduling
 */
export function convertToUTC(localTime: string, timezone: string): Date {
  // Parse time string (e.g., "08:00")
  const [hours, minutes] = localTime.split(':').map(Number)
  
  // Create date in user's timezone
  const dateStr = new Date().toLocaleDateString('en-US', { timeZone: timezone })
  const [month, day, year] = dateStr.split('/').map(Number)
  
  // Create date object and set time
  const date = new Date(year, month - 1, day, hours, minutes, 0, 0)
  
  // Convert to UTC
  const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }))
  const localDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }))
  
  // Calculate offset
  const offset = utcDate.getTime() - localDate.getTime()
  
  return new Date(date.getTime() - offset)
}

/**
 * Check if current time is within send window (±windowMinutes)
 */
export function isWithinSendWindow(
  currentTime: Date,
  sendTime: string, // "08:00"
  timezone: string,
  windowMinutes: number = 15
): boolean {
  const [sendHour, sendMin] = sendTime.split(':').map(Number)
  
  // Get current time in user's timezone
  const userNow = new Date(currentTime.toLocaleString('en-US', { timeZone: timezone }))
  const userHour = userNow.getHours()
  const userMin = userNow.getMinutes()
  
  // Calculate time difference in minutes
  const currentMinutes = userHour * 60 + userMin
  const sendMinutes = sendHour * 60 + sendMin
  
  let diff = Math.abs(currentMinutes - sendMinutes)
  
  // Handle wrap-around (e.g., 23:50 -> 00:10)
  if (diff > 12 * 60) {
    diff = 24 * 60 - diff
  }
  
  return diff <= windowMinutes
}
