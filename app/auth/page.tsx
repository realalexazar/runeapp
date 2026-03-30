"use client"
import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function Auth() {
  const router = useRouter()

  useEffect(() => {
    router.replace("/")
  }, [router])

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-5 w-5 rounded-full border-2 border-white/10 border-t-white/40 animate-spin" />
    </div>
  )
}
