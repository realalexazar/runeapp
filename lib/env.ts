import { z } from 'zod'

const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1)
})

type ClientEnv = z.infer<typeof clientEnvSchema>

let cachedClientEnv: ClientEnv | null = null

function getClientEnv(): ClientEnv {
  if (cachedClientEnv) return cachedClientEnv

  const parsed = clientEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  })

  if (!parsed.success) {
    console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors)
    throw new Error('Missing or invalid environment variables. Check .env.local')
  }

  cachedClientEnv = parsed.data
  return cachedClientEnv
}

export const env: ClientEnv = {
  get NEXT_PUBLIC_SUPABASE_URL() {
    return getClientEnv().NEXT_PUBLIC_SUPABASE_URL
  },
  get NEXT_PUBLIC_SUPABASE_ANON_KEY() {
    return getClientEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY
  }
}

