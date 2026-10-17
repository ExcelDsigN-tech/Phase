# Spike 662 — Interactive Docs Playground / Try-It-Live API Console Findings (Issue #525)

## What the issue claimed

`/docs` is static. Integrators can't try a route without writing code, there is no typed request builder or response viewer, correlation IDs are invisible, and a naive console would mishandle the API's awkward cases: JSON-RPC errors wrapped in HTTP 200, the x402 shim's conditional 503, and 429 with Retry-After. It would also have to keep signing on the client and stop state-changing calls from leaving testnet.

## What the code actually did at spike time

- `app/docs/page.tsx` rendered `lib/project-docs-content.ts` blocks. There was no interactive element.
- `/api/soroban-rpc` returns upstream JSON-RPC errors with HTTP 200, and uses a 200 JSON-RPC envelope for its own circuit-open case so the Stellar SDK reads the body.
- `/api/x402` (GET and POST) returns `503 {"error":"x402 local shim disabled"}` unless `X402_LOCAL_SHIM_ENABLED=true`. That's a configuration state, not an outage.
- `/api/soroban-rpc` and `/api/faucet` send `Retry-After` with 429/503.
- `lib/viewer-signature.ts:signSignalPayload` already signs SEP-53 signal proofs client-side through the Wallets Kit.
- Of the listed routes, only `POST /api/signals` verifies a wallet signature. `POST /api/classic-liq/trustline` takes a client-signed XDR. `market` and `nft-listings` writes check no signature.

## Delivered (phase-162)

1. **Typed request builder** (`lib/api-playground.ts:buildPlaygroundRequest`): driven by the same contract as spike 663 (`lib/api-contract.ts`). Path params are required and URL-encoded. Query params are limited to the declared ones. Bodies must be JSON objects with only declared fields, and JSON-RPC bodies need `jsonrpc: "2.0"` plus a method. URLs are always relative and same-origin, so the console can't be pointed at another host. An optional `X-API-Version` is sent through to the phase-163 negotiation.
2. **Response viewer** (`interpretPlaygroundResponse`): status plus a classified kind (`ok`, `jsonrpc_error`, `x402_shim_disabled`, `rate_limited`, `unavailable`, `version_rejected`, `http_error`), the JSON-RPC error code and message from inside a 200, Retry-After as seconds or HTTP-date, the negotiated version echo, and secret redaction (`redactHostErrorMessage`) before anything is shown.
3. **Correlation IDs**: the console sends a fresh `x-correlation-id` per request and shows both the sent value and whatever the server echoed (`x-correlation-id` / `x-request-id`), so you can tell when a route doesn't echo it.
4. **Error normalization**: contract `#13` renders as `[ ERROR: BIOMETRIC_TRUST_GATE_CLOSED ]`, and other `Error(Contract, #N)` codes go through the existing `humanizePhaseHostErrorMessage` with the localized PhaseError lines.
5. **Wallet-gated client signing** (`components/docs-api-playground.tsx`): for `signals.create` the console fills `wallet`, `timestamp` and `signature` at send time with `signSignalPayload`, in the browser. The editor text is never rewritten. The server only ever sees the signature.
6. **Testnet fence** (`fencePlaygroundCall`): state-changing operations only run when the build's passphrase is testnet. Signed operations need a connected wallet, and if the wallet reports a network it must be testnet. Multipart upload, the trustline XDR submit and the CORS preflight are docs-only.
7. **Input is never lost**: one input record per operation lives in component state and no response, error, rate limit or failed signature clears it. A 429 disables Send with a countdown and says the input is kept.
8. **Copy**: every string is in `lib/phase-copy.ts` (`playground`, EN and ES). The docs page reads `NEXT_PUBLIC_FEATURE_PHASE_162` literally, as it already does for phase-668, because a dynamic `isFeatureEnabled` lookup is never inlined into client bundles.

## Files ruled out

| File | Why it is not changed |
|------|-----------------------|
| `app/docs/layout.tsx` | Metadata only. The playground is a section of the page, not a new route. |
| `app/api/faucet`, `soroban-rpc`, `x402`, `x402/verify`, `x402/supported`, `classic-liq`, `wallet/phase-nfts`, `signals`, `metadata/[id]` route files | The console consumes them exactly as they behave. The awkward cases (200-wrapped JSON-RPC, the conditional 503, Retry-After) are handled on the client by design, because changing them would break the SDK and wallet flows that depend on them. Each one is described in `lib/api-contract.ts`. |
| `lib/api-observability.ts` | Changed in spike 663 (version echo). Its correlation-ID echo already exists, and the console just displays it. |
| `lib/stellar-wallet-kit.ts`, `lib/viewer-signature.ts` | Used as-is: `kit.getNetwork()` for the wallet's network and `signSignalPayload` for SEP-53. No new signing code was needed. |

## Spike questions

The upstream issue text was not reachable from the session that built this, so these follow the summary it was given.

1. **Rollback?** Unset `NEXT_PUBLIC_FEATURE_PHASE_162`, rebuild and restart. The section disappears from `/docs`. Nothing is persisted.
2. **WASM or contract migration?** Does not apply.
3. **Metrics?** None added. The console reuses the existing correlation-ID logs, so a playground request shows up in server logs under the ID the console displays. No wallet address is logged by the console.
4. **Tests?** `lib/__tests__/api-playground.test.ts` (15 cases): builder validation and encoding, docs-only marking, starter bodies, the fence (testnet build, wallet required, wallet network mismatch), JSON-RPC-in-200, shim 503 vs outage, Retry-After forms, gate #13 normalization, secret redaction, version echo, EN/ES key parity and section wiring.
5. **Security?** Relative URLs only, declared fields only, signing in the wallet extension, redaction before display, and state-changing calls fenced to testnet.

## Still needs manual verification

- A browser run against a testnet deployment with Freighter: sign and send a signal, check the 429 countdown against `/api/soroban-rpc`, and switch the wallet to mainnet to see the fence trip. No tx hashes or screenshots are claimed here.
- `kit.getNetwork()` support varies by wallet module. When a module doesn't report a network, the fence relies on the build passphrase alone.
