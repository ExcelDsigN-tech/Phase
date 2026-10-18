"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import { cn } from "@/lib/utils"
import { useLang } from "@/components/lang-context"
import { pickLandingCopy } from "@/lib/landing-copy"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { isLeanMotion, prefersReducedMotion } from "@/lib/motion-performance"
import { batchReveal } from "@/lib/motion-reveal"

gsap.registerPlugin(ScrollTrigger)

export function WorkSection() {
  const { lang } = useLang()
  const landing = useMemo(() => pickLandingCopy(lang), [lang])
  const { sectionEyebrow, sectionTitle, intro, modules: experiments } = landing.work
  const sectionRef = useRef<HTMLElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!sectionRef.current || !headerRef.current || !gridRef.current) return

    const ctx = gsap.context(() => {
      // phase-164: batched compositor-only reveals; reduced motion stays static.
      if (isLeanMotion()) {
        if (prefersReducedMotion()) return
        batchReveal([headerRef.current!], { x: -60 }, { start: "top 90%" })
        batchReveal(gridRef.current?.querySelectorAll("article"), { y: 60 }, { start: "top 90%" })
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
            start: "top 90%",
            toggleActions: "play none none reverse",
          },
        },
      )

      const cards = gridRef.current?.querySelectorAll("article")
      if (cards && cards.length > 0) {
        gsap.set(cards, { y: 60, opacity: 0 })
        gsap.to(cards, {
          y: 0,
          opacity: 1,
          duration: 0.8,
          stagger: 0.1,
          ease: "power3.out",
          scrollTrigger: {
            trigger: gridRef.current,
            start: "top 90%",
            toggleActions: "play none none reverse",
          },
        })
      }
    }, sectionRef)

    return () => ctx.revert()
  }, [lang])

  return (
    <section ref={sectionRef} id="work" className="relative border-t border-border/20 py-20 md:py-32">
      {/* Section header */}
      <div ref={headerRef} className="mb-12 md:mb-16 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <span className="font-mono text-[10px] tracking-wide text-accent">{sectionEyebrow}</span>
          <h2 className="mt-3 md:mt-4 font-[var(--font-bebas)] text-4xl sm:text-5xl md:text-7xl tracking-tight leading-[0.95]">
            {sectionTitle}
          </h2>
        </div>
        <p className="max-w-sm md:max-w-xs font-mono text-xs text-muted-foreground md:text-right leading-relaxed">
          {intro}
        </p>
      </div>

      {/* Asymmetric grid */}
      <div
        ref={gridRef}
        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 md:gap-6 auto-rows-[minmax(160px,auto)] sm:auto-rows-[180px] md:auto-rows-[200px]"
      >
        {experiments.map((experiment, index) => (
          <WorkCard key={index} experiment={experiment} index={index} persistHover={index === 0} />
        ))}
      </div>
    </section>
  )
}

function WorkCard({
  experiment,
  index,
  persistHover = false,
}: {
  experiment: {
    title: string
    medium: string
    description: string
    span: string
  }
  index: number
  persistHover?: boolean
}) {
  const [isHovered, setIsHovered] = useState(false)
  const cardRef = useRef<HTMLElement>(null)
  const [isScrollActive, setIsScrollActive] = useState(false)

  useEffect(() => {
    if (!persistHover || !cardRef.current) return

    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: cardRef.current,
        start: "top 80%",
        // phase-164: the trigger only ever fires once, so let it kill itself.
        once: isLeanMotion(),
        onEnter: () => setIsScrollActive(true),
      })
    }, cardRef)

    return () => ctx.revert()
  }, [persistHover])

  const isActive = isHovered || isScrollActive

  return (
    <article
      ref={cardRef}
      className={cn(
        "group relative border border-border/40 p-5 flex flex-col justify-between transition-all duration-500 cursor-pointer overflow-hidden",
        experiment.span,
        isActive && "border-accent/60",
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Background layer */}
      <div
        className={cn(
          "absolute inset-0 bg-accent/5 transition-opacity duration-500",
          isActive ? "opacity-100" : "opacity-0",
        )}
      />

      {/* Content */}
      <div className="relative z-10">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {experiment.medium}
        </span>
        <h3
          className={cn(
            "mt-3 font-[var(--font-bebas)] text-2xl md:text-4xl tracking-tight transition-colors duration-300",
            isActive ? "text-accent" : "text-foreground",
          )}
        >
          {experiment.title}
        </h3>
      </div>

      {/* Description - reveals on hover */}
      <div className="relative z-10">
        <p
          className={cn(
            "font-mono text-xs text-muted-foreground leading-relaxed transition-all duration-500 max-w-[min(100%,280px)]",
            isActive ? "opacity-100 translate-y-0" : "translate-y-0 opacity-75 sm:translate-y-2 sm:opacity-0",
          )}
        >
          {experiment.description}
        </p>
      </div>

      {/* Index marker */}
      <span
        className={cn(
          "absolute bottom-4 right-4 font-mono text-[10px] transition-colors duration-300",
          isActive ? "text-accent" : "text-muted-foreground/40",
        )}
      >
        {String(index + 1).padStart(2, "0")}
      </span>

      {/* Corner line */}
      <div
        className={cn(
          "absolute top-0 right-0 w-12 h-12 transition-all duration-500",
          isActive ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="absolute top-0 right-0 w-full h-[1px] bg-accent" />
        <div className="absolute top-0 right-0 w-[1px] h-full bg-accent" />
      </div>
    </article>
  )
}
