"use client"

import Link from "next/link"
import { useRef, useEffect, useMemo } from "react"
import { useLang } from "@/components/lang-context"
import { pickLandingCopy } from "@/lib/landing-copy"
import { cn } from "@/lib/utils"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { isLeanMotion, prefersReducedMotion } from "@/lib/motion-performance"
import { batchReveal } from "@/lib/motion-reveal"

gsap.registerPlugin(ScrollTrigger)

const colophonPanel =
  "relative overflow-hidden rounded-sm border border-violet-500/30 bg-violet-950/10 p-5 shadow-[inset_0_1px_0_rgba(139,92,246,0.08),0_4px_24px_rgba(0,0,0,0.55)] transition-[border-color,box-shadow] duration-300 hover:border-violet-400/50 hover:bg-violet-950/15 hover:shadow-[0_0_24px_rgba(139,92,246,0.08)]"

const colophonLabel =
  "mb-4 flex items-center gap-2 font-mono text-[9px] font-semibold uppercase tracking-[0.32em] text-violet-400/90"

export function ColophonSection() {
  const { lang } = useLang()
  const c = useMemo(() => pickLandingCopy(lang).colophon, [lang])

  const sectionRef = useRef<HTMLElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!sectionRef.current) return

    const ctx = gsap.context(() => {
      // phase-motion: batched compositor-only reveals; reduced motion stays static.
      if (isLeanMotion()) {
        if (prefersReducedMotion()) return
        batchReveal([headerRef.current].filter(Boolean) as Element[], { x: -60 })
        batchReveal(
          [...(gridRef.current?.querySelectorAll(":scope > div") ?? []), footerRef.current].filter(
            Boolean,
          ) as Element[],
          { y: 40 },
        )
        return
      }

      // Header slide in
      if (headerRef.current) {
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
      }

      // Grid columns fade up with stagger
      if (gridRef.current) {
        const columns = gridRef.current.querySelectorAll(":scope > div")
        gsap.from(columns, {
          y: 40,
          opacity: 0,
          duration: 0.8,
          stagger: 0.1,
          ease: "power3.out",
          scrollTrigger: {
            trigger: gridRef.current,
            start: "top 85%",
            toggleActions: "play none none reverse",
          },
        })
      }

      // Footer fade in
      if (footerRef.current) {
        gsap.from(footerRef.current, {
          y: 20,
          opacity: 0,
          duration: 0.8,
          ease: "power3.out",
          scrollTrigger: {
            trigger: footerRef.current,
            start: "top 95%",
            toggleActions: "play none none reverse",
          },
        })
      }
    }, sectionRef)

    return () => ctx.revert()
  }, [lang])

  return (
    <section
      ref={sectionRef}
      id="colophon"
      className="relative overflow-hidden border-t border-violet-500/20 py-20 md:py-28"
    >
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(139, 92, 246, 0.06), transparent 55%), radial-gradient(ellipse 60% 40% at 80% 100%, rgba(139, 92, 246, 0.04), transparent 50%)",
        }}
      />

      <div className="relative z-[1]">
        {/* Section header */}
        <div ref={headerRef} className="mb-10 md:mb-14 max-w-3xl">
          <span className="inline-block font-mono text-[10px] uppercase tracking-[0.28em] text-violet-400/90">
            {c.sectionEyebrow}
          </span>
          <h2 className="mt-3 font-[var(--font-bebas)] text-4xl tracking-tight text-foreground sm:text-5xl md:text-6xl md:leading-[0.95]">
            {c.sectionTitle}
          </h2>
          <div className="mt-4 h-px max-w-[12rem] bg-gradient-to-r from-violet-400/60 via-violet-400/20 to-transparent" />
        </div>

        {/* Multi-column layout — tighter rhythm, max width so columns don’t feel lost on ultra-wide */}
        <div
          ref={gridRef}
          className="mx-auto grid max-w-5xl grid-cols-1 gap-5 sm:grid-cols-2 lg:max-w-none lg:grid-cols-4 lg:gap-5 xl:gap-6"
        >
          <div className={cn(colophonPanel, "col-span-1")}>
            <h3 className={colophonLabel}>
              <span className="text-violet-400/80" aria-hidden>
                ◈
              </span>
              {c.networkLabel}
            </h3>
            <ul className="space-y-2.5">
              {c.networkLines.map((line) => (
                <li
                  key={line}
                  className="border-l-2 border-violet-500/40 pl-3 font-mono text-[12px] leading-snug text-zinc-200/90"
                >
                  {line}
                </li>
              ))}
            </ul>
          </div>

          <div className={cn(colophonPanel, "col-span-1")}>
            <h3 className={colophonLabel}>
              <span className="text-violet-400/80" aria-hidden>
                ◈
              </span>
              {c.standardLabel}
            </h3>
            <ul className="space-y-2.5">
              {c.standardLines.map((line) => (
                <li
                  key={line}
                  className="border-l-2 border-violet-500/40 pl-3 font-mono text-[12px] leading-snug text-zinc-200/90"
                >
                  {line}
                </li>
              ))}
            </ul>
          </div>

          <div className={cn(colophonPanel, "col-span-1 lg:col-span-1")}>
            <h3 className={colophonLabel}>
              <span className="text-violet-400/80" aria-hidden>
                ▣
              </span>
              {c.docLabel}
            </h3>
            <p className="mb-5 font-mono text-[10px] leading-relaxed text-zinc-400/90">
              {lang === "es" ? "Especificación, recompensas y API." : "Spec, rewards, and API reference."}
            </p>
            <Link
              href={c.docHref}
              className="group inline-flex w-full items-center justify-center border border-violet-500/50 bg-violet-950/30 px-5 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-violet-100 transition-all duration-200 hover:border-violet-400/80 hover:bg-violet-950/50 hover:text-white active:scale-[0.98]"
            >
              {c.docButton.replace(/[\[\]]/g, "").trim()}
            </Link>
          </div>

          <div className={cn(colophonPanel, "col-span-1")}>
            <h3 className={colophonLabel}>
              <span className="text-violet-400/80" aria-hidden>
                ◈
              </span>
              {c.developerLabel}
            </h3>
            <ul className="flex flex-col gap-2">
              <li>
                <a
                  href="https://github.com/PHASE-STELLAR/Phase.git"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-full items-center justify-between gap-2 border border-violet-500/30 bg-black/30 px-3 py-2.5 font-mono text-[11px] text-zinc-300/90 transition-colors hover:border-violet-400/55 hover:bg-violet-950/20 hover:text-white"
                >
                  <span>{c.developerGithubLabel}</span>
                  <span className="text-violet-400/50" aria-hidden>
                    ↗
                  </span>
                </a>
              </li>
              <li>
                <a
                  href="https://x.com/Darkvader-ship-it"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-full items-center justify-between gap-2 border border-violet-500/30 bg-black/30 px-3 py-2.5 font-mono text-[11px] text-zinc-300/90 transition-colors hover:border-violet-400/55 hover:bg-violet-950/20 hover:text-white"
                >
                  <span>{c.developerXLabel}</span>
                  <span className="text-violet-400/50" aria-hidden>
                    ↗
                  </span>
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom copyright */}
        <div
          ref={footerRef}
          className="mt-16 flex flex-col gap-4 border-t border-violet-500/15 pt-10 md:mt-20 md:flex-row md:items-center md:justify-between"
        >
          <p className="max-w-prose font-mono text-[10px] uppercase leading-relaxed tracking-[0.18em] text-muted-foreground/90">
            {c.copyright}
          </p>
          <p className="font-mono text-[10px] italic tracking-wide text-violet-300/50 md:text-right">{c.tagline}</p>
        </div>
      </div>
    </section>
  )
}
