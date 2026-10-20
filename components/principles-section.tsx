"use client"

import { useRef, useEffect, useMemo } from "react"
import { HighlightText } from "@/components/highlight-text"
import { useLang } from "@/components/lang-context"
import { pickLandingCopy } from "@/lib/landing-copy"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { isLeanMotion, prefersReducedMotion } from "@/lib/motion-performance"
import { batchReveal } from "@/lib/motion-reveal"

gsap.registerPlugin(ScrollTrigger)

export function PrinciplesSection() {
  const { lang } = useLang()
  const landing = useMemo(() => pickLandingCopy(lang), [lang])
  const { sectionEyebrow, sectionTitle, items: principles } = landing.principles

  const sectionRef = useRef<HTMLElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const principlesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!sectionRef.current || !headerRef.current || !principlesRef.current) return

    const ctx = gsap.context(() => {
      // phase-motion: batched compositor-only reveals; reduced motion stays static.
      if (isLeanMotion()) {
        if (prefersReducedMotion()) return
        const items = Array.from(principlesRef.current?.querySelectorAll("article") ?? [])
        batchReveal([headerRef.current!], { x: -60 })
        batchReveal(items.filter((_, i) => principles[i]?.align !== "right"), { x: -80 }, { start: "top 85%" })
        batchReveal(items.filter((_, i) => principles[i]?.align === "right"), { x: 80 }, { start: "top 85%" })
        return
      }

      // Header slide in
      gsap.from(headerRef.current, {
        x: -60,
        opacity: 0,
        duration: 1,
        ease: "power3.out",
        scrollTrigger: {
          trigger: headerRef.current,
          start: "top 85%",
          toggleActions: "play none none reverse",
        },
      })

      // Each principle slides in from its aligned side
      const articles = principlesRef.current?.querySelectorAll("article")
      articles?.forEach((article, index) => {
        const isRight = principles[index].align === "right"
        gsap.from(article, {
          x: isRight ? 80 : -80,
          opacity: 0,
          duration: 1,
          ease: "power3.out",
          scrollTrigger: {
            trigger: article,
            start: "top 85%",
            toggleActions: "play none none reverse",
          },
        })
      })
    }, sectionRef)

    return () => ctx.revert()
  }, [lang, principles])

  return (
    <section ref={sectionRef} id="principles" className="relative border-t border-border/20 py-20 md:py-32">
      {/* Section header */}
      <div ref={headerRef} className="mb-16 md:mb-24 max-w-3xl">
        <span className="font-mono text-[10px] tracking-wide text-accent">{sectionEyebrow}</span>
        <h2 className="mt-3 md:mt-4 font-[var(--font-bebas)] text-4xl sm:text-5xl md:text-7xl tracking-tight leading-[0.95]">
          {sectionTitle}
        </h2>
      </div>

      {/* Staggered principles */}
      <div ref={principlesRef} className="space-y-16 md:space-y-24 lg:space-y-32">
        {principles.map((principle, index) => (
          <article
            key={index}
            className={`flex flex-col ${
              principle.align === "right" ? "items-end text-right" : "items-start text-left"
            }`}
          >
            {/* Annotation label */}
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-4">
              {principle.number} / {principle.category}
            </span>

            <h3 className="font-[var(--font-bebas)] text-3xl sm:text-4xl md:text-6xl lg:text-8xl tracking-tight leading-[0.92] break-words max-w-full">
              {principle.titleParts.map((part, i) =>
                part.highlight ? (
                  <HighlightText key={i} parallaxSpeed={0.6}>
                    {part.text}
                  </HighlightText>
                ) : (
                  <span key={i}>{part.text}</span>
                ),
              )}
            </h3>

            {/* Description */}
            <p className="mt-5 md:mt-6 max-w-md font-mono text-xs sm:text-sm text-muted-foreground leading-relaxed">
              {principle.description}
            </p>

            {/* Decorative line */}
            <div className={`mt-8 h-[1px] bg-border w-24 md:w-48 ${principle.align === "right" ? "mr-0" : "ml-0"}`} />
          </article>
        ))}
      </div>
    </section>
  )
}
