import { Resend } from "resend"
import { supabaseServiceRole } from "@/lib/supabase/service"

const RESEND_API_KEY = process.env.RESEND_API_KEY
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "Rune <onboarding@resend.dev>"

function getResendClient() {
  if (!RESEND_API_KEY) {
    throw new Error("Missing RESEND_API_KEY")
  }
  return new Resend(RESEND_API_KEY)
}

export async function sendDigestEmail(input: {
  userId: string
  digestId: string
  toEmail?: string | null
  subjectOverride?: string | null
}) {
  const { data: digest, error: digestError } = await supabaseServiceRole
    .from("digests")
    .select("id, digest_date, html_content, text_content, metadata, status")
    .eq("id", input.digestId)
    .eq("user_id", input.userId)
    .single()

  if (digestError || !digest) {
    throw new Error(`Digest not found: ${digestError?.message || "unknown error"}`)
  }

  const recipient = input.toEmail || (await supabaseServiceRole.auth.admin.getUserById(input.userId)).data.user?.email
  if (!recipient) {
    throw new Error("Could not determine recipient email")
  }

  const resend = getResendClient()
  const subject = input.subjectOverride || digest.metadata?.subject || `Your Daily Rune · ${digest.digest_date}`

  try {
    const result = await resend.emails.send({
      from: RESEND_FROM_EMAIL,
      to: recipient,
      subject,
      html: digest.html_content || "<p>No digest content.</p>",
      text: digest.text_content || "No digest content."
    })

    const nextMetadata = {
      ...(digest.metadata || {}),
      email_delivery: {
        recipient,
        provider: "resend",
        provider_message_id: (result.data as any)?.id || null
      }
    }

    await supabaseServiceRole
      .from("digests")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        metadata: nextMetadata
      })
      .eq("id", digest.id)

    return {
      recipient,
      provider_message_id: (result.data as any)?.id || null
    }
  } catch (e: any) {
    await supabaseServiceRole
      .from("digests")
      .update({
        status: "failed",
        metadata: {
          ...(digest.metadata || {}),
          email_delivery_error: String(e?.message || e)
        }
      })
      .eq("id", digest.id)

    throw e
  }
}

