"use client"

import { useState, useEffect, useRef, useCallback, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { ArrowUp, Loader2, Check, ChevronDown, ChevronUp, Mail, BookOpen, Newspaper } from "lucide-react"

type ChatMessage = {
  id: string
  role: "rune" | "user"
  content: string
  timestamp: number
}

type ProfileData = {
  professional_context: string
  stay_on_top_of: string[]
  get_sharper_on: string | null
  inferred_expertise_level: string
  news_topic_suggestion: {
    topic_text: string
    retrieval_queries: string[]
    required_terms: string[][]
    scope_summary: string
  } | null
  lesson_topic_suggestion: {
    topic_text: string | null
    starting_level: string | null
    curriculum_goal: string | null
  } | null
}

type Recommendation = {
  priority_newsletters: Array<{
    address: string
    name: string
    category: string
    relevance_score: number
    relevance_reason: string | null
  }>
  other_newsletters: Array<{
    address: string
    name: string
    category: string
    relevance_score: number
  }>
  news_topic: { text: string; scope: string } | null
  lesson_topic: { text: string; curriculum_title: string } | null
  delivery_time: string
  recommended_config?: Record<string, any>
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

function RecommendationCard({
  recommendation,
  onApprove,
  approving
}: {
  recommendation: Recommendation
  onApprove: () => void
  approving: boolean
}) {
  const [showOther, setShowOther] = useState(false)

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 mt-2">
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 backdrop-blur-sm">
        <p className="mb-4 text-[15px] font-medium text-white">Here&apos;s your daily brief:</p>

        {recommendation.priority_newsletters.length > 0 && (
          <div className="mb-4">
            <div className="mb-2 flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 text-white/30" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/40">Newsletters</span>
            </div>
            <div className="space-y-1">
              {recommendation.priority_newsletters.map((nl) => (
                <div key={nl.address} className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-white/70 hover:bg-white/[0.03] transition-colors">
                  <Check className="h-3.5 w-3.5 text-emerald-400/70 shrink-0" />
                  <span className="flex-1 truncate">{nl.name}</span>
                  <span className="text-[11px] text-white/25">{nl.category}</span>
                </div>
              ))}
            </div>
            {recommendation.other_newsletters.length > 0 && (
              <button
                onClick={() => setShowOther(!showOther)}
                className="mt-1.5 flex items-center gap-1 px-2.5 text-[12px] text-white/30 hover:text-white/50 transition-colors"
              >
                {showOther ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                +{recommendation.other_newsletters.length} monitored
              </button>
            )}
            {showOther && (
              <div className="mt-1 space-y-0.5 pl-2.5">
                {recommendation.other_newsletters.map((nl) => (
                  <div key={nl.address} className="text-[12px] text-white/25 py-0.5">
                    {nl.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {recommendation.news_topic && (
          <div className="mb-4">
            <div className="mb-2 flex items-center gap-2">
              <Newspaper className="h-3.5 w-3.5 text-white/30" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/40">Daily Intelligence</span>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/[0.05]">
              <p className="text-[13px] font-medium text-white/70">{recommendation.news_topic.text}</p>
              <p className="mt-1 text-[12px] text-white/30 leading-relaxed">{recommendation.news_topic.scope}</p>
            </div>
          </div>
        )}

        {recommendation.lesson_topic && (
          <div className="mb-4">
            <div className="mb-2 flex items-center gap-2">
              <BookOpen className="h-3.5 w-3.5 text-white/30" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/40">10-Day Learning Track</span>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/[0.05]">
              <p className="text-[13px] font-medium text-white/70">{recommendation.lesson_topic.text}</p>
              <p className="mt-1 text-[12px] text-white/30">{recommendation.lesson_topic.curriculum_title}</p>
            </div>
          </div>
        )}

        <div className="mb-4 rounded-lg bg-blue-500/[0.06] px-3 py-2 ring-1 ring-blue-400/10">
          <p className="text-[12px] text-blue-300/60">First brief arrives tomorrow at {recommendation.delivery_time}</p>
        </div>

        <button
          onClick={onApprove}
          disabled={approving}
          className="w-full rounded-xl bg-white py-3 text-[14px] font-semibold text-[#0b0b12] transition-all hover:bg-white/90 active:scale-[0.98] disabled:opacity-50"
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

  const [conversationComplete, setConversationComplete] = useState(false)
  const [profileData, setProfileData] = useState<ProfileData | null>(null)
  const [showGmail, setShowGmail] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null)
  const [approving, setApproving] = useState(false)
  const [approved, setApproved] = useState(false)

  const conversationHistory = useRef<Array<{ role: "user" | "assistant"; content: string }>>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const initDone = useRef(false)

  const scrollToBottom = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }), 100)
  }, [])

  const addRuneMessage = useCallback((content: string) => {
    setMessages((prev) => [...prev, { id: uid(), role: "rune", content, timestamp: Date.now() }])
    conversationHistory.current.push({ role: "assistant", content })
    scrollToBottom()
  }, [scrollToBottom])

  const showTypingThenMessage = useCallback((content: string, delay = 800) => {
    setTyping(true)
    scrollToBottom()
    setTimeout(() => {
      setTyping(false)
      addRuneMessage(content)
    }, delay)
  }, [addRuneMessage, scrollToBottom])

  useEffect(() => {
    if (initDone.current) return
    initDone.current = true

    const stepParam = searchParams.get("step")
    if (stepParam === "scanning") {
      setConversationComplete(true)
      setShowGmail(false)
      setScanning(true)
      addRuneMessage("Gmail connected. Scanning your inbox now...")
      runInboxScan()
      return
    }

    fetchOpening()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchOpening() {
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
      const res = await fetch("/api/onboard/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          conversation_history: conversationHistory.current.slice(0, -1)
        })
      })
      if (res.status === 401) { router.push("/auth?redirectedFrom=/onboard"); return }
      const data = await res.json()
      setTyping(false)

      if (data.ok) {
        addRuneMessage(data.rune_message)

        if (data.conversation_complete) {
          setConversationComplete(true)
          setProfileData(data.profile_data || null)
          setTimeout(() => {
            setShowGmail(true)
            scrollToBottom()
          }, 1500)
        }
      } else {
        addRuneMessage("Sorry, something went wrong. Try sending that again.")
      }
    } catch {
      setTyping(false)
      addRuneMessage("Connection issue — try again in a moment.")
    } finally {
      setLoading(false)
    }
  }

  async function runInboxScan() {
    setScanning(true)
    try {
      const res = await fetch("/api/onboard/scan-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      })
      if (res.status === 401) { router.push("/auth?redirectedFrom=/onboard"); return }
      const scanData = await res.json()

      if (scanData.ok) {
        showTypingThenMessage(
          `Found ${scanData.newsletters_identified || 0} newsletters in your inbox. Building your recommendation...`,
          600
        )
      }

      const recRes = await fetch("/api/onboard/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      })
      const recData = await recRes.json()

      setScanning(false)
      if (recData.ok && recData.recommendation) {
        setRecommendation(recData.recommendation)
        scrollToBottom()
      } else {
        addRuneMessage("Had trouble building the recommendation. Let's try that again.")
      }
    } catch {
      setScanning(false)
      addRuneMessage("Inbox scan hit an issue. Try refreshing the page.")
    }
  }

  async function handleApprove() {
    if (!recommendation || approving) return
    setApproving(true)

    try {
      const config = (recommendation as any).recommended_config || buildConfigFromRecommendation(recommendation)

      const res = await fetch("/api/onboard/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config })
      })
      const data = await res.json()

      if (data.ok) {
        setApproved(true)
        showTypingThenMessage("You're all set. Your first brief arrives tomorrow morning. Welcome to Rune.", 800)
        setTimeout(() => router.push("/dashboard"), 4000)
      } else {
        addRuneMessage("Something went wrong saving your config. Try again.")
      }
    } catch {
      addRuneMessage("Connection issue during setup. Try the button again.")
    } finally {
      setApproving(false)
    }
  }

  function buildConfigFromRecommendation(rec: Recommendation) {
    return {
      modules: {
        newsletters: {
          enabled: true,
          priority_senders: rec.priority_newsletters.map((n) => n.address),
          deprioritized_senders: [],
          max_items_in_digest: 5
        },
        news: {
          enabled: !!rec.news_topic,
          topic_text: rec.news_topic?.text || "",
          topic_mapping: profileData?.news_topic_suggestion || {}
        },
        lessons: {
          enabled: !!rec.lesson_topic,
          topic_text: rec.lesson_topic?.text || "",
          topic_mapping: profileData?.lesson_topic_suggestion || {}
        }
      },
      digest_preferences: {
        delivery_time: rec.delivery_time || "07:00",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York"
      }
    }
  }

  const showInput = !conversationComplete && !approved

  function handleTextareaInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
    const el = e.target
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 120) + "px"
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col" style={{ background: "#07070d" }}>

      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-[520px] space-y-5 px-5 pb-8 pt-16">
          {messages.map((msg) =>
            msg.role === "rune" ? (
              <RuneMessage key={msg.id} content={msg.content} />
            ) : (
              <UserMessage key={msg.id} content={msg.content} />
            )
          )}

          {typing && <TypingIndicator />}
          {showGmail && !scanning && !recommendation && !approved && <GmailButton />}
          {scanning && <ScanningIndicator />}
          {recommendation && !approved && (
            <RecommendationCard
              recommendation={recommendation}
              onApprove={handleApprove}
              approving={approving}
            />
          )}
        </div>
      </div>

      {showInput && (
        <div className="relative px-5 pb-6 pt-3">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
          <div className="mx-auto max-w-[520px]">
            <div className="flex items-center gap-2 rounded-2xl bg-[#12121a] ring-1 ring-white/[0.08] px-4 py-3 focus-within:ring-white/[0.15] transition-all">
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleTextareaInput}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                placeholder="Message Rune..."
                disabled={loading}
                rows={1}
                className="flex-1 resize-none bg-transparent text-[15px] text-white placeholder-white/25 outline-none disabled:opacity-50 leading-relaxed max-h-[120px]"
                autoFocus
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
