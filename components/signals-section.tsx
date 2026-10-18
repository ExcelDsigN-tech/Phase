"use client"

import { useRef, useState, useEffect, useMemo } from "react"
import { cn } from "@/lib/utils"
import { useLang } from "@/components/lang-context"
import { pickLandingCopy } from "@/lib/landing-copy"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { isLeanMotion, prefersReducedMotion } from "@/lib/motion-performance"
import { batchReveal } from "@/lib/motion-reveal"

gsap.registerPlugin(ScrollTrigger)

export function SignalsSection() {
  const { lang } = useLang()
  const landing = useMemo(() => pickLandingCopy(lang), [lang])
  const { sectionEyebrow, sectionTitle, items: signals } = landing.signals
  const scrollRef = useRef<HTMLDivElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const cardsRef = useRef<HTMLDivElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const [isHovering, setIsHovering] = useState(false)

  useEffect(() => {
    if (!sectionRef.current || !cursorRef.current) return

    const section = sectionRef.current
    const cursor = cursorRef.current
    const lean = isLeanMotion()
    if (lean && prefersReducedMotion()) return

    // phase-164: reuse two quickTo setters instead of allocating a tween per mousemove.
    const moveX = lean ? gsap.quickTo(cursor, "x", { duration: 0.5, ease: "power3.out" }) : null
    const moveY = lean ? gsap.quickTo(cursor, "y", { duration: 0.5, ease: "power3.out" }) : null

    const handleMouseMove = (e: MouseEvent) => {
      const rect = section.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      if (moveX && moveY) {
        moveX(x)
        moveY(y)
        return
      }

      gsap.to(cursor, {
        x: x,
        y: y,
        duration: 0.5,
        ease: "power3.out",
      })
    }

    const handleMouseEnter = () => setIsHovering(true)
    const handleMouseLeave = () => setIsHovering(false)

    section.addEventListener("mousemove", handleMouseMove)
    section.addEventListener("mouseenter", handleMouseEnter)
    section.addEventListener("mouseleave", handleMouseLeave)

    return () => {
      section.removeEventListener("mousemove", handleMouseMove)
      section.removeEventListener("mouseenter", handleMouseEnter)
      section.removeEventListener("mouseleave", handleMouseLeave)
      if (lean) gsap.killTweensOf(cursor)
    }
  }, [])

  useEffect(() => {
    if (!sectionRef.current || !headerRef.current || !cardsRef.current) return

    const ctx = gsap.context(() => {
      // phase-164: batched compositor-only reveals; reduced motion stays static.
      if (isLeanMotion()) {
        if (prefersReducedMotion()) return
        batchReveal([headerRef.current!], { x: -60 })
        batchReveal(cardsRef.current?.querySelectorAll("article"), { x: -100 }, { stagger: 0.2 })
        return
      }

      // Header slide in from left
      gsap.fromTo(
        headerRef.current,
        { x: -60, opacity: 0 },
        {
          x: 0,
          opacity: 1,
          duration: 1,
          ease: "power3.out",
          scrollTrigger: {
            trigger: headerRef.current,
            start: "top 85%",
            toggleActions: "play none none reverse",
          },
        },
      )

      const cards = cardsRef.current?.querySelectorAll("article")
      if (cards) {
        gsap.fromTo(
          cards,
          { x: -100, opacity: 0 },
          {
            x: 0,
            opacity: 1,
            duration: 0.8,
            stagger: 0.2,
            ease: "power3.out",
            scrollTrigger: {
              trigger: cardsRef.current,
              start: "top 90%",
              toggleActions: "play none none reverse",
            },
          },
        )
      }
    }, sectionRef)

    return () => ctx.revert()
  }, [lang])

  return (
    <section id="signals" ref={sectionRef} className="relative border-t border-border/20 py-20 md:py-32">
      <div
        ref={cursorRef}
        className={cn(
          "pointer-events-none absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 z-50",
          "w-12 h-12 rounded-full border-2 border-accent bg-accent",
          "transition-opacity duration-300",
          isHovering ? "opacity-100" : "opacity-0",
        )}
      />

      {/* Section header */}
      <div ref={headerRef} className="mb-12 md:mb-16 max-w-3xl">
        <span className="font-mono text-[10px] tracking-wide text-accent">{sectionEyebrow}</span>
        <h2 className="mt-3 md:mt-4 font-[var(--font-bebas)] text-4xl sm:text-5xl md:text-7xl tracking-tight leading-[0.95]">
          {sectionTitle}
        </h2>
      </div>

      {/* Horizontal scroll container */}
      <div
        ref={(el) => {
          scrollRef.current = el
          cardsRef.current = el
        }}
        className="flex gap-6 md:gap-8 overflow-x-auto pb-8 -mx-1 px-1 pr-4 md:pr-8 scrollbar-hide [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] md:[mask-image:none]"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {signals.map((signal, index) => (
          <SignalCard key={index} signal={signal} index={index} />
        ))}
      </div>
    </section>
  )
}

function SignalCard({
  signal,
  index,
}: {
  signal: { date: string; title: string; note: string }
  index: number
}) {
  return (
    <article
      className={cn(
        "group relative flex-shrink-0 w-[min(100%,20rem)] sm:w-80",
        "transition-transform duration-500 ease-out",
        "hover:-translate-y-2",
      )}
    >
      {/* Card with paper texture effect */}
      <div className="relative bg-card/80 border border-border/60 md:border-t md:border-l md:border-r-0 md:border-b-0 p-6 sm:p-8 backdrop-blur-[2px]">
        {/* Top torn edge effect */}
        <div className="absolute -top-px left-0 right-0 h-px bg-gradient-to-r from-transparent via-border/40 to-transparent" />

        {/* Issue number - editorial style */}
        <div className="flex items-baseline justify-between mb-8">
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            No. {String(index + 1).padStart(2, "0")}
          </span>
          <time className="font-mono text-[10px] text-muted-foreground/60">{signal.date}</time>
        </div>

        {/* Title */}
        <h3 className="font-[var(--font-bebas)] text-4xl tracking-tight mb-4 group-hover:text-accent transition-colors duration-300">
          {signal.title}
        </h3>

        {/* Divider line */}
        <div className="w-12 h-px bg-accent/60 mb-6 group-hover:w-full transition-all duration-500" />

        {/* Description */}
        <p className="font-mono text-xs text-muted-foreground leading-relaxed">{signal.note}</p>

        {/* Bottom right corner fold effect */}
        <div className="absolute bottom-0 right-0 w-6 h-6 overflow-hidden">
          <div className="absolute bottom-0 right-0 w-8 h-8 bg-background rotate-45 translate-x-4 translate-y-4 border-t border-l border-border/30" />
        </div>
      </div>

      {/* Shadow/depth layer */}
      <div className="absolute inset-0 -z-10 translate-x-1 translate-y-1 bg-accent/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
    </article>
  )
}
