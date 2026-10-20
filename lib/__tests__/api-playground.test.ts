import { describe, expect, it } from "vitest"
import { API_OPERATIONS } from "@/lib/api-contract"
import {
  buildPlaygroundRequest,
  exampleBody,
  fencePlaygroundCall,
  GATE_CLOSED_MESSAGE,
  interpretPlaygroundResponse,
  parseRetryAfter,
  playgroundOperations,
  TESTNET_PASSPHRASE,
  type PlaygroundOperation,
} from "@/lib/api-playground"
import { phaseCopy, pickCopy } from "@/lib/phase-copy"
import { pickProjectDocs } from "@/lib/project-docs-content"

const ops = playgroundOperations()
const op = (id: string) => ops.find((o) => o.id === id) as PlaygroundOperation
const copy = { lines: pickCopy("en").chamber.phaseHostContractErrors, unknownTpl: pickCopy("en").chamber.phaseHostContractUnknown }
const headers = (h: Record<string, string> = {}) => new Headers(h)
const MAINNET = "Public Global Stellar Network ; September 2015"
const ADDR = "GABC"

describe("phase-docs-playground request builder", () => {
  it("covers every contract operation and marks the unsendable ones docs-only", () => {
    expect(ops).toHaveLength(API_OPERATIONS.length)
    expect(op("ipfs.pin").mode).toBe("docs_only")
    expect(op("liq.trustline.submit").docsOnlyReason).toBe("needs_built_xdr")
    expect(op("market.list").mode).toBe("callable")
  })

  it("builds a relative URL with encoded path params, query and the correlation header", () => {
    const r = buildPlaygroundRequest(op("metadata.get"), { pathParams: { id: "1/../x" }, query: { c: "C1", m: "" }, body: "" }, {
      correlationId: "cid-1",
      apiVersion: "2026-10-17",
    })
    expect(r).toEqual({
      ok: true,
      url: "/api/metadata/1%2F..%2Fx?c=C1",
      init: { method: "GET", headers: { "x-correlation-id": "cid-1", "X-API-Version": "2026-10-17" } },
    })
  })

  it("rejects missing path params, bad JSON, unknown fields and malformed JSON-RPC", () => {
    const opts = { correlationId: "c" }
    expect(buildPlaygroundRequest(op("metadata.get"), { pathParams: {}, query: {}, body: "" }, opts)).toMatchObject({
      ok: false,
      error: "missing_path_param",
      detail: "id",
    })
    const faucet = op("faucet.claim")
    expect(buildPlaygroundRequest(faucet, { pathParams: {}, query: {}, body: "{" }, opts)).toMatchObject({ error: "invalid_json" })
    expect(buildPlaygroundRequest(faucet, { pathParams: {}, query: {}, body: "[]" }, opts)).toMatchObject({ error: "body_not_object" })
    expect(buildPlaygroundRequest(faucet, { pathParams: {}, query: {}, body: '{"secret":"x"}' }, opts)).toMatchObject({
      error: "unknown_field",
      detail: "secret",
    })
    expect(buildPlaygroundRequest(op("rpc.call"), { pathParams: {}, query: {}, body: '{"method":"getHealth"}' }, opts)).toMatchObject({
      error: "invalid_jsonrpc",
    })
  })

  it("starter bodies parse, and wallet-filled fields are left to the signer", () => {
    for (const o of ops) {
      if (o.body && o.body.kind !== "multipart") expect(() => JSON.parse(exampleBody(o))).not.toThrow()
    }
    const signal = JSON.parse(exampleBody(op("signals.create")))
    expect(signal).not.toHaveProperty("signature")
    expect(signal).not.toHaveProperty("wallet")
    expect(signal).toHaveProperty("title")
  })
})

describe("phase-docs-playground testnet fence", () => {
  const env = { appPassphrase: TESTNET_PASSPHRASE, walletAddress: null, walletPassphrase: null }

  it("reads are always allowed, writes only on a testnet build", () => {
    expect(fencePlaygroundCall(op("market.list"), { ...env, appPassphrase: MAINNET })).toEqual({ allowed: true })
    expect(fencePlaygroundCall(op("faucet.claim"), env)).toEqual({ allowed: true })
    expect(fencePlaygroundCall(op("faucet.claim"), { ...env, appPassphrase: MAINNET })).toEqual({
      allowed: false,
      reason: "network_not_testnet",
    })
  })

  it("signed calls need a wallet, and that wallet must be on testnet", () => {
    expect(fencePlaygroundCall(op("signals.create"), env)).toEqual({ allowed: false, reason: "wallet_required" })
    expect(fencePlaygroundCall(op("signals.create"), { ...env, walletAddress: ADDR, walletPassphrase: MAINNET })).toEqual({
      allowed: false,
      reason: "wallet_network_mismatch",
    })
    expect(
      fencePlaygroundCall(op("signals.create"), { ...env, walletAddress: ADDR, walletPassphrase: TESTNET_PASSPHRASE }),
    ).toEqual({ allowed: true })
  })

  it("docs-only operations never send", () => {
    expect(fencePlaygroundCall(op("ipfs.pin"), env)).toEqual({ allowed: false, reason: "docs_only" })
  })
})

describe("phase-docs-playground response viewer", () => {
  it("treats a JSON-RPC error inside HTTP 200 as an error", () => {
    const r = interpretPlaygroundResponse(
      {
        status: 200,
        headers: headers({ "x-correlation-id": "abc" }),
        bodyText: JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "method not found" } }),
      },
      copy,
    )
    expect(r.kind).toBe("jsonrpc_error")
    expect(r.rpcError).toEqual({ code: -32601, message: "method not found" })
    expect(r.correlationId).toBe("abc")
  })

  it("recognises the x402 shim's conditional 503 apart from a real outage", () => {
    const shim = interpretPlaygroundResponse(
      { status: 503, headers: headers(), bodyText: JSON.stringify({ error: "x402 local shim disabled" }) },
      copy,
    )
    expect(shim.kind).toBe("x402_shim_disabled")
    const outage = interpretPlaygroundResponse({ status: 503, headers: headers(), bodyText: "{}" }, copy)
    expect(outage.kind).toBe("unavailable")
  })

  it("reads Retry-After as seconds or an HTTP date", () => {
    const r = interpretPlaygroundResponse({ status: 429, headers: headers({ "Retry-After": "2" }), bodyText: "{}" }, copy)
    expect(r.kind).toBe("rate_limited")
    expect(r.retryAfterSec).toBe(2)
    const now = Date.parse("2026-10-17T00:00:00Z")
    expect(parseRetryAfter("Sat, 17 Oct 2026 00:00:10 GMT", now)).toBe(10)
    expect(parseRetryAfter("garbage", now)).toBeNull()
  })

  it("maps gate #13 to the gate-closed message and other codes to the PhaseError copy", () => {
    const gate = interpretPlaygroundResponse(
      { status: 400, headers: headers(), bodyText: JSON.stringify({ error: "HostError: Error(Contract, #13)" }) },
      copy,
    )
    expect(gate.domainMessage).toBe(GATE_CLOSED_MESSAGE)
    const other = interpretPlaygroundResponse(
      { status: 400, headers: headers(), bodyText: JSON.stringify({ error: "Error(Contract, #1)" }) },
      copy,
    )
    expect(other.domainMessage).toBe(copy.lines[1])
  })

  it("redacts secret keys before they reach the viewer", () => {
    const secret = `S${"A".repeat(55)}`
    const r = interpretPlaygroundResponse({ status: 500, headers: headers(), bodyText: JSON.stringify({ error: secret }) }, copy)
    expect(r.bodyText).not.toContain(secret)
    expect(r.bodyText).toContain("[REDACTED_SECRET_KEY]")
  })

  it("echoes the negotiated API version header", () => {
    const r = interpretPlaygroundResponse({ status: 200, headers: headers({ "X-API-Version": "2026-10-17" }), bodyText: "{}" }, copy)
    expect(r.apiVersion).toBe("2026-10-17")
  })
})

describe("phase-docs-playground docs wiring", () => {
  it("has EN and ES copy with the same keys", () => {
    const keys = (o: object): string[] =>
      Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v).map((c) => `${k}.${c}`) : [k]))
    expect(keys(phaseCopy.es.playground).sort()).toEqual(keys(phaseCopy.en.playground).sort())
  })

  it("adds the playground section only when asked", () => {
    expect(pickProjectDocs("en").sections.some((s) => s.id === "playground")).toBe(false)
    const withIt = pickProjectDocs("es", { playground: true })
    const section = withIt.sections.find((s) => s.id === "playground")
    expect(section?.title).toBe(phaseCopy.es.playground.sectionTitle)
  })
})
