"use client"

import { useState, useEffect, useRef, useCallback, Suspense, useMemo } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { ArrowUp, Loader2, Check, ChevronDown, ChevronUp, Mail, BookOpen, Newspaper } from "lucide-react"

type ChatMessage = {
  id: string
  role: "rune" | "user"
  content: string
  timestamp: number
}

type SlotAllocation = {
  slot: number
  type: "email" | "news" | "lesson"
  focus: string
  priority_senders?: string[]
  rationale?: string
  retrieval_queries?: string[]
  required_terms?: string[][]
  scope_summary?: string
  starting_level?: string
  curriculum_goal?: string
}

type RecommendationData = {
  slot_allocation: SlotAllocation[]
  allocation_notes?: string
  inbox_curation_plan?: {
    priority_senders: string[]
    email_types_to_surface: string[]
    gap_note?: string
  }
  user_facing_summary?: string[]
}

type IntentData = {
  wants_inbox_curation?: boolean
  [key: string]: any
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3 animate-in fade-in duration-200">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
        <span className="text-[11px] font-bold text-white/50 leading-none">R</span>
      </div>
      <div className="pt-1.5">
        <div className="flex gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-white/30 animate-pulse" />
          <span className="h-1.5 w-1.5 rounded-full bg-white/30 animate-pulse" style={{ animationDelay: "200ms" }} />
          <span className="h-1.5 w-1.5 rounded-full bg-white/30 animate-pulse" style={{ animationDelay: "400ms" }} />
        </div>
      </div>
    </div>
  )
}

function RuneMessage({ content }: { content: string }) {
  return (
    <div className="flex items-start gap-3 animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
        <span className="text-[11px] font-bold text-white/50 leading-none">R</span>
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-[15px] leading-[1.65] text-white/85 whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  )
}

function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-blue-600/20 ring-1 ring-blue-500/20 px-4 py-2.5">
        <p className="text-[15px] leading-[1.65] text-white/90 whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  )
}

function GmailButton() {
  return (
    <div className="flex items-start gap-3 animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
        <span className="text-[11px] font-bold text-white/50 leading-none">R</span>
      </div>
      <div className="pt-0.5">
        <a
          href={`/api/connect/gmail/start?redirect=${encodeURIComponent("/onboard?step=scanning")}`}
          className="group inline-flex items-center gap-3 rounded-xl bg-white px-5 py-3 text-[14px] font-medium text-gray-800 shadow-lg shadow-black/20 transition-all hover:shadow-xl hover:shadow-black/30 active:scale-[0.98]"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg>
          Connect Gmail
          <ArrowUp className="h-3.5 w-3.5 -rotate-45 text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </a>
      </div>
    </div>
  )
}

function ScanningIndicator() {
  return (
    <div className="flex items-start gap-3 animate-in fade-in duration-200">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
        <span className="text-[11px] font-bold text-white/50 leading-none">R</span>
      </div>
      <div className="pt-1">
        <div className="flex items-center gap-2.5">
          <div className="h-4 w-4 rounded-full border-2 border-white/20 border-t-white/60 animate-spin" />
          <span className="text-[14px] text-white/50">Reading your inbox&hellip;</span>
        </div>
      </div>
    </div>
  )
}

const SLOT_ICONS: Record<string, React.ReactNode> = {
  email: <Mail className="h-3.5 w-3.5 text-white/30" />,
  news: <Newspaper className="h-3.5 w-3.5 text-white/30" />,
  lesson: <BookOpen className="h-3.5 w-3.5 text-white/30" />,
}

const SLOT_LABELS: Record<string, string> = {
  email: "Inbox Curation",
  news: "Daily Intelligence",
  lesson: "Learning Track",
}

function CompletionScreen() {
  return (
    <div className="animate-in fade-in duration-500 flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/20">
        <Check className="h-8 w-8 text-emerald-400" />
      </div>
      <h2 className="mb-2 text-[20px] font-semibold text-white">You&apos;re all set.</h2>
      <p className="mb-1 text-[15px] text-white/60 leading-relaxed max-w-[320px]">
        Your first delivery arrives tomorrow at 7:00 AM.
      </p>
      <p className="text-[13px] text-white/35 max-w-[280px]">
        Five minutes every morning — that&apos;s all it takes.
      </p>
    </div>
  )
}

const UI_GREETINGS = [
  "Hey, I'm Rune.",
  "Hi, I'm Rune.",
  "Rune here.",
  "Hey there, I'm Rune.",
  "Welcome. I'm Rune.",
]

function GreetingScreen({
  greeting,
  showPrompt,
}: {
  greeting: string
  showPrompt: boolean
}) {
  return (
    <div className="relative flex min-h-full items-center justify-center px-6 pb-32 pt-36 text-center">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <svg
          viewBox="0 0 100 100"
          className="intro-bolt absolute left-1/2 top-1/2 h-[72vh] w-[92vw] -translate-x-1/2 -translate-y-1/2 opacity-0"
          aria-hidden="true"
        >
          <path
            d="M85 2 L66 22 L75 22 L49 51 L58 51 L28 82 L36 82 L18 98"
            fill="none"
            stroke="rgba(172, 120, 255, 0.95)"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="max-w-[320px]">
        <div
          className="text-[34px] font-semibold leading-none text-white sm:text-[40px]"
          style={{
            fontFamily: "var(--font-serif)",
            textShadow: "0 0 30px rgba(255,255,255,0.35), 0 0 60px rgba(180,220,255,0.15), 0 0 8px rgba(255,255,255,0.2)",
          }}
        >
          {greeting}
        </div>
        <div
          className={[
            "mt-5 text-[14px] tracking-[0.08em] text-white/45 transition-all duration-500",
            showPrompt ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2",
          ].join(" ")}
        >
          Click below to begin
        </div>
      </div>
    </div>
  )
}

function RecommendationCard({
  data,
  onApprove,
  approving,
}: {
  data: RecommendationData
  onApprove: () => void
  approving: boolean
}) {
  const [showDetails, setShowDetails] = useState(false)

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 mt-2">
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 backdrop-blur-sm">
        {data.user_facing_summary && data.user_facing_summary.length > 0 && (
          <div className="mb-4 space-y-2">
            {data.user_facing_summary.map((line, i) => (
              <div key={i} className="flex items-start gap-2.5 text-[13px] text-white/70">
                <Check className="h-3.5 w-3.5 text-emerald-400/70 shrink-0 mt-0.5" />
                <span>{line}</span>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => setShowDetails(!showDetails)}
          className="mb-3 flex items-center gap-1 text-[12px] text-white/30 hover:text-white/50 transition-colors"
        >
          {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {showDetails ? "Hide details" : "Show details"}
        </button>

        {showDetails && (
          <div className="mb-4 space-y-3">
            {data.slot_allocation.map((slot) => (
              <div key={slot.slot} className="rounded-lg bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/[0.05]">
                <div className="flex items-center gap-2 mb-1">
                  {SLOT_ICONS[slot.type] || null}
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/40">
                    {SLOT_LABELS[slot.type] || slot.type}
                  </span>
                </div>
                <p className="text-[13px] font-medium text-white/70">{slot.focus}</p>
                {slot.rationale && (
                  <p className="mt-1 text-[12px] text-white/30">{slot.rationale}</p>
                )}
                {slot.scope_summary && (
                  <p className="mt-1 text-[12px] text-white/30 leading-relaxed">{slot.scope_summary}</p>
                )}
                {slot.curriculum_goal && (
                  <p className="mt-1 text-[12px] text-white/30">{slot.curriculum_goal}</p>
                )}
              </div>
            ))}

            {data.inbox_curation_plan?.gap_note && (
              <p className="text-[12px] text-amber-400/60 px-1">{data.inbox_curation_plan.gap_note}</p>
            )}
          </div>
        )}

        <div className="mb-4 rounded-lg bg-blue-500/[0.06] px-3 py-2 ring-1 ring-blue-400/10">
          <p className="text-[12px] text-blue-300/60">First delivery arrives tomorrow at 7:00 AM</p>
        </div>

        <p className="mb-3 text-[12px] text-white/30 text-center">
          Adjust anything by typing below, or lock it in.
        </p>

        <button
          onClick={onApprove}
          disabled={approving}
          className="w-full rounded-xl bg-white py-3 text-[14px] font-semibold text-[#07070d] transition-all hover:bg-white/90 active:scale-[0.98] disabled:opacity-50"
        >
          {approving ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Setting up&hellip;
            </span>
          ) : (
            "Looks good"
          )}
        </button>
      </div>
    </div>
  )
}

function OnboardFlow() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [typing, setTyping] = useState(false)

  const [phase, setPhase] = useState<"conversation" | "gmail_connect" | "scanning" | "recommendation" | "approved">("conversation")
  const [intentData, setIntentData] = useState<IntentData | null>(null)
  const [recommendationData, setRecommendationData] = useState<RecommendationData | null>(null)
  const [approving, setApproving] = useState(false)
  const [showGreetingPrompt, setShowGreetingPrompt] = useState(false)
  const [conversationStarted, setConversationStarted] = useState(false)

  const conversationHistory = useRef<Array<{ role: "user" | "assistant"; content: string }>>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const initDone = useRef(false)
  const openingRequested = useRef(false)
  const greeting = useMemo(
    () => UI_GREETINGS[Math.floor(Math.random() * UI_GREETINGS.length)],
    []
  )

  const scrollToBottom = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }), 100)
  }, [])

  const addRuneMessage = useCallback((content: string) => {
    setMessages((prev) => [...prev, { id: uid(), role: "rune", content, timestamp: Date.now() }])
    conversationHistory.current.push({ role: "assistant", content })
    scrollToBottom()
  }, [scrollToBottom])

  useEffect(() => {
    if (initDone.current) return
    initDone.current = true

    const stepParam = searchParams.get("step")
    if (stepParam === "scanning") {
      try {
        const saved = sessionStorage.getItem("rune_onboard_messages")
        if (saved) {
          const restored = JSON.parse(saved) as ChatMessage[]
          setMessages(restored)
          for (const m of restored) {
            conversationHistory.current.push({
              role: m.role === "rune" ? "assistant" : "user",
              content: m.content
            })
          }
        }
        const savedIntent = sessionStorage.getItem("rune_onboard_intent")
        if (savedIntent) setIntentData(JSON.parse(savedIntent))
      } catch {}
      setConversationStarted(true)
      setPhase("scanning")
      runInboxScan()
      return
    }

    const timer = window.setTimeout(() => setShowGreetingPrompt(true), 600)
    return () => window.clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchOpening() {
    if (openingRequested.current) return
    openingRequested.current = true
    setConversationStarted(true)
    setTyping(true)
    try {
      const res = await fetch("/api/onboard/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ init: true })
      })
      if (res.status === 401) { router.push("/auth?redirectedFrom=/onboard"); return }
      const data = await res.json()
      setTyping(false)
      if (data.ok && data.rune_message) {
        addRuneMessage(data.rune_message)
      } else {
        addRuneMessage("Hey — something went wrong on my end. Refresh and let's try again.")
      }
    } catch {
      setTyping(false)
      addRuneMessage("Hey — something went wrong on my end. Refresh and let's try again.")
    }
  }

  function beginConversation() {
    if (phase !== "conversation" || conversationStarted || messages.length > 0) return
    setShowGreetingPrompt(false)
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" })
    fetchOpening()
  }

  async function handleSend() {
    const msg = input.trim()
    if (!msg || loading) return

    setInput("")
    if (inputRef.current) inputRef.current.style.height = "auto"
    setMessages((prev) => [...prev, { id: uid(), role: "user", content: msg, timestamp: Date.now() }])
    conversationHistory.current.push({ role: "user", content: msg })
    scrollToBottom()

    setLoading(true)
    setTyping(true)

    try {
      const currentPhase = recommendationData ? "recommendation" : "conversation"
      const res = await fetch("/api/onboard/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phase: currentPhase,
          message: msg,
          conversation_history: conversationHistory.current.slice(0, -1)
        })
      })
      if (res.status === 401) { router.push("/auth?redirectedFrom=/onboard"); return }
      const data = await res.json()
      setTyping(false)

      if (!data.ok) {
        addRuneMessage("Sorry, something went wrong. Try sending that again.")
        return
      }

      addRuneMessage(data.rune_message)

      if (data.signal === "intent_ready") {
        const intent = data.intent_data || {}
        setIntentData(intent)

        if (intent.inbox_preferences?.wants_inbox_curation === false) {
          setTimeout(() => injectScanResults(null), 500)
        } else {
          try {
            sessionStorage.setItem("rune_onboard_messages", JSON.stringify([
              ...messages,
              { id: uid(), role: "user", content: msg, timestamp: Date.now() },
              { id: uid(), role: "rune", content: data.rune_message, timestamp: Date.now() }
            ]))
            sessionStorage.setItem("rune_onboard_intent", JSON.stringify(intent))
          } catch {}
          setTimeout(() => {
            setPhase("gmail_connect")
            scrollToBottom()
          }, 1000)
        }
      } else if (data.signal === "recommendation_ready") {
        handleRecommendationSignal(data.recommendation_data)
      }
    } catch {
      setTyping(false)
      addRuneMessage("Connection issue — try again in a moment.")
    } finally {
      setLoading(false)
    }
  }

  async function runInboxScan() {
    setTyping(true)
    addRuneMessage("Gmail connected. Reading your inbox now...")

    try {
      const res = await fetch("/api/onboard/scan-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      })
      if (res.status === 401) { router.push("/auth?redirectedFrom=/onboard"); return }
      const scanData = await res.json()

      setTyping(false)

      if (scanData.ok) {
        addRuneMessage(`Found ${scanData.relevant_senders || 0} relevant senders in your inbox.`)
        await injectScanResults(scanData.scan_summary)
      } else {
        addRuneMessage("Had trouble scanning your inbox. Let me build your setup without it.")
        await injectScanResults(null)
      }
    } catch {
      setTyping(false)
      addRuneMessage("Inbox scan hit an issue. Building your setup without inbox data.")
      await injectScanResults(null)
    }
  }

  async function injectScanResults(scanSummary: any) {
    setPhase("recommendation")
    setLoading(true)
    setTyping(true)

    const systemMessage = scanSummary
      ? `[SYSTEM: Inbox scan complete. Results:\n${JSON.stringify(scanSummary)}\n\nNow generate the user's recommendation. Address them directly. Show them what you'd build based on everything in this conversation plus the inbox results. End with the configuration JSON block.]`
      : `[SYSTEM: User does not want inbox curation OR inbox scan failed. No inbox data available.\n\nNow generate the user's recommendation. Address them directly. Show them what you'd build based on everything in this conversation. End with the configuration JSON block.]`

    try {
      const res = await fetch("/api/onboard/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phase: "recommendation",
          message: systemMessage,
          conversation_history: conversationHistory.current
        })
      })
      const data = await res.json()
      setTyping(false)

      if (data.ok) {
        addRuneMessage(data.rune_message)

        if (data.signal === "recommendation_ready") {
          handleRecommendationSignal(data.recommendation_data)
        }
      } else {
        addRuneMessage("Something went wrong generating your recommendation. Try refreshing.")
      }
    } catch {
      setTyping(false)
      addRuneMessage("Connection issue. Try refreshing the page.")
    } finally {
      setLoading(false)
    }
  }

  async function handleRecommendationSignal(recData: any) {
    if (!recData) return
    setRecommendationData(recData)
    setPhase("recommendation")
    scrollToBottom()

    try {
      await fetch("/api/onboard/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendation: recData })
      })
    } catch {
      console.error("Failed to store recommendation")
    }
  }

  async function handleApprove() {
    if (!recommendationData || approving) return
    setApproving(true)

    try {
      const config = {
        slot_allocation: recommendationData.slot_allocation,
        inbox_curation_plan: recommendationData.inbox_curation_plan || null,
        digest_preferences: {
          delivery_time: "07:00",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York"
        }
      }

      const res = await fetch("/api/onboard/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config })
      })
      const data = await res.json()

      if (data.ok) {
        setPhase("approved")
        try { sessionStorage.removeItem("rune_onboard_messages"); sessionStorage.removeItem("rune_onboard_intent") } catch {}
      } else {
        addRuneMessage("Something went wrong saving your config. Try again.")
      }
    } catch {
      addRuneMessage("Connection issue during setup. Try the button again.")
    } finally {
      setApproving(false)
    }
  }

  const showInput = phase === "conversation" || (phase === "recommendation" && !approving && recommendationData !== null)
  const showGreeting = phase === "conversation" && !conversationStarted && messages.length === 0

  function handleTextareaInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
    const el = e.target
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 120) + "px"
  }

  return (
    <div className="fixed inset-0 z-40 h-[100dvh]" style={{ background: "#07070d" }}>

      {phase === "approved" ? (
        <div className="flex h-full items-center justify-center">
          <CompletionScreen />
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="absolute inset-0 overflow-y-auto overscroll-contain"
        >
          <div className="mx-auto max-w-[560px] px-4 pb-32 pt-28 sm:px-5 sm:pb-36 sm:pt-20">
            {showGreeting ? (
              <GreetingScreen greeting={greeting} showPrompt={showGreetingPrompt} />
            ) : (
              <div className="space-y-5">
                {messages.map((msg) =>
                  msg.role === "rune" ? (
                    <RuneMessage key={msg.id} content={msg.content} />
                  ) : (
                    <UserMessage key={msg.id} content={msg.content} />
                  )
                )}

                {typing && <TypingIndicator />}
                {phase === "gmail_connect" && !loading && <GmailButton />}
                {phase === "scanning" && typing && <ScanningIndicator />}
                {recommendationData && phase === "recommendation" && (
                  <RecommendationCard
                    data={recommendationData}
                    onApprove={handleApprove}
                    approving={approving}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {showInput && (
        <div className="fixed inset-x-0 bottom-0 z-50 px-2 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2 sm:px-5">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
          <div className="mx-auto w-[calc(100%-8px)] max-w-[420px] sm:w-full sm:max-w-[460px]">
            <div
              className="flex items-center gap-2 rounded-2xl bg-[#12121a] ring-1 ring-white/[0.08] px-3 py-2.5 sm:px-4 sm:py-3 focus-within:ring-white/[0.15] transition-all"
              onClick={beginConversation}
            >
              <textarea
                ref={inputRef}
                value={input}
                onFocus={beginConversation}
                onChange={handleTextareaInput}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                placeholder="Message Rune..."
                disabled={loading}
                rows={1}
                className="flex-1 resize-none bg-transparent text-[16px] text-white placeholder-white/25 outline-none disabled:opacity-50 leading-relaxed max-h-[100px]"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || loading}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[#07070d] transition-all hover:bg-white/90 active:scale-95 disabled:opacity-20 disabled:bg-white/40"
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5 stroke-[2.5]" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function OnboardPage() {
  return (
    <Suspense fallback={
      <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ background: "#07070d" }}>
        <div className="h-5 w-5 rounded-full border-2 border-white/10 border-t-white/40 animate-spin" />
      </div>
    }>
      <OnboardFlow />
    </Suspense>
  )
}
