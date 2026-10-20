"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useLang } from "@/components/lang-context"
import { useWallet } from "@/components/wallet-provider"
import {
  buildPlaygroundRequest,
  exampleBody,
  fencePlaygroundCall,
  interpretPlaygroundResponse,
  playgroundOperations,
  WALLET_FILLED_FIELDS,
  type InterpretedResponse,
  type PlaygroundInput,
  type PlaygroundOperation,
} from "@/lib/api-playground"
import { fillCopy, pickCopy } from "@/lib/phase-copy"
import { NETWORK_PASSPHRASE } from "@/lib/phase-protocol"

const APP_PASSPHRASE = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE?.trim() || NETWORK_PASSPHRASE

type Outcome =
  | { type: "response"; sentCorrelationId: string; res: InterpretedResponse }
  | { type: "message"; text: string }

function emptyInput(op: PlaygroundOperation): PlaygroundInput {
  return { pathParams: {}, query: {}, body: exampleBody(op) }
}

async function walletPassphrase(): Promise<string | null> {
  try {
    const { kit, initStellarWalletKit } = await import("@/lib/stellar-wallet-kit")
    initStellarWalletKit()
    const { networkPassphrase } = await kit.getNetwork()
    return networkPassphrase || null
  } catch {
    return null
  }
}

/** Client-only signing: the signature comes from the wallet extension, never from the server. */
async function signBody(op: PlaygroundOperation, body: string, address: string): Promise<string> {
  if (!WALLET_FILLED_FIELDS[op.id]) return body
  const parsed = JSON.parse(body || "{}") as Record<string, unknown>
  const timestamp = Date.now()
  const { signSignalPayload } = await import("@/lib/viewer-signature")
  const signature = await signSignalPayload(
    { title: String(parsed.title ?? "").trim(), body: String(parsed.body ?? "").trim(), timestamp },
    address,
  )
  return JSON.stringify({ ...parsed, wallet: address, timestamp, signature })
}

/** phase-docs-playground: try-it-live console for the documented API surface. */
export function DocsApiPlayground() {
  const { lang } = useLang()
  const copy = pickCopy(lang)
  const t = copy.playground
  const { address, connect, connecting } = useWallet()
  const ops = useMemo(() => playgroundOperations(), [])
  const [opId, setOpId] = useState(ops[0].id)
  const op = ops.find((o) => o.id === opId) ?? ops[0]
  // One input record per operation, never cleared by a response, so errors cannot eat the user's work.
  const [inputs, setInputs] = useState<Record<string, PlaygroundInput>>({})
  const input = inputs[op.id] ?? emptyInput(op)
  const [apiVersion, setApiVersion] = useState("")
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [retryUntil, setRetryUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (retryUntil <= Date.now()) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [retryUntil])
  const retryLeft = Math.max(0, Math.ceil((retryUntil - now) / 1000))

  const patch = useCallback(
    (next: Partial<PlaygroundInput>) => setInputs((prev) => ({ ...prev, [op.id]: { ...input, ...next } })),
    [op.id, input],
  )

  const fenceFor = (passphrase: string | null) =>
    fencePlaygroundCall(op, { appPassphrase: APP_PASSPHRASE, walletAddress: address, walletPassphrase: passphrase })

  const staticFence = fenceFor(null)
  const needsWallet = op.signing === "wallet"

  async function send() {
    setBusy(true)
    setOutcome(null)
    try {
      const passphrase = address && (op.stateChanging || needsWallet) ? await walletPassphrase() : null
      const fence = fenceFor(passphrase)
      if (!fence.allowed) {
        setOutcome({ type: "message", text: t.fence[fence.reason] })
        return
      }

      let body = input.body
      if (needsWallet && address) {
        try {
          body = await signBody(op, body, address)
        } catch {
          setOutcome({ type: "message", text: `${t.signFailed} ${t.inputKept}` })
          return
        }
      }

      const correlationId = crypto.randomUUID()
      const built = buildPlaygroundRequest(op, { ...input, body }, {
        correlationId,
        apiVersion: apiVersion.trim() || undefined,
      })
      if (!built.ok) {
        setOutcome({ type: "message", text: `${fillCopy(t.buildErrors[built.error], { field: built.detail ?? "" })} ${t.inputKept}` })
        return
      }

      let res: Response
      try {
        res = await fetch(built.url, { ...built.init, cache: "no-store" })
      } catch {
        setOutcome({ type: "message", text: `${t.networkError} ${t.inputKept}` })
        return
      }
      const interpreted = interpretPlaygroundResponse(
        { status: res.status, headers: res.headers, bodyText: await res.text() },
        { lines: copy.chamber.phaseHostContractErrors, unknownTpl: copy.chamber.phaseHostContractUnknown },
      )
      if (interpreted.kind === "rate_limited" && interpreted.retryAfterSec) {
        const until = Date.now() + interpreted.retryAfterSec * 1000
        setRetryUntil(until)
        setNow(Date.now())
      }
      setOutcome({ type: "response", sentCorrelationId: correlationId, res: interpreted })
    } finally {
      setBusy(false)
    }
  }

  const label = "font-mono text-[9px] font-bold uppercase tracking-[0.28em] text-violet-500/70"
  const field =
    "w-full border border-violet-500/25 bg-black/60 px-3 py-2 font-mono text-[11px] text-zinc-200 outline-none focus:border-violet-400/60"
  const badge = "border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em]"
  const canSend = !busy && retryLeft === 0 && op.mode === "callable"

  return (
    <div className="space-y-5 border border-violet-500/25 bg-violet-950/10 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-2">
          <span className={label}>{t.operation}</span>
          <select
            className={field}
            value={op.id}
            onChange={(e) => {
              setOpId(e.target.value)
              setOutcome(null)
            }}
          >
            {ops.map((o) => (
              <option key={o.id} value={o.id}>
                {o.method} {o.path} · {o.id}
              </option>
            ))}
          </select>
        </label>
        {needsWallet ? (
          address ? (
            <span className="font-mono text-[10px] text-cyan-300/80">
              {fillCopy(t.walletConnected, { address: `${address.slice(0, 4)}…${address.slice(-4)}` })}
            </span>
          ) : (
            <button
              type="button"
              disabled={connecting}
              onClick={() => void connect().catch(() => {})}
              className="border border-cyan-500/40 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-200 hover:border-cyan-300 disabled:opacity-50"
            >
              {t.connectWallet}
            </button>
          )
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {op.stateChanging ? (
          <>
            <span className={`${badge} border-amber-500/40 text-amber-300/90`}>{t.badges.stateChanging}</span>
            <span className={`${badge} border-emerald-500/30 text-emerald-400/80`}>{t.badges.testnetOnly}</span>
          </>
        ) : null}
        {needsWallet ? <span className={`${badge} border-cyan-500/40 text-cyan-300/90`}>{t.badges.walletSigned}</span> : null}
        {op.mode === "docs_only" ? <span className={`${badge} border-zinc-500/40 text-zinc-400`}>{t.badges.docsOnly}</span> : null}
      </div>

      {op.mode === "docs_only" && op.docsOnlyReason ? (
        <p className="font-sans text-[12px] text-zinc-400">{t.docsOnly[op.docsOnlyReason]}</p>
      ) : null}

      {op.pathParams?.length ? (
        <fieldset className="space-y-2">
          <legend className={label}>{t.pathParams}</legend>
          {op.pathParams.map((name) => (
            <input
              key={name}
              aria-label={name}
              placeholder={name}
              className={field}
              value={input.pathParams[name] ?? ""}
              onChange={(e) => patch({ pathParams: { ...input.pathParams, [name]: e.target.value } })}
            />
          ))}
        </fieldset>
      ) : null}

      {op.query?.length ? (
        <fieldset className="space-y-2">
          <legend className={label}>{t.query}</legend>
          {op.query.map((name) => (
            <input
              key={name}
              aria-label={name}
              placeholder={name}
              className={field}
              value={input.query[name] ?? ""}
              onChange={(e) => patch({ query: { ...input.query, [name]: e.target.value } })}
            />
          ))}
        </fieldset>
      ) : null}

      {op.body && op.method !== "GET" && op.mode === "callable" ? (
        <label className="flex flex-col gap-2">
          <span className="flex items-center justify-between">
            <span className={label}>{t.body}</span>
            <button
              type="button"
              className="font-mono text-[9px] uppercase tracking-[0.2em] text-violet-400/80 hover:text-violet-200"
              onClick={() => patch({ body: exampleBody(op) })}
            >
              {t.resetBody}
            </button>
          </span>
          <textarea
            className={`${field} min-h-[10rem]`}
            spellCheck={false}
            value={input.body}
            onChange={(e) => patch({ body: e.target.value })}
          />
        </label>
      ) : null}

      <label className="flex flex-col gap-2">
        <span className={label}>{t.apiVersion}</span>
        <input className={field} placeholder="YYYY-MM-DD" value={apiVersion} onChange={(e) => setApiVersion(e.target.value)} />
        <span className="font-sans text-[11px] text-zinc-500">{t.apiVersionHint}</span>
      </label>

      {!staticFence.allowed && staticFence.reason !== "docs_only" ? (
        <p className="font-sans text-[12px] text-amber-300/90">{t.fence[staticFence.reason]}</p>
      ) : null}

      <button
        type="button"
        disabled={!canSend}
        onClick={() => void send()}
        className="border-2 border-violet-400/50 bg-violet-950/30 px-5 py-3 font-mono text-[11px] uppercase tracking-[0.25em] text-violet-100 hover:border-violet-300 disabled:opacity-40"
      >
        {busy ? t.sending : needsWallet ? t.signAndSend : t.send}
      </button>
      {retryLeft > 0 ? (
        <p className="font-sans text-[12px] text-amber-300/90">{fillCopy(t.retryIn, { sec: retryLeft })}</p>
      ) : null}

      {outcome?.type === "message" ? (
        <p role="alert" className="font-sans text-[12px] text-rose-300/90">
          {outcome.text}
        </p>
      ) : null}

      {outcome?.type === "response" ? (
        <div className="space-y-3" aria-live="polite">
          <dl className="grid grid-cols-1 gap-2 font-mono text-[10px] sm:grid-cols-2">
            <div>
              <dt className={label}>{t.status}</dt>
              <dd className="mt-1 text-zinc-200">
                {outcome.res.status} · {t.kinds[outcome.res.kind]}
              </dd>
            </div>
            <div>
              <dt className={label}>{t.versionEchoed}</dt>
              <dd className="mt-1 text-zinc-200">{outcome.res.apiVersion ?? "—"}</dd>
            </div>
            <div>
              <dt className={label}>{t.correlationSent}</dt>
              <dd className="mt-1 break-all text-zinc-200">{outcome.sentCorrelationId}</dd>
            </div>
            <div>
              <dt className={label}>{t.correlationEchoed}</dt>
              <dd className="mt-1 break-all text-zinc-200">{outcome.res.correlationId ?? "—"}</dd>
            </div>
          </dl>
          {outcome.res.domainMessage ? (
            <p className="font-mono text-[11px] text-rose-300/90">{outcome.res.domainMessage}</p>
          ) : null}
          {outcome.res.rpcError ? (
            <p className="font-mono text-[11px] text-rose-300/90">
              {outcome.res.rpcError.code ?? "?"}: {outcome.res.rpcError.message}
            </p>
          ) : null}
          {outcome.res.kind !== "ok" ? <p className="font-sans text-[11px] text-zinc-500">{t.inputKept}</p> : null}
          <p className={label}>{t.response}</p>
          <pre className="max-h-96 overflow-auto border border-violet-500/20 bg-black/60 p-4 font-mono text-[10px] leading-relaxed text-zinc-300/85">
            {outcome.res.bodyText}
          </pre>
        </div>
      ) : null}
    </div>
  )
}
