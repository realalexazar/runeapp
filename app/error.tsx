'use client'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }, reset: () => void }) {
  return (
    <section className="pb-24 pt-40">
      <div className="container text-center">
        <h1 className="text-3xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-muted-foreground">{error.message}</p>
        <button className="mt-6 underline" onClick={reset}>Try again</button>
      </div>
    </section>
  )
}



