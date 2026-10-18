"use client"

import { useEffect, useState } from "react"
import { useLang } from "@/components/lang-context"

// ── EST time via timeapi.io ────────────────────────────────────────────────────
// Fetch once to get the EST↔device offset, tick locally, re-sync every 5 min.
let estOffsetMs    = 0
let estOffsetReady = false

type TimeApiResponse = {
  hour: number; minute: number; seconds: number
  year: number; month: number; day: number
}

async function syncEstOffset(): Promise<void> {
  try {
    const before = Date.now()
    const res = await fetch(
      "https://timeapi.io/api/Time/current/zone?timeZone=America/New_York",
      { cache: "no-store" },
    )
    const after = Date.now()
    if (!res.ok) return
    const data: TimeApiResponse = await res.json()
    const mid   = Math.round((before + after) / 2)
    const estMs = Date.UTC(data.year, data.month - 1, data.day, data.hour, data.minute, data.seconds)
    estOffsetMs    = estMs - mid
    estOffsetReady = true
  } catch { /* keep previous offset */ }
}

function pad2(n: number) { return String(n).padStart(2, "0") }

function computeEstTime(): string {
  const d = new Date(Date.now() + estOffsetMs)
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
}

// ── All live stats ─────────────────────────────────────────────────────────────
type LiveStats = {
  ledger:     string
  closedAgo:  string
  baseFee:    string
  rpcStatus:  string
  rpcLatency: string
  xlmUsd:     string
  systemOk:   boolean
}

const INIT: LiveStats = {
  ledger:     "···",
  closedAgo:  "···",
  baseFee:    "···",
  rpcStatus:  "···",
  rpcLatency: "···",
  xlmUsd:     "···",
  systemOk:   true,
}

async function fetchAllStats(): Promise<Partial<LiveStats>> {
  const out: Partial<LiveStats> = {}

  // Stellar Horizon — ledger + fees
  try {
    const [rootRes, feeRes] = await Promise.all([
      fetch("https://horizon-testnet.stellar.org/",          { cache: "no-store" }),
      fetch("https://horizon-testnet.stellar.org/fee_stats", { cache: "no-store" }),
    ])
    const root = await rootRes.json() as { history_latest_ledger?: number; history_latest_ledger_closed_at?: string }
    const fees = await feeRes.json() as { last_ledger_base_fee?: number }
    out.ledger  = root.history_latest_ledger != null ? String(root.history_latest_ledger) : "—"
    out.baseFee = fees.last_ledger_base_fee  != null ? `${fees.last_ledger_base_fee} STROOP` : "—"
    if (root.history_latest_ledger_closed_at) {
      const diff = Math.round((Date.now() - new Date(root.history_latest_ledger_closed_at).getTime()) / 1000)
      out.closedAgo = diff < 60 ? `${diff}s` : `${Math.round(diff / 60)}m`
    }
    out.systemOk = true
  } catch {
    out.systemOk = false
  }

  // Soroban RPC — health + latency
  try {
    const before  = Date.now()
    const rpcRes  = await fetch("https://soroban-testnet.stellar.org", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      cache:   "no-store",
    })
    const ms      = Date.now() - before
    const rpcData = await rpcRes.json() as { result?: { status?: string } }
    out.rpcStatus  = rpcData?.result?.status === "healthy" ? "OK" : "DEGRADED"
    out.rpcLatency = `${ms}ms`
  } catch {
    out.rpcStatus  = "ERR"
    out.rpcLatency = "—"
  }

  // XLM/USD price — CoinGecko free tier (no key required)
  try {
    const priceRes  = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd",
      { cache: "no-store" },
    )
    const priceData = await priceRes.json() as { stellar?: { usd?: number } }
    const usd       = priceData?.stellar?.usd
    out.xlmUsd = usd != null ? `$${Number(usd).toFixed(4)}` : "—"
  } catch {
    out.xlmUsd = "—"
  }

  return out
}

// ── Design tokens ──────────────────────────────────────────────────────────────
const C = {
  bg:     "oklch(0.065 0.014 222)",
  border: "oklch(0.22 0.04 220 / 0.35)",
  accent: "#4ecece",
  label:  "#6b9ab8",
  colon:  "#243d52",
  value:  "#7aaec8",
  sep:    "#1a2e3d",
  dim:    "#223342",
}

// ── Entry structure ────────────────────────────────────────────────────────────
type KV    = { k: string; v: string }
type Entry = { title: string; pairs: [KV] | [KV, KV] }

function buildEntries(s: LiveStats, lang: "en" | "es"): Entry[] {
  const es = lang === "es"
  return [
    {
      title: es ? "SISTEMA" : "SYSTEM",
      pairs: [
        { k: es ? "ESTADO" : "STATUS",  v: s.systemOk ? (es ? "OPERATIVO" : "ONLINE") : (es ? "DEGRADADO" : "DEGRADED") },
        { k: es ? "RED"    : "NETWORK", v: "TESTNET" },
      ],
    },
    {
      title: es ? "LEDGER STELLAR" : "STELLAR LEDGER",
      pairs: [
        { k: "SEQ",                      v: s.ledger },
        { k: es ? "CIERRE" : "CLOSE",   v: s.closedAgo },
      ],
    },
    {
      title: es ? "COMISION RED" : "NETWORK FEE",
      pairs: [
        { k: es ? "TARIFA" : "BASE",   v: s.baseFee },
        { k: es ? "RED"    : "CHAIN",  v: "TESTNET" },
      ],
    },
    {
      title: "XLM",
      pairs: [
        { k: es ? "PRECIO"   : "PRICE",  v: s.xlmUsd },
        { k: es ? "MERCADO"  : "MARKET", v: "STELLAR" },
      ],
    },
    {
      title: "SOROBAN RPC",
      pairs: [
        { k: es ? "ESTADO"   : "STATUS",  v: s.rpcStatus },
        { k: es ? "LATENCIA" : "LATENCY", v: s.rpcLatency },
      ],
    },
    {
      title: "EST",
      pairs: [
        { k: es ? "HORA" : "TIME", v: "__LIVE__" },
      ],
    },
    {
      title: es ? "PROTOCOLO PHASE" : "PHASE PROTOCOL",
      pairs: [
        { k: es ? "RED"       : "NETWORK",   v: "TESTNET" },
        { k: es ? "CONTRATOS" : "CONTRACTS", v: es ? "ACTIVOS" : "ACTIVE" },
      ],
    },
    {
      title: es ? "NFT SEP-50" : "SEP-50 NFT",
      pairs: [
        { k: es ? "ESTANDAR" : "STANDARD", v: es ? "CUMPLE"  : "COMPLIANT" },
        { k: "ABI",                         v: es ? "LIMPIO"  : "CLEAN"     },
      ],
    },
  ]
}

// ── Node rendering ─────────────────────────────────────────────────────────────
function EntryNode({ entry, liveTime, id }: { entry: Entry; liveTime: string; id: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 0 }}>
      <span style={{ color: C.dim, marginRight: "0.55em" }}>▸</span>
      <span style={{ color: C.accent, fontWeight: 700, letterSpacing: "0.09em", marginRight: "1.1em" }}>
        {entry.title}
      </span>
      {entry.pairs.map((kv, i) => {
        const val = kv.v === "__LIVE__" ? liveTime : kv.v
        return (
          <span key={`${id}-kv${i}`} style={{ display: "inline-flex", alignItems: "center", marginRight: "1.1em" }}>
            <span style={{ color: C.label, letterSpacing: "0.06em" }}>{kv.k}</span>
            <span style={{ color: C.colon, margin: "0 0.15em" }}>:</span>
            <span style={{ color: C.value, fontWeight: 600, letterSpacing: "0.06em", marginLeft: "0.1em" }}>{val}</span>
          </span>
        )
      })}
      <span style={{ color: C.sep, margin: "0 1em", letterSpacing: 0 }}>│</span>
    </span>
  )
}

// ── Static CSS (outside component — avoids SSR/client hydration mismatch) ──────
const TICKER_CSS = `
  @keyframes phase-ticker-scroll {
    from { transform: translateX(0); }
    to   { transform: translateX(-50%); }
  }
  .phase-ticker-track {
    display: inline-flex;
    align-items: center;
    white-space: nowrap;
    will-change: transform;
    animation: phase-ticker-scroll 120s linear infinite;
  }
  .phase-ticker-track:hover {
    animation-play-state: paused;
  }
  /* phase-164: the marquee is already a transform animation, so the permanent
     layer hint only costs memory; reduced motion freezes it. */
  html[data-phase-motion="lean"] .phase-ticker-track {
    will-change: auto;
  }
  @media (prefers-reduced-motion: reduce) {
    html[data-phase-motion="lean"] .phase-ticker-track {
      animation: none;
    }
  }
`

// ── Component ──────────────────────────────────────────────────────────────────
export function SystemTicker() {
  const { lang }                = useLang()
  const [liveTime, setLiveTime] = useState("")
  const [stats,    setStats]    = useState<LiveStats>(INIT)

  // EST time: initial API sync + tick every second + re-sync every 5 min
  useEffect(() => {
    syncEstOffset()
      .then(() => { if (estOffsetReady) setLiveTime(computeEstTime()) })
      .catch(() => {})
    const syncId = setInterval(() => { syncEstOffset().catch(() => {}) }, 5 * 60_000)
    const tickId = setInterval(() => { if (estOffsetReady) setLiveTime(computeEstTime()) }, 1_000)

    return () => { clearInterval(tickId); clearInterval(syncId) }
  }, [])

  // Live stats — every 15 s
  useEffect(() => {
    let alive = true
    const run = () => {
      fetchAllStats()
        .then(fresh => { if (alive) setStats(prev => ({ ...prev, ...fresh } as LiveStats)) })
        .catch(() => { /* network errors are handled inside fetchAllStats */ })
    }
    run()
    const id = setInterval(run, 15_000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const entries = buildEntries(stats, lang)

  return (
    <>
      <style suppressHydrationWarning>{TICKER_CSS}</style>
      <div
        aria-label="System status ticker"
        role="marquee"
        style={{
          position:     "relative",
          overflow:     "hidden",
          height:       "2.25rem",
          lineHeight:   "2.25rem",
          background:   C.bg,
          borderBottom: `1px solid ${C.border}`,
          fontFamily:   "var(--font-ibm-plex-mono), 'IBM Plex Mono', 'Courier New', monospace",
          fontSize:     "0.68rem",
          textTransform:"uppercase",
          userSelect:   "none",
          zIndex:        45,
        }}
      >
        <span aria-hidden style={{ position:"absolute", left:0, top:0, bottom:0, width:"4rem", zIndex:2, pointerEvents:"none", background:`linear-gradient(to right, ${C.bg}, transparent)` }} />
        <span aria-hidden style={{ position:"absolute", right:0, top:0, bottom:0, width:"4rem", zIndex:2, pointerEvents:"none", background:`linear-gradient(to left,  ${C.bg}, transparent)` }} />

        <div className="phase-ticker-track">
          {entries.map((e, i) => <EntryNode key={`a${i}`} entry={e} liveTime={liveTime} id={`a${i}`} />)}
          {entries.map((e, i) => <EntryNode key={`b${i}`} entry={e} liveTime={liveTime} id={`b${i}`} />)}
        </div>
      </div>
    </>
  )
}
