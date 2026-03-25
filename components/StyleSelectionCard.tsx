"use client"

import { useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"

const DEFAULT_MODULE_FLAGS = {
  enable_newsletter_digest: true,
  enable_daily_news_topics: false,
  enable_daily_lessons: false
} as const
type ModuleFlagState = {
  enable_newsletter_digest: boolean
  enable_daily_news_topics: boolean
  enable_daily_lessons: boolean
}

const DEFAULT_MODULE_DEFAULTS = {
  news_topic_timeframe: "24h",
  lesson_frequency: "daily",
  lesson_curriculum_days: 10
} as const

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

type ChatMessage = {
  role: "assistant" | "user"
  content: string
}
type ChatStep = "news" | "lesson" | "curriculum"
type LessonCurriculumPlan = Record<string, any> | null
type NewsCoveragePreview = {
  bucket: "high" | "moderate" | "likely_sparse"
  relevant_count: number
  candidate_count: number
  query: string
  sample_titles: string[]
} | null

function getApiErrorMessage(data: any, fallback: string) {
  if (data?.retryable && typeof data?.error === "string") {
    return `${data.error} You can retry your last message.`
  }
  return data?.error || fallback
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
  const [moduleFlags, setModuleFlags] = useState<ModuleFlagState>({
    ...DEFAULT_MODULE_FLAGS
  })
  const [newsTopic, setNewsTopic] = useState("")
  const [lessonTopic, setLessonTopic] = useState("")
  const [newsClarifierLoading, setNewsClarifierLoading] = useState(false)
  const [lessonClarifierLoading, setLessonClarifierLoading] = useState(false)
  const [chatSequenceOpen, setChatSequenceOpen] = useState(false)
  const [chatSequenceStep, setChatSequenceStep] = useState<ChatStep>("news")
  const [newsChatMessages, setNewsChatMessages] = useState<ChatMessage[]>([])
  const [lessonChatMessages, setLessonChatMessages] = useState<ChatMessage[]>([])
  const [newsChatInput, setNewsChatInput] = useState("")
  const [lessonChatInput, setLessonChatInput] = useState("")
  const [newsScopeSummary, setNewsScopeSummary] = useState<string | null>(null)
  const [newsCoveragePreview, setNewsCoveragePreview] = useState<NewsCoveragePreview>(null)
  const [newsCoveragePreviewLoading, setNewsCoveragePreviewLoading] = useState(false)
  const [newsCoveragePreviewError, setNewsCoveragePreviewError] = useState<string | null>(null)
  const [lessonScopeSummary, setLessonScopeSummary] = useState<string | null>(null)
  const [lessonCurriculumPlan, setLessonCurriculumPlan] = useState<LessonCurriculumPlan>(null)
  const [lessonCurriculumLoading, setLessonCurriculumLoading] = useState(false)
  const [lessonCurriculumError, setLessonCurriculumError] = useState<string | null>(null)
  const [newsClarifierDone, setNewsClarifierDone] = useState(false)
  const [lessonClarifierDone, setLessonClarifierDone] = useState(false)
  const [newsClarifierError, setNewsClarifierError] = useState<string | null>(null)
  const [lessonClarifierError, setLessonClarifierError] = useState<string | null>(null)

  const getEnabledChatSteps = (): ChatStep[] => {
    const steps: ChatStep[] = []
    if (moduleFlags.enable_daily_news_topics) steps.push("news")
    if (moduleFlags.enable_daily_lessons) {
      steps.push("lesson")
      steps.push("curriculum")
    }
    return steps
  }

  const getNextStep = (current: ChatStep): ChatStep | null => {
    const steps = getEnabledChatSteps()
    const idx = steps.indexOf(current)
    if (idx < 0) return null
    return steps[idx + 1] || null
  }

  const handleContinue = () => {
    if (!selectedStyle) {
      setError("Please select a digest style")
      return
    }
    if (moduleFlags.enable_daily_news_topics && !newsTopic.trim()) {
      setError("Add one daily news topic or turn the module off.")
      return
    }
    if (moduleFlags.enable_daily_lessons && !lessonTopic.trim()) {
      setError("Add one learning topic or turn the module off.")
      return
    }
    setShowNameModal(true)
  }

  const handleFinalSubmit = async () => {
    setSaving(true)
    setError(null)

    try {
      const newsTranscript = newsChatMessages
        .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
        .join("\n")
      const lessonTranscript = lessonChatMessages
        .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
        .join("\n")

      const res = await fetch("/api/digest/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          cadence,
          send_time: sendTimes,
          timezone,
          style: selectedStyle,
          rune_name: runeName.trim() || null,
          module_flags: moduleFlags,
          module_defaults: DEFAULT_MODULE_DEFAULTS,
          news_topic: newsTopic.trim() || null,
          lesson_topic: lessonTopic.trim() || null,
          news_topic_clarification: newsScopeSummary || newsTranscript || null,
          lesson_topic_clarification: lessonScopeSummary || lessonTranscript || null,
          lesson_curriculum_plan: lessonCurriculumPlan
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

  const callNewsClarifier = async (history: ChatMessage[]) => {
    const res = await fetch("/api/onboard/clarify-news-topic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        news_topic: newsTopic.trim() || null,
        history
      })
    })
    const data = await res.json()
    if (!res.ok || !data.ok) throw new Error(getApiErrorMessage(data, "News clarifier failed"))
    const assistantMessage = String(data.assistant_message || "").trim()
    if (assistantMessage) {
      setNewsChatMessages((prev) => [...prev, { role: "assistant", content: assistantMessage }])
    }
    const done = !!data.done
    setNewsClarifierDone(done)
    setNewsScopeSummary(data.news_scope || null)
    return done
  }

  const callLessonClarifier = async (history: ChatMessage[]) => {
    const res = await fetch("/api/onboard/clarify-lesson-topic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        lesson_topic: lessonTopic.trim() || null,
        history
      })
    })
    const data = await res.json()
    if (!res.ok || !data.ok) throw new Error(getApiErrorMessage(data, "Lesson clarifier failed"))
    const assistantMessage = String(data.assistant_message || "").trim()
    if (assistantMessage) {
      setLessonChatMessages((prev) => [...prev, { role: "assistant", content: assistantMessage }])
    }
    const done = !!data.done
    setLessonClarifierDone(done)
    setLessonScopeSummary(data.lesson_scope || null)
    return done
  }

  const primeStep = async (step: ChatStep) => {
    if (step === "news") {
      if (!newsTopic.trim() || newsChatMessages.length > 0) return
      setNewsClarifierLoading(true)
      setNewsClarifierError(null)
      try {
        await callNewsClarifier([])
      } catch (e: any) {
        setNewsClarifierError(e?.message || "Failed to generate news clarifier question")
      } finally {
        setNewsClarifierLoading(false)
      }
      return
    }

    if (step === "curriculum") return

    if (!lessonTopic.trim() || lessonChatMessages.length > 0) return
    setLessonClarifierLoading(true)
    setLessonClarifierError(null)
    try {
      await callLessonClarifier([])
    } catch (e: any) {
      setLessonClarifierError(e?.message || "Failed to generate lesson clarifier question")
    } finally {
      setLessonClarifierLoading(false)
    }
  }

  const handleInitiateChatSequence = async () => {
    const steps = getEnabledChatSteps()
    if (steps.length === 0) return

    setError(null)
    setChatSequenceStep(steps[0])
    setChatSequenceOpen(true)
    await primeStep(steps[0])
  }

  const handleAdvanceSequence = async () => {
    const next = getNextStep(chatSequenceStep)
    if (!next) {
      setChatSequenceOpen(false)
      return
    }
    setChatSequenceStep(next)
    await primeStep(next)
  }

  const generateLessonCurriculum = async (scopeInput?: string) => {
    setLessonCurriculumLoading(true)
    setLessonCurriculumError(null)
    try {
      const curriculumRes = await fetch("/api/onboard/generate-lesson-curriculum", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          lesson_topic: lessonTopic.trim() || null,
          lesson_scope: scopeInput || lessonScopeSummary || lessonChatMessages.map((m) => `${m.role}: ${m.content}`).join("\n"),
          curriculum_days: Number(DEFAULT_MODULE_DEFAULTS.lesson_curriculum_days || 10)
        })
      })
      const curriculumData = await curriculumRes.json()
      if (!curriculumRes.ok || !curriculumData.ok) {
        throw new Error(getApiErrorMessage(curriculumData, "Failed to generate curriculum"))
      }
      setLessonCurriculumPlan(curriculumData.curriculum || null)
      return true
    } catch (e: any) {
      setLessonCurriculumError(e?.message || "Failed to generate curriculum")
      return false
    } finally {
      setLessonCurriculumLoading(false)
    }
  }

  const fetchNewsCoveragePreview = async (scopeInput?: string) => {
    if (!newsTopic.trim()) return
    setNewsCoveragePreviewLoading(true)
    setNewsCoveragePreviewError(null)
    try {
      const res = await fetch("/api/onboard/preview-news-topic-density", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          news_topic: newsTopic.trim(),
          news_scope: scopeInput || newsScopeSummary || newsTopic.trim()
        })
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to preview coverage")
      }
      setNewsCoveragePreview(data.preview || null)
    } catch (e: any) {
      setNewsCoveragePreviewError(e?.message || "Failed to preview coverage")
    } finally {
      setNewsCoveragePreviewLoading(false)
    }
  }

  const handleSendNewsChatMessage = async () => {
    if (!newsChatInput.trim() || newsClarifierLoading) return
    const userMsg: ChatMessage = { role: "user", content: newsChatInput.trim() }
    setNewsChatMessages((prev) => [...prev, userMsg])
    setNewsChatInput("")
    setNewsClarifierLoading(true)
    setNewsClarifierError(null)
    try {
      const done = await callNewsClarifier([...newsChatMessages, userMsg])
      if (done) {
        await fetchNewsCoveragePreview([...newsChatMessages, userMsg].map((m) => `${m.role}: ${m.content}`).join("\n"))
      }
      if (done && chatSequenceOpen && chatSequenceStep === "news") {
        await handleAdvanceSequence()
      }
    } catch (e: any) {
      setNewsClarifierError(e?.message || "News clarifier failed")
    } finally {
      setNewsClarifierLoading(false)
    }
  }

  const handleSendLessonChatMessage = async () => {
    if (!lessonChatInput.trim() || lessonClarifierLoading) return
    const userMsg: ChatMessage = { role: "user", content: lessonChatInput.trim() }
    setLessonChatMessages((prev) => [...prev, userMsg])
    setLessonChatInput("")
    setLessonClarifierLoading(true)
    setLessonClarifierError(null)
    try {
      const done = await callLessonClarifier([...lessonChatMessages, userMsg])
      let curriculumReady = !!lessonCurriculumPlan
      if (done && !lessonCurriculumPlan) {
        curriculumReady = await generateLessonCurriculum([...lessonChatMessages, userMsg].map((m) => `${m.role}: ${m.content}`).join("\n"))
      }
      if (done && curriculumReady && chatSequenceOpen && chatSequenceStep === "lesson") {
        await handleAdvanceSequence()
      }
    } catch (e: any) {
      setLessonClarifierError(e?.message || "Lesson clarifier failed")
    } finally {
      setLessonClarifierLoading(false)
    }
  }

  const enabledChatSteps = getEnabledChatSteps()
  const sequenceStepIndex = enabledChatSteps.indexOf(chatSequenceStep) + 1
  const sequenceStepTotal = enabledChatSteps.length || 1
  const newsHasNextStep = getNextStep("news") !== null
  const lessonHasNextStep = getNextStep("lesson") !== null

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

      <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-white">Content Modules</h3>
          <p className="mt-1 text-xs text-white/60">
            Choose optional modules. Alpha supports 1 news topic and 1 learning topic.
          </p>
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={moduleFlags.enable_daily_news_topics}
            onChange={(e) => setModuleFlags(prev => ({ ...prev, enable_daily_news_topics: e.target.checked }))}
            className="mt-1 h-4 w-4 rounded border-white/20 bg-white/5"
          />
          <div className="flex-1">
            <div className="text-sm text-white">Daily News Topic</div>
            <div className="text-xs text-white/60">One substantive daily brief with references.</div>
          </div>
        </label>

        {moduleFlags.enable_daily_news_topics && (
          <input
            type="text"
            value={newsTopic}
            onChange={(e) => {
              setNewsTopic(e.target.value)
              setNewsCoveragePreview(null)
              setNewsCoveragePreviewError(null)
            }}
            onBlur={() => {
              if (newsTopic.trim()) {
                fetchNewsCoveragePreview(newsTopic.trim())
              }
            }}
            placeholder="e.g., AI regulation in U.S. and EU"
            className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/20"
          />
        )}

        {moduleFlags.enable_daily_news_topics && newsCoveragePreviewLoading && (
          <div className="text-xs text-white/50">Estimating how much daily coverage this topic is likely to have...</div>
        )}
        {moduleFlags.enable_daily_news_topics && newsCoveragePreview && !newsCoveragePreviewLoading && (
          <div className={`rounded-lg border p-3 text-xs ${
            newsCoveragePreview.bucket === "high"
              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
              : newsCoveragePreview.bucket === "moderate"
                ? "border-blue-500/20 bg-blue-500/10 text-blue-100"
                : "border-amber-500/20 bg-amber-500/10 text-amber-100"
          }`}>
            <div className="font-medium">
              Expected coverage: {newsCoveragePreview.bucket === "high" ? "High" : newsCoveragePreview.bucket === "moderate" ? "Moderate" : "Likely sparse"}
            </div>
            <div className="mt-1">
              {newsCoveragePreview.bucket === "likely_sparse"
                ? "You may get updates some days, not every day."
                : "This topic looks likely to produce meaningful updates with the current scope."}
            </div>
          </div>
        )}
        {moduleFlags.enable_daily_news_topics && newsCoveragePreviewError && (
          <div className="text-xs text-amber-300">{newsCoveragePreviewError}</div>
        )}

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={moduleFlags.enable_daily_lessons}
            onChange={(e) => {
              const enabled = e.target.checked
              setModuleFlags(prev => ({ ...prev, enable_daily_lessons: enabled }))
              if (!enabled) {
                setLessonCurriculumPlan(null)
                setLessonCurriculumError(null)
              }
            }}
            className="mt-1 h-4 w-4 rounded border-white/20 bg-white/5"
          />
          <div className="flex-1">
            <div className="text-sm text-white">Daily Lesson</div>
            <div className="text-xs text-white/60">10-day curriculum. You can pause, switch topic, or mark done.</div>
          </div>
        </label>

        {moduleFlags.enable_daily_lessons && (
          <input
            type="text"
            value={lessonTopic}
            onChange={(e) => {
              setLessonTopic(e.target.value)
              setLessonCurriculumPlan(null)
              setLessonCurriculumError(null)
            }}
            placeholder="e.g., How monetary policy impacts markets"
            className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/20"
          />
        )}

        {(moduleFlags.enable_daily_news_topics || moduleFlags.enable_daily_lessons) && (
          <button
            onClick={handleInitiateChatSequence}
            type="button"
            disabled={(moduleFlags.enable_daily_news_topics && !newsTopic.trim()) || (moduleFlags.enable_daily_lessons && !lessonTopic.trim()) || newsClarifierLoading || lessonClarifierLoading}
            className="w-full px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium text-white"
          >
            {(newsClarifierLoading || lessonClarifierLoading) ? "Thinking..." : "Initiate Chat Sequence"}
          </button>
        )}
        {(newsScopeSummary || lessonScopeSummary) && (
          <div className="text-xs text-white/70 space-y-1">
            {newsScopeSummary && <p><span className="text-white/50">News scope:</span> {newsScopeSummary}</p>}
            {lessonScopeSummary && <p><span className="text-white/50">Lesson scope:</span> {lessonScopeSummary}</p>}
          </div>
        )}
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

      {/* Chat Sequence Modal (mobile-flow emulation) */}
      <Dialog.Root open={chatSequenceOpen} onOpenChange={setChatSequenceOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-white/5 p-4 shadow-2xl backdrop-blur-md">
            <Dialog.Title className="text-base font-medium text-white mb-1">
              {chatSequenceStep === "news"
                ? "News Scope Chat"
                : chatSequenceStep === "lesson"
                  ? "Lesson Scope Chat"
                  : "Curriculum Preview"}
            </Dialog.Title>
            <Dialog.Description className="text-xs text-white/60 mb-3">
              Step {sequenceStepIndex}/{sequenceStepTotal}: {chatSequenceStep === "news"
                ? "Narrow your daily news brief."
                : chatSequenceStep === "lesson"
                  ? "Finalize your 10-day lesson scope."
                  : "Review your generated 10-day curriculum."}
            </Dialog.Description>

            {chatSequenceStep === "news" ? (
              <div className="space-y-3">
                <div className="space-y-2 max-h-56 overflow-auto pr-1">
                  {newsChatMessages.length === 0 && (
                    <div className="text-sm text-white/50">Generating first question...</div>
                  )}
                  {newsChatMessages.map((m, i) => (
                    <div key={i} className={`rounded-lg px-3 py-2 text-sm ${m.role === "assistant" ? "bg-white/10 text-white" : "bg-emerald-500/20 text-emerald-100 ml-6"}`}>
                      {m.content}
                    </div>
                  ))}
                </div>
                {newsClarifierError && (
                  <div className="text-xs text-red-300">{newsClarifierError}</div>
                )}
                {newsClarifierDone && (
                  <div className="text-xs text-emerald-300">News scope finalized.</div>
                )}
                <div className="flex gap-2">
                  <input
                    value={newsChatInput}
                    onChange={(e) => setNewsChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        handleSendNewsChatMessage()
                      }
                    }}
                    placeholder="Reply about news scope..."
                    className="flex-1 px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/20"
                  />
                  <button
                    type="button"
                    onClick={handleSendNewsChatMessage}
                    disabled={newsClarifierLoading || !newsChatInput.trim()}
                    className="px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 disabled:opacity-50 text-white text-sm font-medium"
                  >
                    Send
                  </button>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleAdvanceSequence}
                    disabled={!newsClarifierDone}
                    className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50 text-xs text-white"
                  >
                    {newsHasNextStep ? "Continue to Lessons" : "Finish sequence"}
                  </button>
                </div>
              </div>
            ) : chatSequenceStep === "lesson" ? (
              <div className="space-y-3">
                <div className="space-y-2 max-h-56 overflow-auto pr-1">
                  {lessonChatMessages.length === 0 && (
                    <div className="text-sm text-white/50">Generating first question...</div>
                  )}
                  {lessonChatMessages.map((m, i) => (
                    <div key={i} className={`rounded-lg px-3 py-2 text-sm ${m.role === "assistant" ? "bg-white/10 text-white" : "bg-emerald-500/20 text-emerald-100 ml-6"}`}>
                      {m.content}
                    </div>
                  ))}
                </div>
                {lessonClarifierError && (
                  <div className="text-xs text-red-300">{lessonClarifierError}</div>
                )}
                {lessonClarifierDone && (
                  <div className="text-xs text-emerald-300">Lesson scope finalized.</div>
                )}
                {lessonCurriculumLoading && (
                  <div className="text-xs text-white/60">Generating 10-day curriculum plan...</div>
                )}
                {lessonCurriculumPlan && !lessonCurriculumLoading && (
                  <div className="text-xs text-emerald-300">Curriculum draft generated and ready to save.</div>
                )}
                {lessonCurriculumError && (
                  <div className="text-xs text-amber-300">{lessonCurriculumError}</div>
                )}
                <div className="flex gap-2">
                  <input
                    value={lessonChatInput}
                    onChange={(e) => setLessonChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        handleSendLessonChatMessage()
                      }
                    }}
                    placeholder="Reply about lesson scope..."
                    className="flex-1 px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/20"
                  />
                  <button
                    type="button"
                    onClick={handleSendLessonChatMessage}
                    disabled={lessonClarifierLoading || !lessonChatInput.trim()}
                    className="px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 disabled:opacity-50 text-white text-sm font-medium"
                  >
                    Send
                  </button>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleAdvanceSequence}
                    disabled={!lessonClarifierDone || lessonCurriculumLoading || !lessonCurriculumPlan}
                    className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50 text-xs text-white"
                  >
                    {lessonHasNextStep ? "Review Curriculum" : "Finish sequence"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {lessonCurriculumLoading && (
                  <div className="text-sm text-white/60">Generating curriculum preview...</div>
                )}
                {lessonCurriculumError && (
                  <div className="space-y-2">
                    <div className="text-xs text-amber-300">{lessonCurriculumError}</div>
                    <button
                      type="button"
                      onClick={() => generateLessonCurriculum()}
                      disabled={lessonCurriculumLoading}
                      className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50 text-xs text-white"
                    >
                      Retry curriculum generation
                    </button>
                  </div>
                )}

                {lessonCurriculumPlan && (
                  <div className="space-y-2 max-h-64 overflow-auto pr-1">
                    <div className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white">
                      <div className="font-medium">{String(lessonCurriculumPlan.curriculum_title || "10-day curriculum")}</div>
                      <div className="text-xs text-white/70 mt-1">
                        Level: {String(lessonCurriculumPlan.target_level || "beginner")} · {String(lessonCurriculumPlan.day_count || 10)} days
                      </div>
                    </div>
                    {Array.isArray(lessonCurriculumPlan.days) && lessonCurriculumPlan.days.map((day: any) => (
                      <div key={String(day?.day)} className="rounded-lg bg-black/20 border border-white/10 px-3 py-2">
                        <div className="text-xs text-white/60">Day {String(day?.day || "")}</div>
                        <div className="text-sm text-white">{String(day?.lesson_title || "")}</div>
                        <div className="text-xs text-white/70 mt-1">{String(day?.objective || "")}</div>
                      </div>
                    ))}
                    <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white/80">
                      <span className="text-white/60">Completion signal:</span> {String(lessonCurriculumPlan.completion_signal || "")}
                    </div>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleAdvanceSequence}
                    disabled={!lessonCurriculumPlan}
                    className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50 text-xs text-white"
                  >
                    Finish sequence
                  </button>
                </div>
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

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
