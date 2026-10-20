"use client"

import { useEffect, useRef } from "react"
import { SplitFlapText, SplitFlapAudioProvider } from "@/components/split-flap-text"
import { useWallet } from "@/components/wallet-provider"
import { useLang, type AppLang } from "@/components/lang-context"
import { pickLandingCopy } from "@/lib/landing-copy"
import Link from "next/link"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { isLeanMotion, prefersReducedMotion, supportsScrollTimeline } from "@/lib/motion-performance"

gsap.registerPlugin(ScrollTrigger)

const copy: Record<
  AppLang,
  {
    body: string
    accessProtocol: string
    connectWallet: string
    connectingWallet: string
    protocolLogs: string
    walletHint: string
    creatorForge: string
    viewMarket: string
  }
> = {
  en: {
    body: "PHASE is a cryptographic paywall for AI-generated NFTs on Stellar.\nPay once with PHASELQ. The ledger confirms. Your artifact is minted — permanently sealed on IPFS, owned on Soroban.",
    accessProtocol: "[ MINT_NFT ]",
    connectWallet: "[ CONNECT_WALLET ]",
    connectingWallet: "[ CONNECTING... ]",
    protocolLogs: "Protocol Logs",
    walletHint: "Connect your wallet to mint your first PHASE NFT.",
    creatorForge: "Forge",
    viewMarket: "[ VIEW_MARKET ]",
  },
  es: {
    body: "PHASE es un sistema de pago criptográfico para NFTs generados por IA en Stellar.\nPaga una vez con PHASELQ. El ledger confirma. Tu artefacto se mintea — sellado para siempre en IPFS, propiedad en Soroban.",
    accessProtocol: "[ MINTEAR ]",
    connectWallet: "[ CONECTAR_BILLETERA ]",
    connectingWallet: "[ CONECTANDO... ]",
    protocolLogs: "Registros del protocolo",
    walletHint: "Conecta tu billetera para mintear tu primer NFT PHASE.",
    creatorForge: "Forja",
    viewMarket: "[ VER_MERCADO ]",
  },
}

export function HeroSection() {
  const { address, connecting, connect } = useWallet()
  const { lang } = useLang()
  const t = copy[lang]
  const landing = pickLandingCopy(lang)

  const sectionRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!sectionRef.current || !contentRef.current) return

    // phase-motion: the LCP section fades on the compositor via a CSS scroll
    // timeline; the gsap scrub stays as the fallback for older engines.
    if (isLeanMotion()) {
      if (prefersReducedMotion()) return
      if (supportsScrollTimeline()) {
        const el = contentRef.current
        el.classList.add("phase-hero-scroll-fade")
        return () => el.classList.remove("phase-hero-scroll-fade")
      }
    }

    const ctx = gsap.context(() => {
      gsap.to(contentRef.current, {
        y: -100,
        opacity: 0,
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top top",
          end: "bottom top",
          scrub: 1,
        },
      })
    }, sectionRef)

    return () => ctx.revert()
  }, [])

  return (
    <section
      ref={sectionRef}
      id="hero"
      className="relative min-h-[100dvh] flex items-center justify-center py-16 md:py-0"
    >
      {/* Left vertical labels */}
      <div className="absolute left-0 md:left-1 top-1/2 -translate-y-1/2 hidden sm:block z-[1]">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground -rotate-90 origin-left block whitespace-nowrap">
          SIGNAL
        </span>
      </div>

      {/* Main content — centered within shell; title scales to width */}
      <div ref={contentRef} className="w-full min-w-0 max-w-4xl mx-auto px-1 sm:px-4">
        <SplitFlapAudioProvider>
          <div className="relative w-full flex justify-center overflow-hidden">
            <SplitFlapText text="P H A S E" speed={80} className="max-w-full" />
          </div>
        </SplitFlapAudioProvider>

        <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-[0.35em] text-muted-foreground/70">
          {landing.studioBrand}
        </p>
        <h2 className="font-[var(--font-bebas)] text-muted-foreground/88 text-center text-[clamp(1.2rem,2.8vw,2rem)] mt-3 md:mt-4 tracking-[0.09em] leading-tight">
          AI generation. On-chain proof. No subscriptions.
        </h2>

        <p className="mt-6 md:mt-10 max-w-2xl mx-auto text-center font-mono text-sm text-muted-foreground/90 leading-relaxed whitespace-pre-line">
          {t.body}
        </p>

        <div className="mt-10 md:mt-14 flex flex-col items-center justify-center gap-6 sm:gap-8">
          <Link
            href="/dashboard"
            className="group inline-flex w-fit items-center gap-3 border-2 border-cyan-400/55 bg-cyan-950/20 px-8 py-4 font-mono text-xs uppercase tracking-[0.25em] text-cyan-100 transition-all duration-200 hover:border-cyan-300 hover:bg-cyan-900/35 hover:text-white mx-auto"
          >
            <span className="text-cyan-300 transition-transform group-hover:translate-x-0.5">▣</span>
            {t.viewMarket}
          </Link>
          {address ? (
            <Link
              href="/chamber"
              className="group inline-flex w-fit items-center gap-3 border-2 border-foreground/30 px-8 py-4 font-mono text-xs uppercase tracking-[0.25em] text-foreground transition-all duration-200 hover:border-accent hover:bg-accent/5 hover:text-accent mx-auto"
            >
              <span className="text-accent transition-transform group-hover:translate-x-0.5">▸</span>
              {t.accessProtocol}
            </Link>
          ) : (
            <div className="flex flex-col items-center gap-2 mx-auto w-full sm:w-auto">
              <button
                type="button"
                disabled={connecting}
                onClick={() => void connect().catch(() => {})}
                className="group inline-flex w-fit items-center gap-3 border-2 border-foreground/30 px-8 py-4 font-mono text-xs uppercase tracking-[0.25em] text-foreground transition-all duration-200 hover:border-accent hover:bg-accent/5 hover:text-accent disabled:opacity-50"
              >
                <span className="text-muted-foreground transition-transform group-hover:text-accent">○</span>
                {connecting ? t.connectingWallet : t.connectWallet}
              </button>
              <p className="max-w-sm text-center font-mono text-[10px] text-muted-foreground/80 leading-relaxed">
                {t.walletHint}
              </p>
            </div>
          )}
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-6">
            <Link
              href="/forge"
              className="font-mono text-xs uppercase tracking-widest text-[#00ffff]/80 hover:text-[#00ffff] transition-colors duration-200 text-center"
            >
              {t.creatorForge}
            </Link>
            <a
              href="#signals"
              className="font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-accent transition-colors duration-200 text-center"
            >
              {t.protocolLogs}
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
