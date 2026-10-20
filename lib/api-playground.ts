/**
 * Spike 662 (phase-docs-playground): pure logic behind the docs "try it live" console.
 *
 * The UI (`components/docs-api-playground.tsx`) stays thin: this module builds
 * typed requests from the shared contract (`lib/api-contract.ts`), fences
 * state-changing calls to testnet, and classifies responses (HTTP-200 JSON-RPC
 * errors, the x402 shim's conditional 503, 429 + Retry-After) without ever
 * touching the user's input. Signing stays client-side in the component; this
 * module never sees a key or a signature it did not get from the wallet.
 */

import { API_OPERATIONS, type ApiOperation } from "./api-contract"
import { humanizePhaseHostErrorMessage, parsePhaseContractErrorCode, redactHostErrorMessage } from "./phase-host-error"

export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015"

export const GATE_CLOSED_MESSAGE = "[ ERROR: BIOMETRIC_TRUST_GATE_CLOSED ]"

export type PlaygroundMode = "callable" | "docs_only"

export type PlaygroundOperation = ApiOperation & {
  mode: PlaygroundMode
  /** Why a docs-only operation cannot be sent from the console. */
  docsOnlyReason?: "multipart_upload" | "needs_built_xdr" | "preflight"
}

const DOCS_ONLY: Record<string, PlaygroundOperation["docsOnlyReason"]> = {
  "ipfs.pin": "multipart_upload",
  "liq.trustline.submit": "needs_built_xdr",
  "metadata.options": "preflight",
}

export function playgroundOperations(ops: readonly ApiOperation[] = API_OPERATIONS): PlaygroundOperation[] {
  return ops.map((op) => {
    const reason = DOCS_ONLY[op.id]
    return reason ? { ...op, mode: "docs_only", docsOnlyReason: reason } : { ...op, mode: "callable" }
  })
}

/** Fields the console fills in at send time from the connected wallet's signature. */
export const WALLET_FILLED_FIELDS: Record<string, readonly string[]> = {
  "signals.create": ["wallet", "timestamp", "signature"],
}

/** Starter body so the editor never opens empty. Values are placeholders, never real data. */
export function exampleBody(op: ApiOperation): string {
  if (!op.body) return ""
  if (op.body.kind === "json-rpc") {
    return JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }, null, 2)
  }
  const filled = new Set(WALLET_FILLED_FIELDS[op.id] ?? [])
  return JSON.stringify(
    Object.fromEntries(op.body.fields.filter((f) => !filled.has(f)).map((f) => [f, ""])),
    null,
    2,
  )
}

export type PlaygroundInput = {
  pathParams: Record<string, string>
  query: Record<string, string>
  body: string
}

export type BuiltRequest =
  | { ok: true; url: string; init: { method: string; headers: Record<string, string>; body?: string } }
  | { ok: false; error: "missing_path_param" | "invalid_json" | "body_not_object" | "unknown_field" | "invalid_jsonrpc"; detail?: string }

/**
 * Same-origin, relative URL only: the console can never be pointed at another
 * host, so it cannot be turned into a proxy for arbitrary requests.
 */
export function buildPlaygroundRequest(
  op: ApiOperation,
  input: PlaygroundInput,
  opts: { correlationId: string; apiVersion?: string },
): BuiltRequest {
  let path = op.path
  for (const name of op.pathParams ?? []) {
    const value = input.pathParams[name]?.trim()
    if (!value) return { ok: false, error: "missing_path_param", detail: name }
    path = path.replace(`{${name}}`, encodeURIComponent(value))
  }

  const qs = new URLSearchParams()
  for (const name of op.query ?? []) {
    const value = input.query[name]?.trim()
    if (value) qs.set(name, value)
  }
  const search = qs.toString()
  const url = search ? `${path}?${search}` : path

  const headers: Record<string, string> = { "x-correlation-id": opts.correlationId }
  if (opts.apiVersion) headers["X-API-Version"] = opts.apiVersion

  if (!op.body || op.method === "GET") {
    return { ok: true, url, init: { method: op.method, headers } }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(input.body || "{}")
  } catch (e) {
    return { ok: false, error: "invalid_json", detail: e instanceof Error ? e.message : undefined }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, error: "body_not_object" }

  const allowed = new Set(op.body.fields)
  const unknown = Object.keys(parsed).find((k) => !allowed.has(k))
  if (unknown) return { ok: false, error: "unknown_field", detail: unknown }

  if (op.body.kind === "json-rpc") {
    const rpc = parsed as { jsonrpc?: unknown; method?: unknown }
    if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string" || !rpc.method) {
      return { ok: false, error: "invalid_jsonrpc" }
    }
  }

  headers["Content-Type"] = "application/json"
  return { ok: true, url, init: { method: op.method, headers, body: JSON.stringify(parsed) } }
}

export type FenceInput = {
  /** Passphrase the app is built for (lib/phase-protocol NETWORK_PASSPHRASE). */
  appPassphrase: string
  walletAddress: string | null
  /** Passphrase the connected wallet reports, if it reports one. */
  walletPassphrase: string | null
}

export type FenceResult =
  | { allowed: true }
  | { allowed: false; reason: "docs_only" | "network_not_testnet" | "wallet_required" | "wallet_network_mismatch" }

export function fencePlaygroundCall(op: PlaygroundOperation, env: FenceInput): FenceResult {
  if (op.mode === "docs_only") return { allowed: false, reason: "docs_only" }
  if (op.stateChanging && env.appPassphrase !== TESTNET_PASSPHRASE) {
    return { allowed: false, reason: "network_not_testnet" }
  }
  if (op.signing === "wallet" && !env.walletAddress) return { allowed: false, reason: "wallet_required" }
  if ((op.stateChanging || op.signing === "wallet") && env.walletAddress && env.walletPassphrase) {
    if (env.walletPassphrase !== TESTNET_PASSPHRASE) return { allowed: false, reason: "wallet_network_mismatch" }
  }
  return { allowed: true }
}

export type ResponseKind =
  | "ok"
  | "jsonrpc_error"
  | "x402_shim_disabled"
  | "rate_limited"
  | "unavailable"
  | "version_rejected"
  | "http_error"

export type InterpretedResponse = {
  kind: ResponseKind
  status: number
  correlationId: string | null
  apiVersion: string | null
  retryAfterSec: number | null
  /** Pretty, secret-redacted body for the viewer. */
  bodyText: string
  rpcError: { code: number | null; message: string } | null
  /** Normalized domain message (gate #13 and other PhaseError codes), when one applies. */
  domainMessage: string | null
}

type HeaderReader = { get(name: string): string | null }

/** Retry-After is either delta-seconds or an HTTP-date (RFC 9110 §10.2.3). */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const at = Date.parse(trimmed)
  if (Number.isNaN(at)) return null
  return Math.max(0, Math.ceil((at - now) / 1000))
}

export function normalizeDomainError(
  text: string,
  copy: { lines: readonly string[]; unknownTpl: string },
): string | null {
  const code = parsePhaseContractErrorCode(text)
  if (code === 13) return GATE_CLOSED_MESSAGE
  return humanizePhaseHostErrorMessage(text, copy.lines, copy.unknownTpl)
}

export function interpretPlaygroundResponse(
  res: { status: number; headers: HeaderReader; bodyText: string },
  copy: { lines: readonly string[]; unknownTpl: string },
  now = Date.now(),
): InterpretedResponse {
  const redacted = redactHostErrorMessage(res.bodyText)
  let json: unknown = null
  try {
    json = JSON.parse(redacted)
  } catch {
    json = null
  }
  const obj = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : null
  const bodyText = json === null ? redacted : JSON.stringify(json, null, 2)

  const base = {
    status: res.status,
    correlationId: res.headers.get("x-correlation-id") ?? res.headers.get("x-request-id"),
    apiVersion: res.headers.get("x-api-version"),
    retryAfterSec: parseRetryAfter(res.headers.get("retry-after"), now),
    bodyText,
    rpcError: null as InterpretedResponse["rpcError"],
    domainMessage: normalizeDomainError(redacted, copy),
  }

  // JSON-RPC reports failures inside a 200; the proxy also uses a 200 envelope for its own outages.
  if (res.status === 200 && obj && obj.jsonrpc === "2.0" && obj.error && typeof obj.error === "object") {
    const err = obj.error as { code?: unknown; message?: unknown }
    return {
      ...base,
      kind: "jsonrpc_error",
      rpcError: {
        code: typeof err.code === "number" ? err.code : null,
        message: typeof err.message === "string" ? err.message : "JSON-RPC error",
      },
    }
  }
  if (res.status >= 200 && res.status < 300) return { ...base, kind: "ok" }
  if (res.status === 429) return { ...base, kind: "rate_limited" }
  if (res.status === 406 || res.status === 410) return { ...base, kind: "version_rejected" }
  if (res.status === 503 && obj?.error === "x402 local shim disabled") return { ...base, kind: "x402_shim_disabled" }
  if (res.status === 503) return { ...base, kind: "unavailable" }
  return { ...base, kind: "http_error" }
}
