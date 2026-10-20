/**
 * Spike 663 (phase-api-versioning): source of truth for the public API contract.
 *
 * Status codes and fields were read off each route handler at spike time; they
 * describe what the code returns, not an aspiration. `scripts/api-contract.cts`
 * renders this into `docs/api/openapi.json` and fails CI when a change would
 * break an existing client without a version bump (see `lib/api-versioning.ts`).
 *
 * Spike 662 (phase-docs-playground) reuses the same list to drive the docs playground, so
 * `stateChanging` and `signing` are also the playground's safety fences.
 */

export type HttpMethod = "GET" | "POST" | "OPTIONS"

export type BodyKind = "json" | "json-rpc" | "multipart"

export type ApiOperation = {
  id: string
  method: HttpMethod
  path: string
  summary: string
  tag: "faucet" | "rpc" | "settlement" | "market" | "signals" | "ipfs" | "metadata" | "wallet" | "meta"
  query?: readonly string[]
  pathParams?: readonly string[]
  headers?: readonly string[]
  body?: { kind: BodyKind; fields: readonly string[] }
  statuses: readonly number[]
  /** Writes server state or submits to the ledger. The playground fences these to testnet. */
  stateChanging: boolean
  /** "wallet" means the caller must sign client-side (Freighter); the server never signs for users. */
  signing: "none" | "wallet"
  /** Response headers a client may rely on. */
  responseHeaders?: readonly string[]
}

export const API_OPERATIONS: readonly ApiOperation[] = [
  {
    id: "faucet.status",
    method: "GET",
    path: "/api/faucet",
    summary: "Faucet eligibility and last claim for a wallet",
    tag: "faucet",
    query: ["walletAddress"],
    statuses: [200, 400, 412, 502],
    stateChanging: false,
    signing: "none",
  },
  {
    id: "faucet.claim",
    method: "POST",
    path: "/api/faucet",
    summary: "Claim the testnet PHASELQ faucet reward",
    tag: "faucet",
    body: { kind: "json", fields: ["walletAddress", "userAddress", "reward", "referralCode", "turnstileToken", "hashcashProof"] },
    statuses: [200, 202, 400, 403, 404, 409, 412, 429, 500, 502, 503],
    stateChanging: true,
    signing: "none",
    responseHeaders: ["Retry-After"],
  },
  {
    id: "bounty.claim",
    method: "POST",
    path: "/api/claim-bounty",
    summary: "Bounty claim; proxies the faucet claim and mirrors its status",
    tag: "faucet",
    body: { kind: "json", fields: ["walletAddress", "userAddress", "reward"] },
    statuses: [200, 202, 400, 403, 404, 409, 412, 429, 500, 502, 503],
    stateChanging: true,
    signing: "none",
  },
  {
    id: "rpc.health",
    method: "GET",
    path: "/api/soroban-rpc",
    summary: "Method guard; GET is not supported",
    tag: "rpc",
    statuses: [405],
    stateChanging: false,
    signing: "none",
  },
  {
    id: "rpc.call",
    method: "POST",
    path: "/api/soroban-rpc",
    summary: "Soroban JSON-RPC proxy with failover. JSON-RPC errors arrive as HTTP 200 with an `error` member",
    tag: "rpc",
    body: { kind: "json-rpc", fields: ["jsonrpc", "id", "method", "params"] },
    statuses: [200, 400, 413, 429, 503],
    stateChanging: false,
    signing: "none",
    responseHeaders: ["Retry-After"],
  },
  {
    id: "liq.status",
    method: "GET",
    path: "/api/classic-liq",
    summary: "Classic LIQ claim status for a wallet",
    tag: "settlement",
    query: ["walletAddress"],
    statuses: [200, 400, 502, 503],
    stateChanging: false,
    signing: "none",
  },
  {
    id: "liq.claim",
    method: "POST",
    path: "/api/classic-liq",
    summary: "Send the classic LIQ reward to a wallet with an existing trustline",
    tag: "settlement",
    body: { kind: "json", fields: ["walletAddress", "userAddress"] },
    statuses: [200, 400, 409, 412, 502, 503],
    stateChanging: true,
    signing: "none",
  },
  {
    id: "liq.trustline.status",
    method: "GET",
    path: "/api/classic-liq/trustline",
    summary: "Trustline submission status",
    tag: "settlement",
    query: ["status", "view"],
    statuses: [200, 404, 500],
    stateChanging: false,
    signing: "none",
  },
  {
    id: "liq.trustline.submit",
    method: "POST",
    path: "/api/classic-liq/trustline",
    summary: "Submit a client-signed changeTrust XDR (single or batch)",
    tag: "settlement",
    body: { kind: "json", fields: ["signedXdr", "signedXdrs"] },
    statuses: [200, 400, 409, 422, 502],
    stateChanging: true,
    signing: "wallet",
  },
  {
    id: "listings.list",
    method: "GET",
    path: "/api/nft-listings",
    summary: "Paginated NFT listings",
    tag: "market",
    query: ["cursor", "limit"],
    statuses: [200],
    stateChanging: false,
    signing: "none",
  },
  {
    id: "listings.write",
    method: "POST",
    path: "/api/nft-listings",
    summary: "Create or cancel a listing",
    tag: "market",
    body: { kind: "json", fields: ["tokenId", "collectionId", "priceStroops", "seller", "cancelId"] },
    statuses: [200, 202, 400, 413],
    stateChanging: true,
    signing: "wallet",
  },
  {
    id: "market.list",
    method: "GET",
    path: "/api/market",
    summary: "Market listings with filters",
    tag: "market",
    query: ["collection", "drop", "exclude_ap", "seller", "sort"],
    statuses: [200],
    stateChanging: false,
    signing: "none",
  },
  {
    id: "market.create",
    method: "POST",
    path: "/api/market",
    summary: "Create a market listing",
    tag: "market",
    body: {
      kind: "json",
      fields: [
        "token_id",
        "collection_id",
        "seller_wallet",
        "name",
        "image",
        "price_phaselq",
        "accepts_offers",
        "min_offer",
        "creator_wallet",
        "royalty_bps",
        "suggestion_id",
        "lang",
      ],
    },
    statuses: [201, 400],
    stateChanging: true,
    signing: "wallet",
  },
  {
    id: "signals.list",
    method: "GET",
    path: "/api/signals",
    summary: "Signal feed",
    tag: "signals",
    statuses: [200],
    stateChanging: false,
    signing: "none",
  },
  {
    id: "signals.create",
    method: "POST",
    path: "/api/signals",
    summary: "Publish a SEP-53 signed signal",
    tag: "signals",
    body: {
      kind: "json",
      fields: [
        "wallet",
        "title",
        "body",
        "type",
        "channel",
        "signature",
        "timestamp",
        "nft_token_id",
        "nft_collection_id",
        "nft_name",
        "nft_image",
        "poll_options",
        "poll_closes_at",
        "scheduled_for",
      ],
    },
    statuses: [200, 400, 404],
    stateChanging: true,
    signing: "wallet",
  },
  {
    id: "x402.resource",
    method: "GET",
    path: "/api/x402",
    summary: "x402 local shim resource. 503 unless X402_LOCAL_SHIM_ENABLED=true; 402 without payment",
    tag: "settlement",
    headers: ["Authorization"],
    statuses: [200, 401, 402, 503],
    stateChanging: false,
    signing: "none",
  },
  {
    id: "x402.facilitate",
    method: "POST",
    path: "/api/x402",
    summary: "x402 local shim facilitator. 503 unless X402_LOCAL_SHIM_ENABLED=true",
    tag: "settlement",
    body: { kind: "json", fields: ["payment_token", "user_address"] },
    statuses: [200, 400, 401, 503],
    stateChanging: false,
    signing: "none",
  },
  {
    id: "x402.verify",
    method: "POST",
    path: "/api/x402/verify",
    summary: "Verify an x402 payment token",
    tag: "settlement",
    body: { kind: "json", fields: ["payment_token"] },
    statuses: [200, 400, 409, 503],
    stateChanging: false,
    signing: "none",
  },
  {
    id: "x402.supported",
    method: "GET",
    path: "/api/x402/supported",
    summary: "Supported x402 schemes and networks",
    tag: "settlement",
    statuses: [200],
    stateChanging: false,
    signing: "none",
  },
  {
    id: "ipfs.status",
    method: "GET",
    path: "/api/ipfs",
    summary: "IPFS pinning configuration status",
    tag: "ipfs",
    statuses: [200],
    stateChanging: false,
    signing: "none",
  },
  {
    id: "ipfs.pin",
    method: "POST",
    path: "/api/ipfs",
    summary: "Pin an uploaded file to IPFS",
    tag: "ipfs",
    query: ["retries", "baseDelayMs"],
    body: { kind: "multipart", fields: ["file"] },
    statuses: [200, 400, 502, 503],
    stateChanging: true,
    signing: "none",
  },
  {
    id: "metadata.get",
    method: "GET",
    path: "/api/metadata/{id}",
    summary: "SEP-50 token metadata JSON",
    tag: "metadata",
    pathParams: ["id"],
    query: ["c", "m"],
    statuses: [200, 400, 404, 502],
    stateChanging: false,
    signing: "none",
  },
  {
    id: "metadata.options",
    method: "OPTIONS",
    path: "/api/metadata/{id}",
    summary: "CORS preflight",
    tag: "metadata",
    pathParams: ["id"],
    statuses: [204],
    stateChanging: false,
    signing: "none",
  },
  {
    id: "versions.get",
    method: "GET",
    path: "/api/versions",
    summary: "Supported versions, deprecations, changelog, or the OpenAPI document (?format=openapi). 404 unless phase-api-versioning is on",
    tag: "meta",
    query: ["format"],
    statuses: [200, 400, 404],
    stateChanging: false,
    signing: "none",
  },
  {
    id: "wallet.nfts",
    method: "GET",
    path: "/api/wallet/phase-nfts",
    summary: "PHASE NFTs owned by a wallet",
    tag: "wallet",
    query: ["address"],
    statuses: [200, 400, 500],
    stateChanging: false,
    signing: "none",
  },
]

export function findOperation(method: string, path: string): ApiOperation | undefined {
  return API_OPERATIONS.find((op) => op.method === method && op.path === path)
}
