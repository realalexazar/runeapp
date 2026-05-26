"use client"

import { useState, useEffect, useRef, useCallback, Suspense, useMemo } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { ArrowUp, Loader2, Check, ChevronDown, ChevronUp, Mail, BookOpen, Newspaper, Save } from "lucide-react"

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

type OnboardingCard = Record<string, any> & {
  id: string
  type: "news" | "lesson" | "inbox" | "delivery"
  title: string
  status?: "draft" | "valid" | "invalid" | "pending_patch"
  validation_errors?: string[]
}

type OnboardingSnapshot = {
  rune_id?: string
  onboarding_session_id?: string
  state: string
  state_storage_available?: boolean
  conversation?: {
    messages?: Array<{ id?: string; role: "user" | "rune"; content: string; created_at: string }>
  }
  recommendation?: {
    version_id?: string
    config_version: number
    cards: OnboardingCard[]
    user_facing_summary: string[]
    raw_recommendation?: any
  }
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function recommendationFromSnapshot(snapshot: OnboardingSnapshot): RecommendationData | null {
  const cards = snapshot.recommendation?.cards || []
  const raw = snapshot.recommendation?.raw_recommendation

  const slotAllocation: SlotAllocation[] = []
  for (const card of cards) {
    if (card.type === "news") {
      slotAllocation.push({
        slot: slotAllocation.length + 1,
        type: "news",
        focus: String(card.focus || ""),
        rationale: String(card.rationale || ""),
        retrieval_queries: Array.isArray(card.retrieval_queries) ? card.retrieval_queries : [],
        required_terms: Array.isArray(card.required_terms) ? card.required_terms : [],
        scope_summary: String(card.scope_summary || ""),
      })
    }
    if (card.type === "lesson") {
      slotAllocation.push({
        slot: slotAllocation.length + 1,
        type: "lesson",
        focus: String(card.topic || ""),
        rationale: String(card.rationale || ""),
        starting_level: String(card.starting_level || "beginner"),
        curriculum_goal: String(card.curriculum_goal || ""),
        scope_summary: String(card.scope_summary || ""),
      })
    }
    if (card.type === "inbox") {
      const selectedSenders = Array.isArray(card.selected_senders) ? card.selected_senders : []
      slotAllocation.push({
        slot: slotAllocation.length + 1,
        type: "email",
        focus: "Inbox updates",
        rationale: String(card.rationale || ""),
        priority_senders: selectedSenders.map((sender: any) => String(sender.address || sender)).filter(Boolean),
      })
    }
  }

  if (slotAllocation.length === 0 && raw?.slot_allocation) return raw as RecommendationData
  if (slotAllocation.length === 0) return null

  return {
    slot_allocation: slotAllocation,
    user_facing_summary: snapshot.recommendation?.user_facing_summary || [],
    inbox_curation_plan: raw?.inbox_curation_plan || null,
    allocation_notes: raw?.allocation_notes || null,
  }
}

function listToText(value: unknown): string {
  return Array.isArray(value) ? value.map(String).filter(Boolean).join(", ") : ""
}

function textToList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function senderListToText(value: unknown): string {
  if (!Array.isArray(value)) return ""
  return value
    .map((sender: any) => sender?.address || sender?.name || sender)
    .map(String)
    .filter(Boolean)
    .join(", ")
}

function textToSenderList(value: string): Array<{ address: string }> {
  return textToList(value).map((address) => ({ address }))
}

const INPUT_CLASS = "w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-[13px] text-white/80 outline-none transition placeholder:text-white/20 focus:border-white/[0.18] focus:bg-black/30"
const LABEL_CLASS = "mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-white/35"

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

function GreetingScreen({ greeting, showPrompt }: { greeting: string; showPrompt: boolean }) {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center px-6 text-center">
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
  cards,
  onSaveCard,
  onApprove,
  approving,
}: {
  data: RecommendationData
  cards: OnboardingCard[]
  onSaveCard: (cardId: string, fields: Record<string, unknown>) => Promise<void>
  onApprove: () => void
  approving: boolean
}) {
  const [showDetails, setShowDetails] = useState(false)
  const hasEditableCards = cards.length > 0
  const hasInvalidCards = cards.some((card) => card.status === "invalid")

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 mt-2 space-y-4">
      <div className="space-y-4">
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

        {hasEditableCards ? (
          <div className="mb-4 space-y-3">
            {cards.map((card) => (
              <EditableSetupCard
                key={`${card.id}-${card.updated_at || ""}`}
                card={card}
                onSave={onSaveCard}
              />
            ))}
          </div>
        ) : (
          <>
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
          </>
        )}

        <div className="mb-4 rounded-lg bg-blue-500/[0.06] px-3 py-2 ring-1 ring-blue-400/10">
          <p className="text-[12px] text-blue-300/60">First delivery arrives tomorrow at 7:00 AM</p>
        </div>

        <button
          onClick={onApprove}
          disabled={approving || hasInvalidCards}
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
        {hasInvalidCards && (
          <p className="mt-2 text-center text-[12px] text-amber-300/60">
            Fix the highlighted cards before approval.
          </p>
        )}
      </div>
    </div>
  )
}

function EditableSetupCard({
  card,
  onSave,
}: {
  card: OnboardingCard
  onSave: (cardId: string, fields: Record<string, unknown>) => Promise<void>
}) {
  const [draft, setDraft] = useState<Record<string, any>>(() => card)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateField(field: string, value: unknown) {
    setDraft((current) => ({ ...current, [field]: value }))
    setDirty(true)
  }

  async function save() {
    if (!dirty || saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave(card.id, buildEditablePatch(card.type, draft))
      setDirty(false)
    } catch (e: any) {
      setError(String(e?.message || e || "Could not save that card."))
    } finally {
      setSaving(false)
    }
  }

  const icon = card.type === "delivery"
    ? <Check className="h-3.5 w-3.5 text-blue-300/70" />
    : SLOT_ICONS[card.type === "inbox" ? "email" : card.type] || null
  const status = String(card.status || "draft")
  const errors = Array.isArray(card.validation_errors) ? card.validation_errors : []

  return (
    <div className="rounded-xl bg-white/[0.035] p-3.5 ring-1 ring-white/[0.07]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {icon}
            <span className="truncate text-[12px] font-semibold uppercase tracking-[0.08em] text-white/40">
              {card.title || card.type}
            </span>
          </div>
          <p className="mt-1 text-[12px] text-white/25">{status === "invalid" ? "Needs attention" : "Ready to tune"}</p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-white px-2.5 text-[12px] font-semibold text-[#07070d] transition hover:bg-white/90 disabled:bg-white/20 disabled:text-white/40"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </button>
      </div>

      <CardFields card={draft as OnboardingCard} updateField={updateField} />

      {errors.length > 0 && (
        <div className="mt-3 rounded-lg bg-amber-400/[0.08] px-3 py-2 text-[12px] text-amber-200/70 ring-1 ring-amber-300/10">
          {errors.join(", ")}
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-lg bg-red-400/[0.08] px-3 py-2 text-[12px] text-red-200/70 ring-1 ring-red-300/10">
          {error}
        </div>
      )}
    </div>
  )
}

function CardFields({
  card,
  updateField,
}: {
  card: OnboardingCard
  updateField: (field: string, value: unknown) => void
}) {
  if (card.type === "news") {
    return (
      <div className="space-y-3">
        <TextField label="Track this" value={card.focus || ""} onChange={(value) => updateField("focus", value)} />
        <TextAreaField label="Focus on" value={card.scope_summary || ""} onChange={(value) => updateField("scope_summary", value)} />
        <TextField label="Entities" value={listToText(card.tracked_entities)} onChange={(value) => updateField("tracked_entities", textToList(value))} placeholder="Companies, people, concepts" />
        <TextField label="Preferred sources" value={listToText(card.preferred_sources)} onChange={(value) => updateField("preferred_sources", textToList(value))} />
        <TextField label="Blocked sources" value={listToText(card.blocked_sources)} onChange={(value) => updateField("blocked_sources", textToList(value))} />
        <TextField label="Avoid" value={listToText(card.avoid_terms)} onChange={(value) => updateField("avoid_terms", textToList(value))} />
      </div>
    )
  }

  if (card.type === "lesson") {
    return (
      <div className="space-y-3">
        <TextField label="Learn this" value={card.topic || ""} onChange={(value) => updateField("topic", value)} />
        <SelectField label="Starting level" value={card.starting_level || "beginner"} onChange={(value) => updateField("starting_level", value)} options={["beginner", "intermediate", "advanced"]} />
        <TextAreaField label="Goal" value={card.curriculum_goal || ""} onChange={(value) => updateField("curriculum_goal", value)} />
        <SelectField label="Depth" value={card.depth || "standard"} onChange={(value) => updateField("depth", value)} options={["quick", "standard", "deep"]} />
      </div>
    )
  }

  if (card.type === "inbox") {
    return (
      <div className="space-y-3">
        <SelectField label="Inbox" value={card.preference_status || "skipped"} onChange={(value) => updateField("preference_status", value)} options={["wanted", "not_wanted", "skipped"]} />
        <TextAreaField label="Include these senders" value={senderListToText(card.selected_senders)} onChange={(value) => updateField("selected_senders", textToSenderList(value))} />
        <TextField label="Exclude these senders" value={listToText(card.blocked_senders)} onChange={(value) => updateField("blocked_senders", textToList(value))} />
        <TextField label="Surface these updates" value={listToText(card.content_types)} onChange={(value) => updateField("content_types", textToList(value))} />
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <TextField label="Delivery time" value={card.send_time || "07:00"} onChange={(value) => updateField("send_time", value)} type="time" />
      <TextField label="Timezone" value={card.timezone || "America/New_York"} onChange={(value) => updateField("timezone", value)} />
      <SelectField label="Length" value={card.length || "standard"} onChange={(value) => updateField("length", value)} options={["short", "standard", "deep"]} />
      <SelectField label="Style" value={card.style || "morning-brief"} onChange={(value) => updateField("style", value)} options={["morning-brief", "reference-mode", "deep-read"]} />
    </div>
  )
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <label className="block">
      <span className={LABEL_CLASS}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={INPUT_CLASS}
      />
    </label>
  )
}

function TextAreaField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className={LABEL_CLASS}>{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className={`${INPUT_CLASS} resize-none leading-relaxed`}
      />
    </label>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[]
}) {
  return (
    <label className="block">
      <span className={LABEL_CLASS}>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={INPUT_CLASS}
      >
        {options.map((option) => (
          <option key={option} value={option} className="bg-[#12121a] text-white">
            {option.replace(/-/g, " ")}
          </option>
        ))}
      </select>
    </label>
  )
}

function buildEditablePatch(cardType: OnboardingCard["type"], draft: Record<string, any>): Record<string, unknown> {
  if (cardType === "news") {
    return {
      focus: draft.focus || "",
      scope_summary: draft.scope_summary || "",
      tracked_entities: Array.isArray(draft.tracked_entities) ? draft.tracked_entities : [],
      preferred_sources: Array.isArray(draft.preferred_sources) ? draft.preferred_sources : [],
      blocked_sources: Array.isArray(draft.blocked_sources) ? draft.blocked_sources : [],
      avoid_terms: Array.isArray(draft.avoid_terms) ? draft.avoid_terms : [],
    }
  }

  if (cardType === "lesson") {
    return {
      topic: draft.topic || "",
      starting_level: draft.starting_level || "beginner",
      curriculum_goal: draft.curriculum_goal || "",
      depth: draft.depth || "standard",
      scope_summary: draft.scope_summary || "",
    }
  }

  if (cardType === "inbox") {
    return {
      preference_status: draft.preference_status || "skipped",
      selected_senders: Array.isArray(draft.selected_senders) ? draft.selected_senders : [],
      blocked_senders: Array.isArray(draft.blocked_senders) ? draft.blocked_senders : [],
      content_types: Array.isArray(draft.content_types) ? draft.content_types : [],
    }
  }

  return {
    cadence: "daily",
    send_time: draft.send_time || "07:00",
    timezone: draft.timezone || "America/New_York",
    length: draft.length || "standard",
    style: draft.style || "morning-brief",
  }
}

function OnboardFlow() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [typing, setTyping] = useState(false)

  const [phase, setPhase] = useState<"conversation" | "gmail_connect" | "scanning" | "recommendation" | "approved">("conversation")
  const [recommendationData, setRecommendationData] = useState<RecommendationData | null>(null)
  const [serverSnapshot, setServerSnapshot] = useState<OnboardingSnapshot | null>(null)
  const [approving, setApproving] = useState(false)
  const [showGreetingPrompt, setShowGreetingPrompt] = useState(false)
  const [conversationStarted, setConversationStarted] = useState(false)
  const [showSurge, setShowSurge] = useState(true)

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

  const applyServerSnapshot = useCallback((snapshot: OnboardingSnapshot) => {
    setServerSnapshot(snapshot)

    const snapshotMessages = snapshot.conversation?.messages || []
    if (snapshotMessages.length > 0) {
      const restored = snapshotMessages.map((message) => ({
        id: message.id || uid(),
        role: message.role,
        content: message.content,
        timestamp: Date.parse(message.created_at) || Date.now(),
      }))
      setMessages(restored)
      conversationHistory.current = restored.map((message) => ({
        role: message.role === "rune" ? "assistant" : "user",
        content: message.content,
      }))
      setConversationStarted(true)
      setShowGreetingPrompt(false)
      setShowSurge(false)
    }

    const restoredRecommendation = recommendationFromSnapshot(snapshot)
    if (restoredRecommendation) setRecommendationData(restoredRecommendation)

    if (snapshot.state === "complete" || snapshot.state === "approved") {
      setPhase("approved")
    } else if (snapshot.state === "recommendation_ready") {
      setPhase("recommendation")
    } else if (snapshot.state === "gmail_needed") {
      setPhase("gmail_connect")
    } else if (snapshot.state === "scanning") {
      setPhase("scanning")
    } else if (snapshot.state === "recommendation_generating" && restoredRecommendation) {
      setPhase("recommendation")
    }
  }, [])

  const hydrateServerState = useCallback(async () => {
    try {
      const res = await fetch("/api/onboard/state", { cache: "no-store" })
      if (res.status === 401) {
        router.push("/auth?redirectedFrom=/onboard")
        return null
      }
      const data = await res.json()
      if (data.ok && data.snapshot) {
        applyServerSnapshot(data.snapshot)
        return data.snapshot as OnboardingSnapshot
      }
    } catch {}
    return null
  }, [applyServerSnapshot, router])

  useEffect(() => {
    if (initDone.current) return
    initDone.current = true

    const stepParam = searchParams.get("step")
    if (stepParam === "scanning") {
      hydrateServerState().then((snapshot) => {
        if (!snapshot?.conversation?.messages?.length) {
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
          } catch {}
        }
        setConversationStarted(true)
        setShowSurge(false)
        setPhase("scanning")
        runInboxScan()
      })
      return
    }

    hydrateServerState()

    const surgeTimer = window.setTimeout(() => setShowSurge(false), 1200)
    const promptTimer = window.setTimeout(() => setShowGreetingPrompt(true), 600)
    return () => {
      window.clearTimeout(surgeTimer)
      window.clearTimeout(promptTimer)
    }
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
        if (data.snapshot) setServerSnapshot(data.snapshot)
        addRuneMessage(data.rune_message)
        setTimeout(() => {
          scrollRef.current?.scrollTo({ top: 0, behavior: "auto" })
        }, 50)
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
      if (phase === "recommendation" && recommendationData) {
        const res = await fetch("/api/onboard/refine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instruction: msg,
            recommendation_version_id: serverSnapshot?.recommendation?.version_id,
            current_config_version: serverSnapshot?.recommendation?.config_version,
          }),
        })
        if (res.status === 401) { router.push("/auth?redirectedFrom=/onboard"); return }
        const data = await res.json().catch(() => null)
        setTyping(false)

        if (data?.snapshot) applyServerSnapshot(data.snapshot)
        if (data?.rune_message) {
          addRuneMessage(data.rune_message)
        } else if (!res.ok) {
          addRuneMessage(data?.error?.message || "I couldn't apply that change. Try saying it another way.")
        }
        return
      }

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

      if (!data.ok) {
        addRuneMessage("Sorry, something went wrong. Try sending that again.")
        return
      }

      addRuneMessage(data.rune_message)
      if (data.snapshot) setServerSnapshot(data.snapshot)

      if (data.signal === "intent_ready") {
        const intent = data.intent_data || {}
        if (intent.inbox_preferences?.wants_inbox_curation === false) {
          await persistInboxPreference("not_wanted")
          setTimeout(() => injectScanResults(null), 500)
        } else {
          await persistInboxPreference("wanted")
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

  async function handleBuildRune() {
    if (loading) return
    setLoading(true)
    try {
      const res = await fetch("/api/onboard/build", { method: "POST" })
      if (res.status === 401) { router.push("/auth?redirectedFrom=/onboard"); return }
      const data = await res.json()
      if (data.snapshot) applyServerSnapshot(data.snapshot)
      if (!data.ok && data.error?.message) {
        addRuneMessage(data.error.message)
      }
    } catch {
      addRuneMessage("Connection issue - try again in a moment.")
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
        if (scanData.snapshot) applyServerSnapshot(scanData.snapshot)
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
      ? `[SYSTEM: Inbox scan complete. Now generate the user's recommendation. Address them directly. Show them what you'd build based on everything in this conversation plus the inbox results. End with the configuration JSON block.]`
      : `[SYSTEM: User does not want inbox curation OR inbox scan failed. No inbox data available.\n\nNow generate the user's recommendation. Address them directly. Show them what you'd build based on everything in this conversation. End with the configuration JSON block.]`

    try {
      const res = await fetch("/api/onboard/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: systemMessage,
          conversation_history: conversationHistory.current,
          scan_results: scanSummary || null,
        })
      })
      const data = await res.json()
      setTyping(false)

      if (data.ok) {
        if (data.snapshot) setServerSnapshot(data.snapshot)
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
      const res = await fetch("/api/onboard/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendation: recData })
      })
      const data = await res.json().catch(() => null)
      if (data?.snapshot) applyServerSnapshot(data.snapshot)
    } catch {
      console.error("Failed to store recommendation")
    }
  }

  async function persistInboxPreference(status: "wanted" | "not_wanted" | "skipped") {
    try {
      const res = await fetch("/api/onboard/inbox-preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preference_status: status })
      })
      const data = await res.json().catch(() => null)
      if (data?.snapshot) setServerSnapshot(data.snapshot)
    } catch {}
  }

  async function handleSaveCard(cardId: string, fields: Record<string, unknown>) {
    const res = await fetch(`/api/onboard/cards/${encodeURIComponent(cardId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields,
        recommendation_version_id: serverSnapshot?.recommendation?.version_id,
        current_config_version: serverSnapshot?.recommendation?.config_version,
      }),
    })
    const data = await res.json().catch(() => null)
    if (data?.snapshot) applyServerSnapshot(data.snapshot)
    if (!res.ok) {
      throw new Error(data?.error?.message || "Could not save that card.")
    }
  }

  async function handleApprove() {
    if (!recommendationData || approving) return
    setApproving(true)

    try {
      const deliveryCard = serverSnapshot?.recommendation?.cards?.find((card) => card.type === "delivery")
      const config = {
        slot_allocation: recommendationData.slot_allocation,
        inbox_curation_plan: recommendationData.inbox_curation_plan || null,
        digest_preferences: {
          delivery_time: deliveryCard?.send_time || "07:00",
          timezone: deliveryCard?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
          length: deliveryCard?.length || "standard",
          style: deliveryCard?.style || "morning-brief",
        }
      }

      const res = await fetch("/api/onboard/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config })
      })
      const data = await res.json()

      if (data.ok) {
        if (data.snapshot) applyServerSnapshot(data.snapshot)
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
  const showBuildButton = phase === "conversation" && messages.some((message) => message.role === "user") && !loading

  function handleTextareaInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
    const el = e.target
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 120) + "px"
  }

  return (
    <div className="fixed inset-0 z-40 h-[100dvh] flex flex-col" style={{ background: "#07070d" }}>
      {/* Energy surge overlay */}
      {showSurge && (
        <div className="pointer-events-none fixed inset-0 z-[60]">
          <div className="intro-surge-shell absolute inset-0" />
          <div className="intro-surge-core absolute inset-0" />
          <div className="intro-surge-flare absolute inset-0" />
        </div>
      )}

      {phase === "approved" ? (
        <div className="flex flex-1 items-center justify-center">
          <CompletionScreen />
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto max-w-[560px] px-4 pb-4 sm:px-5">
              {showGreeting ? (
                <GreetingScreen greeting={greeting} showPrompt={showGreetingPrompt} />
              ) : (
                <div className="space-y-5 pt-80">
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
                      cards={serverSnapshot?.recommendation?.cards || []}
                      onSaveCard={handleSaveCard}
                      onApprove={handleApprove}
                      approving={approving}
                    />
                  )}
                </div>
              )}
            </div>
          </div>

          {showInput && (
            <div className="shrink-0 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 sm:px-5" style={{ background: "#07070d" }}>
              <div className="mx-auto w-[calc(100%-8px)] max-w-[420px] sm:w-full sm:max-w-[460px]">
                {showBuildButton && (
                  <button
                    type="button"
                    onClick={handleBuildRune}
                    className="mb-2 w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-[13px] font-medium text-white/70 transition hover:bg-white/[0.07] hover:text-white"
                  >
                    Build my Rune
                  </button>
                )}
                <div
                  className="flex items-center gap-2 rounded-2xl bg-[#12121a] ring-1 ring-white/[0.08] px-3 py-2.5 sm:px-4 sm:py-3 focus-within:ring-white/[0.15] transition-all"
                  onClick={beginConversation}
                >
                  <textarea
                    ref={inputRef}
                    value={input}
                    onFocus={beginConversation}
                    onChange={handleTextareaInput}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) { e.preventDefault(); handleSend() } }}
                    placeholder={phase === "recommendation" ? "Refine your Rune..." : "Message Rune..."}
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
        </>
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
