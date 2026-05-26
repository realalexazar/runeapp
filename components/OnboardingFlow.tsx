"use client"

import { useState, useCallback } from "react"
import ConnectGmailCard from "./ConnectGmailCard"
import BackfillParseControls from "./BackfillParseControls"
import NewsletterSelectionCard from "./NewsletterSelectionCard"
import CadenceSelectionCard from "./CadenceSelectionCard"
import TimeSelectionCard from "./TimeSelectionCard"
import StyleSelectionCard from "./StyleSelectionCard"

type OnboardingStep = 1 | 2

type Step2Progress = {
  cadenceSelected: boolean
  timeSelected: boolean
}

type OnboardingFlowProps = {
  isConnected: boolean
}

export default function OnboardingFlow({ isConnected }: OnboardingFlowProps) {
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>(1)
  const [step2Progress, setStep2Progress] = useState<Step2Progress>({
    // MVP lock: cadence is fixed to daily, so cadence is always "selected".
    cadenceSelected: true,
    timeSelected: false
  })
  const [selectedCadence, setSelectedCadence] = useState<string | null>("daily")
  const [selectedTimes, setSelectedTimes] = useState<string[]>([])
  const [selectedTimezone, setSelectedTimezone] = useState<string>("UTC")

  // Note: Config check is handled in DashboardPage (server-side)
  // This component only handles the onboarding flow

  const handleNewsletterFinalized = useCallback(() => {
    setOnboardingStep(2)
  }, [])

  const handleCadenceSelected = (cadence: string) => {
    setSelectedCadence(cadence)
    setStep2Progress(prev => ({ ...prev, cadenceSelected: true }))
    
    // Reset times when cadence changes
    if (cadence === 'twice-daily') {
      setSelectedTimes(['08:00', '20:00'])
    } else {
      setSelectedTimes(['08:00'])
    }
  }

  const handleTimeSelected = useCallback((times: string[], timezone: string) => {
    setSelectedTimes(times)
    setSelectedTimezone(timezone)
    setStep2Progress(prev => ({ ...prev, timeSelected: true }))
  }, [])

  const handleBackToStep1 = () => {
    setOnboardingStep(1)
    setStep2Progress({
      cadenceSelected: true,
      timeSelected: false
    })
    setSelectedCadence("daily")
    setSelectedTimes([])
  }

  // Step 1: Newsletter Selection
  if (onboardingStep === 1) {
    return (
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        <ConnectGmailCard isConnected={isConnected} />
        <BackfillParseControls />
        <NewsletterSelectionCard onFinalized={handleNewsletterFinalized} />
      </div>
    )
  }

  // Step 2: Digest Configuration (progressive disclosure)
  return (
    <>
      {/* Back Button */}
      <div className="mb-4">
        <button
          onClick={handleBackToStep1}
          className="text-white/60 hover:text-white/80 transition-colors flex items-center gap-2"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back to Newsletter Selection
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Card 1: Cadence Selection (always visible in Step 2) */}
        <CadenceSelectionCard
          selectedCadence={selectedCadence}
          onSelect={handleCadenceSelected}
        />

        {/* Card 2: Time Selection (appears after cadence selected) */}
        {step2Progress.cadenceSelected && selectedCadence && (
          <TimeSelectionCard
            cadence={selectedCadence}
            selectedTimes={selectedTimes}
            selectedTimezone={selectedTimezone}
            onSelect={handleTimeSelected}
          />
        )}

        {/* Card 3: Style Selection (appears after time selected) */}
        {step2Progress.timeSelected && (
          <StyleSelectionCard
            cadence={selectedCadence!}
            sendTimes={selectedTimes}
            timezone={selectedTimezone}
            onComplete={() => {
              // Navigate to post-onboarding dashboard
              window.location.href = '/dashboard'
            }}
          />
        )}
      </div>
    </>
  )
}
