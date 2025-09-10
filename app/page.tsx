import HeroClient from '@/components/HeroClient'

export default function Home() {
  return (
    <>
      <HeroClient />
      <section className="relative py-24 sm:py-32">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            <div className="h-80 rounded-xl border border-white/10 bg-white/5 p-6 shadow-lg backdrop-blur-sm"></div>
            <div className="h-80 rounded-xl border border-white/10 bg-white/5 p-6 shadow-lg backdrop-blur-sm"></div>
            <div className="h-80 rounded-xl border border-white/10 bg-white/5 p-6 shadow-lg backdrop-blur-sm"></div>
          </div>
        </div>
      </section>
    </>
  )
}
