import { supabaseServiceRole } from "@/lib/supabase/service"

export type OnboardingState =
  | "conversation"
  | "intent_ready"
  | "gmail_needed"
  | "scanning"
  | "scan_complete"
  | "recommendation_generating"
  | "recommendation_ready"
  | "refining"
  | "approved"
  | "complete"
  | "failed"

export type InboxPreferenceStatus = "wanted" | "not_wanted" | "skipped" | "unknown"
export type GmailStatus = "unknown" | "connected" | "disconnected" | "failed"
export type CardStatus = "draft" | "valid" | "invalid" | "pending_patch"

export type MinimumIntentField =
  | "slot_type"
  | "meaningful_focus"
  | "delivery_preference"
  | "inbox_preference"

export type MinimumIntentGate = {
  passed: boolean
  missing_fields: MinimumIntentField[]
}

export type OnboardingCardBase = {
  id: string
  rune_id: string
  type: "news" | "lesson" | "inbox" | "delivery"
  title: string
  rationale?: string
  status: CardStatus
  validation_errors: string[]
  updated_at: string
}

export type OnboardingSnapshot = {
  rune_id: string
  onboarding_session_id: string
  state: OnboardingState
  state_storage_available: boolean
  minimum_intent_gate: MinimumIntentGate
  conversation: {
    messages: Array<{ id?: string; role: "user" | "rune"; content: string; created_at: string }>
    summary?: string
  }
  intent?: unknown
  inbox_preference: InboxPreferenceStatus
  gmail_status: GmailStatus
  scan_artifact?: unknown
  recommendation?: {
    version_id: string
    config_version: number
    cards: Array<Record<string, unknown>>
    user_facing_summary: string[]
    raw_recommendation?: unknown
  }
  failure?: {
    code: string
    retryable: boolean
    message: string
  }
}

export type OnboardingMutationResponse = {
  ok: boolean
  previous_state: OnboardingState
  snapshot: OnboardingSnapshot
  error?: {
    code: string
    retryable: boolean
    message: string
  }
}

export type OnboardingPatchOperation = {
  op: "update_card"
  card_id: string
  fields: Record<string, unknown>
}

type OnboardingContext =
  | {
      available: true
      rune: { id: string; user_id: string; status: string }
      session: {
        id: string
        user_id: string
        rune_id: string
        state: OnboardingState
        minimum_intent_gate: MinimumIntentGate
        structured_intent: unknown
        inbox_preference: InboxPreferenceStatus
        gmail_status: GmailStatus
        current_recommendation_version_id: string | null
        config_version: number
        failure: any
      }
    }
  | { available: false }

const EMPTY_GATE: MinimumIntentGate = {
  passed: false,
  missing_fields: ["slot_type", "meaningful_focus", "delivery_preference", "inbox_preference"],
}

const GENERIC_FOCUSES = new Set([
  "ai",
  "news",
  "business",
  "technology",
  "tech",
  "markets",
  "market",
  "politics",
])

function isStateStorageUnavailable(error: any): boolean {
  if (!error) return false
  const message = String(error.message || "").toLowerCase()
  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    error.code === "PGRST204" ||
    error.code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  )
}

function nowIso() {
  return new Date().toISOString()
}

export function isMeaningfulFocus(value: unknown): boolean {
  const focus = String(value || "").trim()
  if (!focus) return false
  const normalized = focus.toLowerCase()
  if (GENERIC_FOCUSES.has(normalized)) return false
  if (focus.length < 5) return false
  return Boolean(
    focus.includes(" ") ||
    /[A-Z]{2,}/.test(focus) ||
    /\d/.test(focus) ||
    focus.length >= 14
  )
}

export function inferInboxPreference(intent: any): InboxPreferenceStatus {
  const wants = intent?.inbox_preferences?.wants_inbox_curation
  if (wants === true) return "wanted"
  if (wants === false) return "not_wanted"
  return "unknown"
}

export function evaluateMinimumIntentGate(intent: any, inboxPreference: InboxPreferenceStatus): MinimumIntentGate {
  const missing = new Set<MinimumIntentField>([
    "slot_type",
    "meaningful_focus",
    "delivery_preference",
    "inbox_preference",
  ])

  const occupationInterests = Array.isArray(intent?.occupation_interests) ? intent.occupation_interests : []
  const freeInterest = intent?.free_interest ? [intent.free_interest] : []
  const lessonTopic = intent?.learning_topic?.topic ? [intent.learning_topic.topic] : []
  const focuses = [...occupationInterests, ...freeInterest, ...lessonTopic]

  if (focuses.length > 0 || inboxPreference === "wanted") missing.delete("slot_type")
  if (focuses.some(isMeaningfulFocus)) missing.delete("meaningful_focus")

  // Phase 0c alpha defaults delivery to the delivery card when the user has not chosen it.
  missing.delete("delivery_preference")

  if (inboxPreference !== "unknown") missing.delete("inbox_preference")

  const missing_fields = [...missing]
  return {
    passed: missing_fields.length === 0,
    missing_fields,
  }
}

async function getOrCreateOnboardingContext(userId: string): Promise<OnboardingContext> {
  const { data: existingRune, error: runeReadError } = await supabaseServiceRole
    .from("runes")
    .select("id, user_id, status")
    .eq("user_id", userId)
    .eq("is_alpha_primary", true)
    .maybeSingle()

  if (runeReadError) {
    if (isStateStorageUnavailable(runeReadError)) return { available: false }
    throw runeReadError
  }

  let rune = existingRune
  if (!rune) {
    const { data: insertedRune, error: runeInsertError } = await supabaseServiceRole
      .from("runes")
      .insert({
        user_id: userId,
        name: "Daily Rune",
        status: "onboarding",
        is_alpha_primary: true,
      })
      .select("id, user_id, status")
      .single()

    if (runeInsertError) {
      if (isStateStorageUnavailable(runeInsertError)) return { available: false }
      throw runeInsertError
    }
    rune = insertedRune
  }

  const { data: existingSession, error: sessionReadError } = await supabaseServiceRole
    .from("onboarding_sessions")
    .select("*")
    .eq("rune_id", rune.id)
    .maybeSingle()

  if (sessionReadError) {
    if (isStateStorageUnavailable(sessionReadError)) return { available: false }
    throw sessionReadError
  }

  let session = existingSession
  if (!session) {
    const { data: insertedSession, error: sessionInsertError } = await supabaseServiceRole
      .from("onboarding_sessions")
      .insert({
        user_id: userId,
        rune_id: rune.id,
        state: "conversation",
        minimum_intent_gate: EMPTY_GATE,
      })
      .select("*")
      .single()

    if (sessionInsertError) {
      if (isStateStorageUnavailable(sessionInsertError)) return { available: false }
      throw sessionInsertError
    }
    session = insertedSession
  }

  return {
    available: true,
    rune,
    session: {
      id: session.id,
      user_id: session.user_id,
      rune_id: session.rune_id,
      state: session.state,
      minimum_intent_gate: session.minimum_intent_gate || EMPTY_GATE,
      structured_intent: session.structured_intent,
      inbox_preference: session.inbox_preference || "unknown",
      gmail_status: session.gmail_status || "unknown",
      current_recommendation_version_id: session.current_recommendation_version_id,
      config_version: Number(session.config_version || 0),
      failure: session.failure,
    },
  }
}

async function buildLegacySnapshot(userId: string): Promise<OnboardingSnapshot> {
  const { data: profile } = await supabaseServiceRole
    .from("user_profiles")
    .select("onboard_chat_phase, onboarding_status, recommended_config")
    .eq("user_id", userId)
    .maybeSingle()

  const phase = profile?.onboard_chat_phase
  const complete = phase === "complete" || profile?.onboarding_status === "complete"
  const recommendation = profile?.recommended_config
  const state: OnboardingState = complete
    ? "complete"
    : recommendation?.slot_allocation
      ? "recommendation_ready"
      : phase === "recommendation"
        ? "recommendation_generating"
        : "conversation"

  return {
    rune_id: userId,
    onboarding_session_id: userId,
    state,
    state_storage_available: false,
    minimum_intent_gate: EMPTY_GATE,
    conversation: { messages: [] },
    intent: recommendation?.raw_intent,
    inbox_preference: inferInboxPreference(recommendation?.raw_intent),
    gmail_status: "unknown",
    recommendation: recommendation?.slot_allocation
      ? {
          version_id: "legacy",
          config_version: 0,
          cards: recommendationToCards(userId, recommendation, 0),
          user_facing_summary: Array.isArray(recommendation.user_facing_summary)
            ? recommendation.user_facing_summary
            : [],
          raw_recommendation: recommendation,
        }
      : undefined,
  }
}

export async function buildOnboardingSnapshot(userId: string): Promise<OnboardingSnapshot> {
  const context = await getOrCreateOnboardingContext(userId)
  if (!context.available) return buildLegacySnapshot(userId)

  const [messagesResult, recommendationResult, scanResult] = await Promise.all([
    supabaseServiceRole
      .from("onboarding_messages")
      .select("id, role, content, created_at")
      .eq("onboarding_session_id", context.session.id)
      .order("created_at", { ascending: true })
      .limit(80),
    context.session.current_recommendation_version_id
      ? supabaseServiceRole
          .from("onboarding_recommendation_versions")
          .select("id, config_version, cards, user_facing_summary, raw_recommendation")
          .eq("id", context.session.current_recommendation_version_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null } as any),
    supabaseServiceRole
      .from("onboarding_scan_artifacts")
      .select("id, status, provider, summary, sender_count, candidate_count, selected_count, failure, created_at")
      .eq("onboarding_session_id", context.session.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (messagesResult.error && !isStateStorageUnavailable(messagesResult.error)) throw messagesResult.error
  if (recommendationResult.error && !isStateStorageUnavailable(recommendationResult.error)) throw recommendationResult.error
  if (scanResult.error && !isStateStorageUnavailable(scanResult.error)) throw scanResult.error

  const recommendation = recommendationResult.data

  return {
    rune_id: context.rune.id,
    onboarding_session_id: context.session.id,
    state: context.session.state,
    state_storage_available: true,
    minimum_intent_gate: context.session.minimum_intent_gate || EMPTY_GATE,
    conversation: {
      messages: (messagesResult.data || [])
        .filter((message: any) => message.role === "user" || message.role === "rune")
        .map((message: any) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          created_at: message.created_at,
        })),
    },
    intent: context.session.structured_intent,
    inbox_preference: context.session.inbox_preference,
    gmail_status: context.session.gmail_status,
    scan_artifact: scanResult.data || undefined,
    recommendation: recommendation
      ? {
          version_id: recommendation.id,
          config_version: Number(recommendation.config_version || 0),
          cards: Array.isArray(recommendation.cards) ? recommendation.cards : [],
          user_facing_summary: Array.isArray(recommendation.user_facing_summary)
            ? recommendation.user_facing_summary
            : [],
          raw_recommendation: recommendation.raw_recommendation,
        }
      : undefined,
    failure: context.session.failure || undefined,
  }
}

export async function appendOnboardingMessage(
  userId: string,
  role: "user" | "rune" | "system",
  content: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  if (!content.trim()) return
  const context = await getOrCreateOnboardingContext(userId)
  if (!context.available) return

  const { error } = await supabaseServiceRole
    .from("onboarding_messages")
    .insert({
      user_id: userId,
      rune_id: context.rune.id,
      onboarding_session_id: context.session.id,
      role,
      content,
      metadata,
    })

  if (error && !isStateStorageUnavailable(error)) throw error
}

export async function recordOnboardingEvent(
  userId: string,
  eventName: string,
  payload: Record<string, unknown> = {},
  source: "client" | "server" = "server",
  previousState?: OnboardingState
): Promise<void> {
  const context = await getOrCreateOnboardingContext(userId)
  if (!context.available) return

  const { error } = await supabaseServiceRole
    .from("onboarding_events")
    .insert({
      event_name: eventName,
      user_id: userId,
      rune_id: context.rune.id,
      onboarding_session_id: context.session.id,
      state: context.session.state,
      previous_state: previousState || null,
      source,
      payload,
    })

  if (error && !isStateStorageUnavailable(error)) throw error
}

export async function transitionOnboardingState(
  userId: string,
  nextState: OnboardingState,
  reason: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const context = await getOrCreateOnboardingContext(userId)
  if (!context.available) return

  const previousState = context.session.state
  if (previousState === nextState) return

  const timestamp = nowIso()
  const { error: updateError } = await supabaseServiceRole
    .from("onboarding_sessions")
    .update({
      state: nextState,
      updated_at: timestamp,
      completed_at: nextState === "complete" ? timestamp : null,
    })
    .eq("id", context.session.id)

  if (updateError && !isStateStorageUnavailable(updateError)) throw updateError

  const { error: transitionError } = await supabaseServiceRole
    .from("onboarding_state_transitions")
    .insert({
      user_id: userId,
      rune_id: context.rune.id,
      onboarding_session_id: context.session.id,
      previous_state: previousState,
      next_state: nextState,
      reason,
      metadata,
    })

  if (transitionError && !isStateStorageUnavailable(transitionError)) throw transitionError

  await recordOnboardingEvent(userId, nextState === "complete" ? "complete" : reason, metadata, "server", previousState)
}

export async function updateIntentState(userId: string, intent: any): Promise<MinimumIntentGate> {
  const context = await getOrCreateOnboardingContext(userId)
  const inboxPreference = inferInboxPreference(intent)
  const minimumGate = evaluateMinimumIntentGate(intent, inboxPreference)
  if (!context.available) return minimumGate

  const nextState: OnboardingState = minimumGate.passed
    ? inboxPreference === "wanted"
      ? "gmail_needed"
      : "recommendation_generating"
    : "conversation"

  const previousState = context.session.state
  const timestamp = nowIso()
  const { error } = await supabaseServiceRole
    .from("onboarding_sessions")
    .update({
      state: nextState,
      structured_intent: intent,
      minimum_intent_gate: minimumGate,
      inbox_preference: inboxPreference,
      updated_at: timestamp,
    })
    .eq("id", context.session.id)

  if (error && !isStateStorageUnavailable(error)) throw error

  if (previousState !== nextState) {
    await supabaseServiceRole.from("onboarding_state_transitions").insert({
      user_id: userId,
      rune_id: context.rune.id,
      onboarding_session_id: context.session.id,
      previous_state: previousState,
      next_state: nextState,
      reason: "intent_ready",
      metadata: { minimum_intent_gate: minimumGate, inbox_preference: inboxPreference },
    })
  }

  await recordOnboardingEvent(
    userId,
    minimumGate.passed ? "intent_ready" : "minimum_intent_gate_failed",
    {
      minimum_gate_passed: minimumGate.passed,
      missing_fields: minimumGate.missing_fields,
      inbox_preference: inboxPreference,
    },
    "server",
    previousState
  )

  return minimumGate
}

export async function setInboxPreference(userId: string, preference: InboxPreferenceStatus): Promise<void> {
  const context = await getOrCreateOnboardingContext(userId)
  if (!context.available) return

  const nextState: OnboardingState =
    preference === "wanted" ? "gmail_needed" : "recommendation_generating"
  const previousState = context.session.state
  const { error } = await supabaseServiceRole
    .from("onboarding_sessions")
    .update({
      inbox_preference: preference,
      state: nextState,
      updated_at: nowIso(),
    })
    .eq("id", context.session.id)

  if (error && !isStateStorageUnavailable(error)) throw error

  await recordOnboardingEvent(
    userId,
    "inbox_preference_set",
    { preference_status: preference },
    "server",
    previousState
  )
}

export async function setGmailStatus(userId: string, gmailStatus: GmailStatus): Promise<void> {
  const context = await getOrCreateOnboardingContext(userId)
  if (!context.available) return

  const { error } = await supabaseServiceRole
    .from("onboarding_sessions")
    .update({
      gmail_status: gmailStatus,
      updated_at: nowIso(),
    })
    .eq("id", context.session.id)

  if (error && !isStateStorageUnavailable(error)) throw error

  await recordOnboardingEvent(
    userId,
    gmailStatus === "connected" ? "gmail_connect_completed" : "gmail_connect_failed",
    { gmail_status: gmailStatus },
    "server",
    context.session.state
  )
}

export async function recordScanArtifact(
  userId: string,
  status: "running" | "complete" | "empty" | "failed",
  summary: Record<string, unknown> = {},
  failure?: Record<string, unknown>
): Promise<void> {
  const context = await getOrCreateOnboardingContext(userId)
  if (!context.available) return

  const previousState = context.session.state
  const nextState: OnboardingState =
    status === "running" ? "scanning" : status === "failed" ? "failed" : "scan_complete"
  const senderCount = Number(summary.total_senders || summary.sender_count || 0)
  const candidateCount = Number(summary.candidates_after_filtering || summary.candidate_count || 0)
  const selectedCount = Array.isArray(summary.relevant_senders) ? summary.relevant_senders.length : 0

  const { error: artifactError } = await supabaseServiceRole
    .from("onboarding_scan_artifacts")
    .insert({
      user_id: userId,
      rune_id: context.rune.id,
      onboarding_session_id: context.session.id,
      status,
      provider: "gmail",
      summary,
      sender_count: senderCount,
      candidate_count: candidateCount,
      selected_count: selectedCount,
      failure: failure || null,
    })

  if (artifactError && !isStateStorageUnavailable(artifactError)) throw artifactError

  const { error: sessionError } = await supabaseServiceRole
    .from("onboarding_sessions")
    .update({
      state: nextState,
      gmail_status: status === "failed" ? "failed" : "connected",
      updated_at: nowIso(),
      failure: status === "failed" ? failure || { code: "scan_failed" } : null,
    })
    .eq("id", context.session.id)

  if (sessionError && !isStateStorageUnavailable(sessionError)) throw sessionError

  await recordOnboardingEvent(
    userId,
    status === "running"
      ? "scan_started"
      : status === "empty"
        ? "scan_empty"
        : status === "failed"
          ? "scan_failed"
          : "scan_completed",
    {
      sender_count: senderCount,
      candidate_count: candidateCount,
      selected_count: selectedCount,
      retryable: status === "failed",
    },
    "server",
    previousState
  )
}

export async function persistRecommendationVersion(userId: string, recommendation: any): Promise<void> {
  const context = await getOrCreateOnboardingContext(userId)
  if (!context.available) return

  const configVersion = context.session.config_version + 1
  const cards = recommendationToCards(context.rune.id, recommendation, configVersion)
  const validationErrors = cards.flatMap((card) =>
    Array.isArray(card.validation_errors) ? card.validation_errors : []
  )
  const { data: version, error: insertError } = await supabaseServiceRole
    .from("onboarding_recommendation_versions")
    .insert({
      user_id: userId,
      rune_id: context.rune.id,
      onboarding_session_id: context.session.id,
      config_version: configVersion,
      cards,
      user_facing_summary: Array.isArray(recommendation.user_facing_summary)
        ? recommendation.user_facing_summary
        : [],
      raw_recommendation: recommendation,
      validation_errors: validationErrors,
    })
    .select("id")
    .single()

  if (insertError && !isStateStorageUnavailable(insertError)) throw insertError

  if (!version) return

  const previousState = context.session.state
  const { error: updateError } = await supabaseServiceRole
    .from("onboarding_sessions")
    .update({
      state: "recommendation_ready",
      current_recommendation_version_id: version.id,
      config_version: configVersion,
      updated_at: nowIso(),
    })
    .eq("id", context.session.id)

  if (updateError && !isStateStorageUnavailable(updateError)) throw updateError

  await recordOnboardingEvent(
    userId,
    "recommendation_shown",
    {
      card_count: cards.length,
      card_types: cards.map((card) => card.type),
      config_version: configVersion,
    },
    "server",
    previousState
  )
}

export async function applyRecommendationCardEdit(
  userId: string,
  cardId: string,
  fields: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const context = await getOrCreateOnboardingContext(userId)
  if (!context.available) return { ok: false, code: "state_storage_unavailable", message: "Onboarding state is not ready." }
  if (!context.session.current_recommendation_version_id) {
    return { ok: false, code: "recommendation_missing", message: "No recommendation is ready to edit." }
  }

  const { data: currentVersion, error: readError } = await supabaseServiceRole
    .from("onboarding_recommendation_versions")
    .select("cards, user_facing_summary, raw_recommendation")
    .eq("id", context.session.current_recommendation_version_id)
    .maybeSingle()

  if (readError) {
    if (isStateStorageUnavailable(readError)) {
      return { ok: false, code: "state_storage_unavailable", message: "Onboarding state is not ready." }
    }
    throw readError
  }

  const cards = Array.isArray(currentVersion?.cards) ? currentVersion.cards : []
  const cardIndex = cards.findIndex((card: any) => card.id === cardId)
  if (cardIndex < 0) {
    return { ok: false, code: "card_not_found", message: "That card no longer exists." }
  }

  const editableFields = sanitizeCardEditFields(fields)
  const configVersion = context.session.config_version + 1
  const updatedCard = validateCard({
    ...cards[cardIndex],
    ...editableFields,
    updated_at: nowIso(),
    config_version: configVersion,
  })
  const updatedCards = [...cards]
  updatedCards[cardIndex] = updatedCard
  const validationErrors = updatedCards.flatMap((card: any) =>
    Array.isArray(card.validation_errors) ? card.validation_errors : []
  )

  const { data: version, error: insertError } = await supabaseServiceRole
    .from("onboarding_recommendation_versions")
    .insert({
      user_id: userId,
      rune_id: context.rune.id,
      onboarding_session_id: context.session.id,
      config_version: configVersion,
      cards: updatedCards,
      user_facing_summary: currentVersion?.user_facing_summary || [],
      raw_recommendation: currentVersion?.raw_recommendation || {},
      validation_errors: validationErrors,
    })
    .select("id")
    .single()

  if (insertError && !isStateStorageUnavailable(insertError)) throw insertError
  if (!version) return { ok: false, code: "card_edit_failed", message: "Could not save that edit." }

  const { error: updateError } = await supabaseServiceRole
    .from("onboarding_sessions")
    .update({
      current_recommendation_version_id: version.id,
      config_version: configVersion,
      state: "recommendation_ready",
      updated_at: nowIso(),
    })
    .eq("id", context.session.id)

  if (updateError && !isStateStorageUnavailable(updateError)) throw updateError

  await recordOnboardingEvent(
    userId,
    "card_edited",
    {
      card_id: cardId,
      card_type: updatedCard.type,
      field_names: Object.keys(editableFields),
      config_version: configVersion,
    },
    "server",
    context.session.state
  )

  return { ok: true }
}

export async function applyRecommendationPatchOperations(
  userId: string,
  operations: OnboardingPatchOperation[],
  summary: string
): Promise<{ ok: true; applied_count: number } | { ok: false; code: string; message: string }> {
  const context = await getOrCreateOnboardingContext(userId)
  if (!context.available) return { ok: false, code: "state_storage_unavailable", message: "Onboarding state is not ready." }
  if (!context.session.current_recommendation_version_id) {
    return { ok: false, code: "recommendation_missing", message: "No recommendation is ready to refine." }
  }

  const { data: currentVersion, error: readError } = await supabaseServiceRole
    .from("onboarding_recommendation_versions")
    .select("cards, user_facing_summary, raw_recommendation")
    .eq("id", context.session.current_recommendation_version_id)
    .maybeSingle()

  if (readError) {
    if (isStateStorageUnavailable(readError)) {
      return { ok: false, code: "state_storage_unavailable", message: "Onboarding state is not ready." }
    }
    throw readError
  }

  const cards = Array.isArray(currentVersion?.cards) ? [...currentVersion.cards] : []
  if (cards.length === 0) {
    return { ok: false, code: "recommendation_missing", message: "No editable cards are ready." }
  }

  const configVersion = context.session.config_version + 1
  const updatedCardIds: string[] = []

  for (const operation of operations || []) {
    if (operation.op !== "update_card") continue
    const cardIndex = cards.findIndex((card: any) => card.id === operation.card_id)
    if (cardIndex < 0) {
      return { ok: false, code: "card_not_found", message: `Card ${operation.card_id} no longer exists.` }
    }

    const editableFields = sanitizeCardEditFields(operation.fields || {})
    if (Object.keys(editableFields).length === 0) continue

    const updatedCard = validateCard({
      ...cards[cardIndex],
      ...editableFields,
      updated_at: nowIso(),
      config_version: configVersion,
    })
    const errors = Array.isArray(updatedCard.validation_errors) ? updatedCard.validation_errors : []
    if (errors.length > 0) {
      return {
        ok: false,
        code: "refinement_would_make_card_invalid",
        message: `That refinement needs one more detail: ${errors.join(", ")}.`,
      }
    }

    cards[cardIndex] = updatedCard
    updatedCardIds.push(operation.card_id)
  }

  if (updatedCardIds.length === 0) {
    return { ok: false, code: "empty_refinement_patch", message: "I need a more specific change to apply." }
  }

  const hasNonDeliveryCard = cards.some((card: any) => card.type !== "delivery")
  const hasMeaningfulFocus = cards.some((card: any) =>
    (card.type === "news" && isMeaningfulFocus(card.focus)) ||
    (card.type === "lesson" && isMeaningfulFocus(card.topic)) ||
    (card.type === "inbox" && card.preference_status === "wanted")
  )

  if (!hasNonDeliveryCard || !hasMeaningfulFocus) {
    return {
      ok: false,
      code: "minimum_intent_would_break",
      message: "That would leave the Rune without a clear focus. What should it track instead?",
    }
  }

  const validationErrors = cards.flatMap((card: any) =>
    Array.isArray(card.validation_errors) ? card.validation_errors : []
  )

  const { data: version, error: insertError } = await supabaseServiceRole
    .from("onboarding_recommendation_versions")
    .insert({
      user_id: userId,
      rune_id: context.rune.id,
      onboarding_session_id: context.session.id,
      config_version: configVersion,
      cards,
      user_facing_summary: currentVersion?.user_facing_summary || [],
      raw_recommendation: currentVersion?.raw_recommendation || {},
      validation_errors: validationErrors,
    })
    .select("id")
    .single()

  if (insertError && !isStateStorageUnavailable(insertError)) throw insertError
  if (!version) return { ok: false, code: "refinement_save_failed", message: "Could not save that refinement." }

  const { error: updateError } = await supabaseServiceRole
    .from("onboarding_sessions")
    .update({
      current_recommendation_version_id: version.id,
      config_version: configVersion,
      state: "recommendation_ready",
      updated_at: nowIso(),
    })
    .eq("id", context.session.id)

  if (updateError && !isStateStorageUnavailable(updateError)) throw updateError

  await recordOnboardingEvent(
    userId,
    "refinement_applied",
    {
      summary,
      operation_count: updatedCardIds.length,
      card_ids: updatedCardIds,
      config_version: configVersion,
    },
    "server",
    context.session.state
  )

  return { ok: true, applied_count: updatedCardIds.length }
}

export async function markOnboardingApproved(userId: string): Promise<void> {
  const context = await getOrCreateOnboardingContext(userId)
  if (!context.available) return

  await transitionOnboardingState(userId, "approved", "approved", {
    config_version: context.session.config_version,
  })
}

export async function markOnboardingComplete(userId: string): Promise<void> {
  const context = await getOrCreateOnboardingContext(userId)
  if (!context.available) return

  await Promise.all([
    transitionOnboardingState(userId, "complete", "complete", {
      config_version: context.session.config_version,
    }),
    supabaseServiceRole
      .from("runes")
      .update({ status: "active", updated_at: nowIso() })
      .eq("id", context.rune.id),
  ])
}

function cardStatus(validationErrors: string[]): CardStatus {
  return validationErrors.length > 0 ? "invalid" : "valid"
}

function sanitizeCardEditFields(fields: Record<string, unknown>): Record<string, unknown> {
  const blocked = new Set([
    "id",
    "rune_id",
    "type",
    "status",
    "validation_errors",
    "updated_at",
    "config_version",
    "user_id",
  ])
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields || {})) {
    if (!blocked.has(key)) clean[key] = value
  }
  return clean
}

function validateCard(card: Record<string, any>): Record<string, unknown> {
  const validationErrors: string[] = []

  if (card.type === "news") {
    if (!isMeaningfulFocus(card.focus)) validationErrors.push("focus must be specific")
    if (!card.scope_summary) validationErrors.push("scope_summary is required")
    if (!Array.isArray(card.retrieval_queries) || card.retrieval_queries.length === 0) {
      validationErrors.push("retrieval_queries are required")
    }
    if (!Array.isArray(card.required_terms) || card.required_terms.length === 0) {
      validationErrors.push("required_terms are required")
    }
    if (
      Array.isArray(card.preferred_sources) &&
      Array.isArray(card.blocked_sources) &&
      card.preferred_sources.some((source: string) => card.blocked_sources.includes(source))
    ) {
      validationErrors.push("blocked_sources cannot overlap preferred_sources")
    }
  }

  if (card.type === "lesson") {
    if (!isMeaningfulFocus(card.topic)) validationErrors.push("topic must be specific")
    if (!card.curriculum_goal) validationErrors.push("curriculum_goal is required")
  }

  if (card.type === "inbox") {
    if (
      Array.isArray(card.selected_senders) &&
      Array.isArray(card.blocked_senders) &&
      card.selected_senders.some((sender: any) => card.blocked_senders.includes(sender.address || sender))
    ) {
      validationErrors.push("selected_senders cannot overlap blocked_senders")
    }
  }

  if (card.type === "delivery") {
    if (!/^\d{2}:\d{2}$/.test(String(card.send_time || ""))) validationErrors.push("send_time must be HH:mm")
    if (!card.timezone) validationErrors.push("timezone is required")
  }

  return {
    ...card,
    status: cardStatus(validationErrors),
    validation_errors: validationErrors,
  }
}

export function recommendationToCards(runeId: string, recommendation: any, configVersion: number): Array<Record<string, unknown>> {
  const updatedAt = nowIso()
  const slots = Array.isArray(recommendation?.slot_allocation) ? recommendation.slot_allocation : []
  const cards: Array<Record<string, unknown>> = []

  for (const slot of slots) {
    const slotNumber = Number(slot.slot || cards.length + 1)
    if (slot.type === "news") {
      const validationErrors: string[] = []
      if (!isMeaningfulFocus(slot.focus)) validationErrors.push("focus must be specific")
      if (!slot.scope_summary) validationErrors.push("scope_summary is required")
      if (!Array.isArray(slot.retrieval_queries) || slot.retrieval_queries.length === 0) {
        validationErrors.push("retrieval_queries are required")
      }
      if (!Array.isArray(slot.required_terms) || slot.required_terms.length === 0) {
        validationErrors.push("required_terms are required")
      }
      cards.push({
        id: `news-${slotNumber}`,
        rune_id: runeId,
        type: "news",
        title: "Daily Intelligence",
        rationale: slot.rationale || "",
        status: cardStatus(validationErrors),
        validation_errors: validationErrors,
        updated_at: updatedAt,
        focus: slot.focus || "",
        scope_summary: slot.scope_summary || "",
        tracked_entities: Array.isArray(slot.tracked_entities) ? slot.tracked_entities : [],
        preferred_sources: [],
        blocked_sources: [],
        avoid_terms: [],
        retrieval_queries: Array.isArray(slot.retrieval_queries) ? slot.retrieval_queries : [],
        required_terms: Array.isArray(slot.required_terms) ? slot.required_terms : [],
        config_version: configVersion,
      })
    }

    if (slot.type === "lesson") {
      const validationErrors: string[] = []
      if (!isMeaningfulFocus(slot.focus)) validationErrors.push("topic must be specific")
      if (!slot.curriculum_goal) validationErrors.push("curriculum_goal is required")
      cards.push({
        id: `lesson-${slotNumber}`,
        rune_id: runeId,
        type: "lesson",
        title: "Learning Track",
        rationale: slot.rationale || "",
        status: cardStatus(validationErrors),
        validation_errors: validationErrors,
        updated_at: updatedAt,
        topic: slot.focus || "",
        starting_level: slot.starting_level || "beginner",
        curriculum_goal: slot.curriculum_goal || "",
        depth: "standard",
        scope_summary: slot.scope_summary || "",
        config_version: configVersion,
      })
    }

    if (slot.type === "email") {
      cards.push({
        id: `inbox-${slotNumber}`,
        rune_id: runeId,
        type: "inbox",
        title: "Inbox Curation",
        rationale: slot.rationale || "",
        status: "valid",
        validation_errors: [],
        updated_at: updatedAt,
        preference_status: "wanted",
        scan_status: "complete",
        selected_senders: (slot.priority_senders || []).map((address: string) => ({ address })),
        blocked_senders: [],
        content_types: recommendation?.inbox_curation_plan?.email_types_to_surface || [],
        gap_note: recommendation?.inbox_curation_plan?.gap_note || "",
        config_version: configVersion,
      })
    }
  }

  cards.push({
    id: "delivery",
    rune_id: runeId,
    type: "delivery",
    title: "Delivery",
    status: "valid",
    validation_errors: [],
    updated_at: updatedAt,
    cadence: "daily",
    send_time: "07:00",
    timezone: "America/New_York",
    length: "standard",
    style: "morning-brief",
    config_version: configVersion,
  })

  return cards
}

export async function makeMutationResponse(
  userId: string,
  previousState: OnboardingState,
  error?: OnboardingMutationResponse["error"]
): Promise<OnboardingMutationResponse> {
  return {
    ok: !error,
    previous_state: previousState,
    snapshot: await buildOnboardingSnapshot(userId),
    error,
  }
}
