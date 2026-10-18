"use client"

import type React from "react"
import { motion } from "framer-motion"
import { useMemo, useState, useCallback, useEffect, useRef, createContext, useContext } from "react"
import { Volume2, VolumeX } from "lucide-react"
import {
  buildFlapSchedule,
  flapAudioAllowed,
  leanMotionFlag,
  prefersReducedMotion,
  withTransientWillChange,
} from "@/lib/motion-performance"

interface AudioContextType {
  isMuted: boolean
  toggleMute: () => void
  playClick: () => void
}

const SplitFlapAudioContext = createContext<AudioContextType | null>(null)

function useSplitFlapAudio() {
  return useContext(SplitFlapAudioContext)
}

export function SplitFlapAudioProvider({ children }: { children: React.ReactNode }) {
  const [isMuted, setIsMuted] = useState(true)
  const audioContextRef = useRef<AudioContext | null>(null)

  const getAudioContext = useCallback(() => {
    if (typeof window === "undefined") return null
    if (!audioContextRef.current) {
      const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (AudioContextClass) {
        audioContextRef.current = new AudioContextClass()
      }
    }
    return audioContextRef.current
  }, [])

  const triggerHaptic = useCallback(() => {
    if (isMuted) return
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(10)
    }
  }, [isMuted])

  const playClick = useCallback(() => {
    if (isMuted) return

    triggerHaptic()

    try {
      const ctx = getAudioContext()
      if (!ctx) return

      if (ctx.state === "suspended") {
        ctx.resume()
      }

      const oscillator = ctx.createOscillator()
      const gainNode = ctx.createGain()
      const filter = ctx.createBiquadFilter()
      const lowpass = ctx.createBiquadFilter()

      oscillator.type = "square"
      oscillator.frequency.setValueAtTime(800 + Math.random() * 400, ctx.currentTime)
      oscillator.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.015)

      filter.type = "bandpass"
      filter.frequency.setValueAtTime(1200, ctx.currentTime)
      filter.Q.setValueAtTime(0.8, ctx.currentTime)

      lowpass.type = "lowpass"
      lowpass.frequency.value = 2500
      lowpass.Q.value = 0.5

      gainNode.gain.setValueAtTime(0.05, ctx.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.02)

      oscillator.connect(filter)
      filter.connect(gainNode)
      gainNode.connect(lowpass)
      lowpass.connect(ctx.destination)

      oscillator.start(ctx.currentTime)
      oscillator.stop(ctx.currentTime + 0.02)
    } catch {
      // Audio not supported
    }
  }, [isMuted, getAudioContext, triggerHaptic])

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev)
    if (isMuted) {
      try {
        const ctx = getAudioContext()
        if (ctx && ctx.state === "suspended") {
          ctx.resume()
        }
      } catch {
        // Audio not supported
      }
    }
  }, [isMuted, getAudioContext])

  const value = useMemo(() => ({ isMuted, toggleMute, playClick }), [isMuted, toggleMute, playClick])

  return <SplitFlapAudioContext.Provider value={value}>{children}</SplitFlapAudioContext.Provider>
}

export function SplitFlapMuteToggle({ className = "" }: { className?: string }) {
  const audio = useSplitFlapAudio()
  if (!audio) return null

  return (
    <button
      onClick={audio.toggleMute}
      className={`inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors duration-200 ${className}`}
      aria-label={audio.isMuted ? "Unmute sound effects" : "Mute sound effects"}
    >
      {audio.isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
      <span>{audio.isMuted ? "Sound Off" : "Sound On"}</span>
    </button>
  )
}

interface SplitFlapTextProps {
  text: string
  className?: string
  speed?: number
}

const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("")

function SplitFlapTextInner({ text, className = "", speed = 50 }: SplitFlapTextProps) {
  const chars = useMemo(() => text.split(""), [text])
  const [animationKey, setAnimationKey] = useState(0)
  const [hasInitialized, setHasInitialized] = useState(false)
  const audio = useSplitFlapAudio()

  const handleMouseEnter = useCallback(() => {
    setAnimationKey((prev) => prev + 1)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      setHasInitialized(true)
    }, 1000)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div
      className={`inline-flex shrink-0 flex-nowrap gap-[0.06em] sm:gap-[0.08em] items-center cursor-pointer ${className}`}
      aria-label={text}
      onMouseEnter={handleMouseEnter}
      style={{ perspective: "1000px" }}
    >
      {chars.map((char, index) => (
        <SplitFlapChar
          key={index}
          char={char.toUpperCase()}
          index={index}
          animationKey={animationKey}
          skipEntrance={hasInitialized}
          speed={speed}
          playClick={audio?.playClick}
        />
      ))}
    </div>
  )
}

export function SplitFlapText(props: SplitFlapTextProps) {
  if (leanMotionFlag()) return <LeanSplitFlapText {...props} />
  return <SplitFlapTextInner {...props} />
}

/**
 * phase-164: the H1 renders its final glyphs on the server (nothing to wait for
 * at LCP), then scrambles by writing `textContent` directly, so no React render
 * runs per frame. The settle flip is one WAAPI transform with `will-change` set
 * only while it plays. Reduced motion skips the scramble, the flip and the audio.
 */
function LeanSplitFlapText({ text, className = "", speed = 50 }: SplitFlapTextProps) {
  const chars = useMemo(() => text.toUpperCase().split(""), [text])
  const tileRefs = useRef<(HTMLSpanElement | null)[]>([])
  const stopRef = useRef<(() => void) | null>(null)
  const audio = useSplitFlapAudio()
  const audioRef = useRef(audio)
  useEffect(() => {
    audioRef.current = audio
  }, [audio])

  const run = useCallback(
    (replay: boolean) => {
      stopRef.current?.()
      const reduced = prefersReducedMotion()
      const timers: ReturnType<typeof setTimeout>[] = []
      const intervals: ReturnType<typeof setInterval>[] = []
      const anims: Animation[] = []

      for (const step of buildFlapSchedule(text, { replay, reducedMotion: reduced })) {
        const el = tileRefs.current[step.index]
        if (!el) continue
        const finalChar = CHARSET.includes(step.char) ? step.char : "\u00A0"
        if (step.flips === 0) {
          el.textContent = finalChar
          continue
        }
        timers.push(
          setTimeout(() => {
            let flip = 0
            const id = setInterval(() => {
              if (flip >= step.flips) {
                clearInterval(id)
                el.textContent = finalChar
                if (typeof el.animate === "function") {
                  anims.push(
                    withTransientWillChange(el, ["transform"], () =>
                      el.animate([{ transform: "rotateX(-90deg)" }, { transform: "rotateX(0deg)" }], {
                        duration: 250,
                        easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
                      }),
                    ),
                  )
                }
                const a = audioRef.current
                if (a && flapAudioAllowed(a.isMuted, reduced)) a.playClick()
                return
              }
              el.textContent = CHARSET[Math.floor(Math.random() * CHARSET.length)]
              flip++
            }, speed)
            intervals.push(id)
          }, step.startDelayMs),
        )
      }

      const stop = () => {
        timers.forEach(clearTimeout)
        intervals.forEach(clearInterval)
        anims.forEach((anim) => anim.cancel())
        chars.forEach((c, i) => {
          const el = tileRefs.current[i]
          if (el) el.textContent = CHARSET.includes(c) ? c : "\u00A0"
        })
      }
      stopRef.current = stop
      return stop
    },
    [text, chars, speed],
  )

  useEffect(() => {
    const stop = run(false)
    return () => {
      stop()
      stopRef.current = null
    }
  }, [run])

  const displayFontSize = "clamp(2.35rem, 4.25vw + 1.35rem, 6.25rem)"

  return (
    <div
      className={`inline-flex shrink-0 flex-nowrap gap-[0.06em] sm:gap-[0.08em] items-center cursor-pointer font-[family-name:var(--font-bebas)] ${className}`}
      aria-label={text}
      onMouseEnter={() => run(true)}
      style={{ perspective: "1000px", fontSize: displayFontSize }}
    >
      {chars.map((char, index) =>
        char === " " ? (
          <span key={index} aria-hidden style={{ width: "0.3em" }} />
        ) : (
          <span
            key={index}
            aria-hidden
            ref={(el) => {
              tileRefs.current[index] = el
            }}
            className="phase-flap-tile inline-flex shrink-0 items-center justify-center leading-none"
            style={{ width: "0.68em", height: "1.05em", color: "#ffffff" }}
          >
            {CHARSET.includes(char) ? char : "\u00A0"}
          </span>
        ),
      )}
    </div>
  )
}

interface SplitFlapCharProps {
  char: string
  index: number
  animationKey: number
  skipEntrance: boolean
  speed: number
  playClick?: () => void
}

function SplitFlapChar({ char, index, animationKey, skipEntrance, speed, playClick }: SplitFlapCharProps) {
  const displayChar = CHARSET.includes(char) ? char : " "
  const isSpace = char === " "
  const [currentChar, setCurrentChar] = useState(skipEntrance ? displayChar : " ")
  const [isSettled, setIsSettled] = useState(skipEntrance)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const tileDelay = 0.15 * index
  const textColor = "#ffffff"

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)

    // Space tiles render a fixed spacer and never read currentChar / isSettled.
    if (isSpace) return

    // Legacy path, kept frame-identical while phase-164 is off. The lean path
    // (LeanSplitFlapText) has no per-frame React state at all.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsSettled(false)
    setCurrentChar(CHARSET[Math.floor(Math.random() * CHARSET.length)])

    const baseFlips = 8
    const startDelay = skipEntrance ? tileDelay * 400 : tileDelay * 800
    let flipIndex = 0
    let hasStartedSettling = false

    timeoutRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => {
        const settleThreshold = baseFlips + index * 3

        if (flipIndex >= settleThreshold && !hasStartedSettling) {
          hasStartedSettling = true
          if (intervalRef.current) clearInterval(intervalRef.current)
          setCurrentChar(displayChar)
          setIsSettled(true)
          if (playClick) playClick()
          return
        }
        setCurrentChar(CHARSET[Math.floor(Math.random() * CHARSET.length)])
        if (flipIndex % 2 === 0 && playClick) playClick()
        flipIndex++
      }, speed)
    }, startDelay)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [displayChar, isSpace, tileDelay, animationKey, skipEntrance, index, speed, playClick])

  /* "P H A S E" with spaces — slightly larger caps; still fits typical viewports */
  const displayFontSize = "clamp(2.35rem, 4.25vw + 1.35rem, 6.25rem)"

  if (isSpace) {
    return (
      <div
        style={{
          width: "0.3em",
          fontSize: displayFontSize,
        }}
      />
    )
  }

  return (
    <motion.div
      initial={skipEntrance ? false : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: tileDelay, duration: 0.3, ease: "easeOut" }}
      className="relative shrink-0 flex items-center justify-center font-[family-name:var(--font-bebas)]"
      style={{
        fontSize: displayFontSize,
        width: "0.68em",
        height: "1.05em",
        transformStyle: "preserve-3d",
        backgroundColor: "transparent",
      }}
    >
      {/* top half — clean horizontal split */}
      <div className="absolute inset-x-0 top-0 flex items-end justify-center" style={{ height: "50%", backgroundColor: "transparent" }}>
        <span
          className="block leading-none"
          style={{ color: textColor, transform: "translateY(50%)" }}
        >
          {currentChar}
        </span>
      </div>

      {/* bottom half — clean horizontal split */}
      <div className="absolute inset-x-0 bottom-0 flex items-start justify-center" style={{ height: "50%", backgroundColor: "transparent" }}>
        <span
          className="leading-none"
          style={{ color: textColor, transform: "translateY(-50%)" }}
        >
          {currentChar}
        </span>
      </div>

      <motion.div
        key={`${animationKey}-${isSettled}`}
        initial={{ rotateX: -90 }}
        animate={{ rotateX: 0 }}
        transition={{
          delay: skipEntrance ? tileDelay * 0.5 : tileDelay + 0.15,
          duration: 0.25,
          ease: [0.22, 0.61, 0.36, 1],
        }}
        className="absolute inset-x-0 top-0"
        style={{
          height: "50%",
          backgroundColor: "transparent",
          transformStyle: "preserve-3d",
          backfaceVisibility: "hidden",
          transformOrigin: "bottom",
        }}
      >
        <div className="flex h-full items-end justify-center">
          <span
            className="leading-none"
            style={{ color: textColor, transform: "translateY(50%)" }}
          >
            {currentChar}
          </span>
        </div>
      </motion.div>
    </motion.div>
  )
}
