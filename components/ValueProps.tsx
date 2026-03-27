"use client"

const PROPS = [
  {
    glyph: 'ᚺ',
    glowColor: 'rgba(80,200,200,0.6)',
    shadowColor: 'rgba(80,200,200,0.25)',
    title: 'Your inbox, decoded.',
    description: 'Newsletters and key emails — summarized, prioritized, delivered.',
  },
  {
    glyph: 'ᛗ',
    glowColor: 'rgba(160,120,220,0.6)',
    shadowColor: 'rgba(160,120,220,0.25)',
    title: 'Your world, briefed daily.',
    description: 'Every signal in your domain, surfaced before morning coffee.',
  },
  {
    glyph: 'ᚲ',
    glowColor: 'rgba(220,170,80,0.6)',
    shadowColor: 'rgba(220,170,80,0.25)',
    title: 'Get sharper, one day at a time.',
    description: 'Pick a topic. Get a 10-day curriculum, one lesson each morning.',
  },
]

export default function ValueProps() {
  return (
    <section className="relative py-20 sm:py-28 px-4">
      <div className="mx-auto max-w-5xl grid grid-cols-1 gap-5 md:grid-cols-3 md:gap-6">
        {PROPS.map((p) => (
          <div
            key={p.glyph}
            className="rounded-xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]"
          >
            <div
              className="mb-4 text-4xl select-none"
              style={{
                fontFamily: 'serif',
                color: p.glowColor,
                textShadow: `0 0 18px ${p.shadowColor}, 0 0 6px ${p.shadowColor}`,
              }}
            >
              {p.glyph}
            </div>
            <h3
              className="mb-2 text-lg font-semibold text-white"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              {p.title}
            </h3>
            <p className="text-sm leading-relaxed text-white/50">
              {p.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
