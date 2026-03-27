"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { MotionPathPlugin } from 'gsap/MotionPathPlugin'
import AuthDialog from '@/components/AuthDialog'
import { Button } from '@/components/ui/button'

gsap.registerPlugin(MotionPathPlugin)

const FUTHARK_GLYPHS = [
  'ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᚷ', 'ᚹ', 'ᚺ', 'ᚾ',
  'ᛁ', 'ᛃ', 'ᛈ', 'ᛇ', 'ᛉ', 'ᛊ', 'ᛏ', 'ᛒ', 'ᛖ', 'ᛗ',
  'ᛚ', 'ᛜ', 'ᛞ', 'ᛟ',
]

const ATMOSPHERIC_WORDS = [
  'Signal', 'Dawn', 'Wisdom', 'Clarity', 'Foresight', 'Oracle',
  'Insight', 'Current', 'Pulse', 'Thread', 'Cipher', 'Beacon',
]

type FloatingElement = {
  id: string
  text: string
  size: number
  isGlyph: boolean
}

function buildElements(count: number): FloatingElement[] {
  const elements: FloatingElement[] = []
  for (let i = 0; i < count; i++) {
    const isGlyph = Math.random() < 0.65
    const pool = isGlyph ? FUTHARK_GLYPHS : ATMOSPHERIC_WORDS
    const text = pool[Math.floor(Math.random() * pool.length)]
    elements.push({
      id: `el_${i}_${text}`,
      text,
      size: isGlyph ? 14 + Math.random() * 18 : 11 + Math.random() * 10,
      isGlyph,
    })
  }
  return elements
}

function useViewportSize() {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return size
}

export default function SynthesisHero() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const elementsRef = useRef<(HTMLDivElement | null)[]>([])
  const logoRef = useRef<HTMLDivElement | null>(null)
  const headlineRef = useRef<HTMLDivElement | null>(null)
  const ctaRef = useRef<HTMLDivElement | null>(null)
  const { width, height } = useViewportSize()

  const isMobile = width > 0 && width < 768
  const elementCount = isMobile ? 20 : 40

  const elements = useMemo(() => buildElements(elementCount), [elementCount])

  useEffect(() => {
    if (!containerRef.current || !width || !height) return

    const ctx = gsap.context(() => {
      elementsRef.current.forEach((el) => {
        if (!el) return
        animateElement(el, width, height)
      })

      if (logoRef.current) {
        gsap.to(logoRef.current, {
          textShadow: '0 0 30px rgba(255,255,255,0.35), 0 0 60px rgba(180,220,255,0.15), 0 0 8px rgba(255,255,255,0.2)',
          duration: 3,
          ease: 'power1.inOut',
          repeat: -1,
          yoyo: true,
        })
      }

      if (headlineRef.current) {
        gsap.fromTo(headlineRef.current, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 1.5, delay: 0.8, ease: 'power2.out' })
      }

      if (ctaRef.current) {
        gsap.fromTo(ctaRef.current, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 1.2, delay: 1.4, ease: 'power2.out' })
      }
    }, containerRef)

    return () => ctx.revert()
  }, [width, height, elements])

  const [signupOpen, setSignupOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)

  return (
    <section ref={containerRef} className="relative h-[100svh] w-full overflow-hidden hero-aurora">
      {/* Floating glyphs & words */}
      <div className="absolute inset-0 pointer-events-none">
        {elements.map((el, i) => (
          <div
            key={el.id}
            ref={(node) => { elementsRef.current[i] = node }}
            className="absolute select-none will-change-transform"
            style={{
              fontFamily: el.isGlyph ? 'serif' : 'var(--font-sans)',
              fontSize: el.size,
              fontWeight: el.isGlyph ? 300 : 400,
              letterSpacing: el.isGlyph ? '0' : '0.08em',
              opacity: 0,
            }}
          >
            {el.text}
          </div>
        ))}
      </div>

      {/* Faint sigil behind center */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none select-none"
        style={{
          fontFamily: 'serif',
          fontSize: isMobile ? '200px' : '280px',
          color: 'rgba(255,255,255,0.03)',
          lineHeight: 1,
        }}
        aria-hidden
      >
        ᛟ
      </div>

      {/* Center stack: wordmark + tagline + CTAs */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div
          ref={logoRef}
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: isMobile ? '80px' : '128px',
            color: 'white',
            textShadow: '0 0 12px rgba(255,255,255,0.15)',
            lineHeight: 1,
          }}
        >
          Rune
        </div>

        <div
          ref={headlineRef}
          className="mt-6 md:mt-8"
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: isMobile ? '14px' : '17px',
            color: 'rgba(234, 234, 234, 0.55)',
            letterSpacing: '0.08em',
            textAlign: 'center',
            opacity: 0,
          }}
        >
          <RotatingTagline />
        </div>

        <div
          ref={ctaRef}
          className="pointer-events-auto mt-14 md:mt-16 flex items-center gap-4"
          style={{ opacity: 0 }}
        >
          <Button
            size="lg"
            variant="outline"
            className="min-w-[132px] border-white/20 bg-white/8 px-8 text-white backdrop-blur-md hover:border-white/30 hover:bg-white/12"
            onClick={() => setSignupOpen(true)}
          >
            Sign Up
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="min-w-[132px] border-white/20 bg-white/5 px-8 text-white hover:border-white/30 hover:bg-white/10"
            onClick={() => setLoginOpen(true)}
          >
            Login
          </Button>
        </div>
      </div>

      <AuthDialog open={signupOpen} onOpenChange={setSignupOpen} initialMode="signup" />
      <AuthDialog open={loginOpen} onOpenChange={setLoginOpen} initialMode="login" />

      {/* Bottom gradient fade */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-[#0A0A12]" />
    </section>
  )
}

function animateElement(el: HTMLDivElement, vw: number, vh: number) {
  const safeZone = {
    x: vw / 2 - (vw < 768 ? 140 : 250),
    y: vh / 2 - (vw < 768 ? 100 : 150),
    w: vw < 768 ? 280 : 500,
    h: vw < 768 ? 200 : 300,
  }

  const run = () => {
    let startX: number, startY: number, fromBottom: boolean
    do {
      fromBottom = Math.random() > 0.5
      startX = fromBottom
        ? gsap.utils.random(-0.15 * vw, 0.6 * vw)
        : gsap.utils.random(0.4 * vw, 1.15 * vw)
      startY = fromBottom
        ? gsap.utils.random(0.5 * vh, 1.15 * vh)
        : gsap.utils.random(-0.15 * vh, 0.5 * vh)
    } while (
      startX > safeZone.x && startX < safeZone.x + safeZone.w &&
      startY > safeZone.y && startY < safeZone.y + safeZone.h
    )

    const angle = Math.random() * Math.PI * 2
    const endRadius = 80 + Math.random() * 40
    const endX = vw / 2 + Math.cos(angle) * endRadius
    const endY = vh / 2 + Math.sin(angle) * endRadius

    gsap.set(el, {
      x: startX,
      y: startY,
      opacity: 0,
      color: 'rgba(200,215,235,0.5)',
      textShadow: 'none',
      filter: 'blur(0px)',
    })

    const curveMag = fromBottom ? -1 : 1
    const path = [
      { x: startX, y: startY },
      {
        x: (startX + endX) / 2 + curveMag * vw * 0.2,
        y: (startY + endY) / 2 + curveMag * vh * -0.2,
      },
      { x: endX, y: endY },
    ]

    const duration = gsap.utils.random(6, 10)

    const tl = gsap.timeline({
      delay: gsap.utils.random(0, 6),
      onComplete: run,
    })

    tl.to(el, { opacity: 0.6, duration: duration * 0.15, ease: 'power1.in' }, 0)

    tl.to(el, {
      motionPath: { path, curviness: 1.5 },
      ease: 'power1.inOut',
      duration,
    }, 0)

    tl.to(el, {
      color: 'rgba(255,255,255,0.9)',
      textShadow: '0 0 12px rgba(180,220,255,0.4), 0 0 4px rgba(255,255,255,0.3)',
      ease: 'power2.in',
      duration: duration * 0.4,
    }, duration * 0.5)

    tl.to(el, {
      opacity: 0,
      filter: 'blur(10px)',
      ease: 'power1.in',
      duration: duration * 0.18,
    }, duration * 0.82)
  }

  run()
}

const TAGLINES = [
  'Intelligence, distilled at dawn.',
  'The signal beneath the noise.',
  'What matters, before it matters.',
  'Your world, briefed daily.',
  'Clarity, delivered every morning.',
]

function RotatingTagline() {
  const [index, setIndex] = useState(0)
  const spanRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const interval = setInterval(() => {
      if (!spanRef.current) return
      gsap.to(spanRef.current, {
        opacity: 0,
        duration: 0.6,
        ease: 'power1.in',
        onComplete: () => {
          setIndex((prev) => (prev + 1) % TAGLINES.length)
          gsap.to(spanRef.current, { opacity: 1, duration: 0.8, ease: 'power1.out' })
        },
      })
    }, 4000)
    return () => clearInterval(interval)
  }, [])

  return <span ref={spanRef}>{TAGLINES[index]}</span>
}
