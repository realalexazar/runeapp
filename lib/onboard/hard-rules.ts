/**
 * Hard rules to filter out transactional/promotional emails before LLM classification
 * Returns true if the sender should be marked as 'low' (not a newsletter) without LLM
 */

const TRANSACTION_KEYWORDS = [
  'receipt',
  'invoice',
  'order',
  'confirmation',
  'security',
  'verification',
  'verify',
  'login',
  'otp',
  'password',
  'reset',
  'shipped',
  'tracking',
  'delivery',
  'package',
  'payment',
  'transaction',
  'statement',
  'alert',
  'notification'
]

const DISCOUNT_KEYWORDS = [
  '% off',
  '% discount',
  'sale',
  'deal',
  'limited time',
  'free shipping',
  'buy now',
  'special offer',
  'promo',
  'coupon',
  'discount code',
  'save',
  'clearance'
]

/**
 * Check if subjects contain transaction keywords
 * Returns true if 2+ subjects match transaction patterns
 */
export function isTransactional(subjects: string[]): boolean {
  if (subjects.length < 2) return false
  
  const lowerSubjects = subjects.map(s => s.toLowerCase())
  let matchCount = 0
  
  for (const subject of lowerSubjects) {
    for (const keyword of TRANSACTION_KEYWORDS) {
      if (subject.includes(keyword)) {
        matchCount++
        break // Count each subject only once
      }
    }
  }
  
  return matchCount >= 2
}

/**
 * Check if subjects contain discount/promotional language
 * Returns true if 2+ subjects match discount patterns
 */
export function isPromotional(subjects: string[]): boolean {
  if (subjects.length < 2) return false
  
  const lowerSubjects = subjects.map(s => s.toLowerCase())
  let matchCount = 0
  
  for (const subject of lowerSubjects) {
    for (const keyword of DISCOUNT_KEYWORDS) {
      if (subject.includes(keyword)) {
        matchCount++
        break // Count each subject only once
      }
    }
  }
  
  return matchCount >= 2
}

/**
 * Check if sender should be filtered out by hard rules
 * Returns true if sender should be marked as 'low' without LLM
 */
export function shouldSkipLLM(subjects: string[]): boolean {
  return isTransactional(subjects) || isPromotional(subjects)
}

