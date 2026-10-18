# Spike 662 — Interactive Docs Playground / Try-It-Live API Console Findings (Issue #525)

## What the issue claimed

`/docs` only shows static link cards. Routes have inconsistent, undocumented contracts (such as JSON-RPC errors wrapped in HTTP 200) and there's no central route manifest. Wallet-gated routes need signatures the page can't produce. The goal: an executable try-it-live console with a params editor, a response inspector, and wallet-gated signing through the wallet kit without exposing keys. It should show per-call correlation IDs, run on testnet only, and sit behind a default-off flag.

## What the code actually did at spike time

- `app/docs/page.tsx` rendered `lib/project-docs-content.ts` blocks. Nothing was interactive.
- `/api/soroban-rpc` returns upstream JSON-RPC errors as HTTP 200 and uses a 200 JSON-RPC envelope (`-32603`) for its own failover outage, so the Stellar SDK reads the body.
- `/api/x402` returns `503 {"error":"x402 local shim disabled"}` unless `X402_LOCAL_SHIM_ENABLED=true`. That's configuration, not an outage.
- `/api/soroban-rpc` answers `429` + `Retry-After: 2` when more than 12 calls are in flight, and `503` + `Retry-After: 10` while its circuit is open. Its per-IP limiter, `checkProxyRateLimit`, is defined but never called.
- Only `POST /api/signals` verifies a wallet signature (SEP-53). `POST /api/classic-liq/trustline` takes a client-signed XDR. `market` and `nft-listings` writes check no signature.
- None of the listed routes echo a correlation ID; only routes using `createApiRequestContext` do.

## Delivered in this PR (phase-162)

1. **Route manifest and typed request builder**: the console reads the same contract as spike 663 (`lib/api-contract.ts`), and `lib/api-playground.ts:buildPlaygroundRequest` builds from it. Path params are required and encoded, query params are limited to the declared ones, bodies must be JSON objects with only declared fields, and JSON-RPC needs `jsonrpc: "2.0"` plus a method. URLs are relative and same-origin only.
2. **Response inspector** (`interpretPlaygroundResponse`): status plus a classified kind (`ok`, `jsonrpc_error`, `x402_shim_disabled`, `rate_limited`, `unavailable`, `version_rejected`, `http_error`), the JSON-RPC code and message from inside a 200, `Retry-After` as seconds or HTTP-date, the version echo, and secret redaction before display.
3. **Correlation IDs**: a fresh `x-correlation-id` per call, shown next to whatever the server echoed (`—` when the route doesn't echo it).
4. **Wallet-gated client signing**: for `signals.create` the console fills `wallet`, `timestamp` and `signature` at send time with `signSignalPayload` in the browser. The server only ever sees the signature.
5. **Testnet fence** (`fencePlaygroundCall`): state-changing calls only run on a testnet build. Signed calls need a connected wallet, which must be on testnet if it reports a network. Multipart upload, the trustline XDR submit and the CORS preflight are docs-only.
6. **Input is never lost**: one input record per operation that no response, error, 429 or failed signature clears. A 429 disables Send with a countdown.
7. **Errors and i18n**: contract `#13` renders as `[ ERROR: BIOMETRIC_TRUST_GATE_CLOSED ]`, and other PhaseError codes use the existing humanizer. Every console string is in `lib/phase-copy.ts` (`playground`, EN and ES).

## Spike questions (from the issue)

1. **Minimal testnet loop, and which listed files can break it?** From the console: faucet claim (`POST /api/faucet`), then a JSON-RPC read of the balance (`POST /api/soroban-rpc`), a signed signal (`POST /api/signals`), and a read-back (`GET /api/signals`, `GET /api/wallet/phase-nfts`). Files that can break it on their own: `lib/api-contract.ts` (a wrong field list makes the builder reject a valid body), `lib/stellar-wallet-kit.ts` (signing and network detection), `lib/viewer-signature.ts` (the signed payload has to match server verification byte for byte), and each route handler. On `main`, `lib/stellar-wallet-kit.ts` crashed every page on hydration (`node:crypto` in the client); that's fixed on `chore/fix-main-baseline`, which this branch includes.
2. **Replay and idempotency per write.** The console adds no write path of its own; every call goes to the existing handler. Signal signatures bind `title`, `body` and a fresh `timestamp`, and the server rejects a stale timestamp. Faucet double submits are handled by `faucetPending` as before. A retry after a timeout sends a **new** correlation ID and a new timestamp, so it's a new request, not a replay.
3. **Contract-ID drift, issuer rotation, gateway failover.** The fence compares the build's network passphrase and the wallet's against testnet. It doesn't verify contract IDs (the handlers do). Gateway and RPC failover stay in `/api/soroban-rpc`; the console shows the resulting envelope, including the `-32603` outage case.
4. **409/429/412 taxonomy and recovery without losing input.** 429 → `rate_limited`, with the `Retry-After` countdown and input kept. 503 → `unavailable`, or `x402_shim_disabled` for the shim. 406/410 → `version_rejected`. Any other 4xx/5xx, including 409 and 412 → `http_error`, with the body shown and input kept. `ETag`/`If-Match` routes (signal edits) aren't in this issue's route list, so the console doesn't send `If-Match` yet (follow-up).
5. **Migration and rollback.** No WASM, schema or sidecar change. Rollback: unset `NEXT_PUBLIC_FEATURE_PHASE_162`, rebuild and redeploy. The section disappears and nothing is persisted.

## Acceptance criteria status

| Criterion | Status |
|---|---|
| End-to-end testnet proof with tx hashes and contract IDs, no hardcoded IDs | Checklist below. The console and proof runner hardcode no IDs. Needs a browser run with a wallet. |
| Concurrency proof | `npm run proof:662 -- --burst 40` provokes the proxy's 429 and records `Retry-After`. Concurrent writers don't apply to the console itself. |
| Abuse proof (tampered input, replay; no PII) | Unknown fields and malformed JSON are rejected client-side. Same-origin only. Secrets are redacted before display. No wallet in logs. |
| Resilience proof | The console correctly classifies the proxy's failover envelope (`-32603` in a 200), shown in the local proof run. |
| i18n, `#13`, docs, flag row | EN/ES via `pickCopy`, `#13` → `[ ERROR: BIOMETRIC_TRUST_GATE_CLOSED ]`, docs and flag row updated. |
| No regression with flags off | tsc 0 errors, vitest green, and the section is absent with the flag off. |

## Verified in this session

- `npm run proof:662 -- --base-url http://localhost:3101 --burst 40` against `next dev` with the flag on: console section present, the proxy's JSON-RPC error inside HTTP 200 classified as an error, the x402 shim 503 recognized, a correlation ID sent (none echoed by `/api/x402/supported`), and 28 of 40 concurrent calls got 429 with `Retry-After: 2`. The container can't reach Soroban testnet, so the JSON-RPC error was the proxy's own `-32603` envelope, not an upstream "method not found".
- Headless Chromium: picked an operation, sent it, saw status, version echo and correlation ID; sent invalid JSON and saw the error while the textarea kept `{ broken`.

## Lab results (production build, cloud container)

`next build` with `NEXT_PUBLIC_FEATURE_PHASE_162=1`, `next start` with `FEATURE_PHASE_163=1`, run on 2026-10-18. `npm run proof:662 -- --burst 40` passed 5/5:

- the console section is rendered on `/docs`;
- the proxy's JSON-RPC error inside HTTP 200 is classified as `jsonrpc_error` (this container can't reach Soroban testnet, so it was the proxy's own `-32603` failover envelope);
- the x402 shim's 503 is recognized as `x402_shim_disabled`, not an outage;
- a correlation ID was sent, and `/api/x402/supported` doesn't echo one (recorded as a follow-up);
- 28 of 40 concurrent calls got `429` with `Retry-After: 2`.

Signing and faucet steps need testnet and a wallet; see the checklist.

## Live proof checklist (run by the maintainer)

1. Deploy this branch with `NEXT_PUBLIC_FEATURE_PHASE_162=1` (build-time) and `FEATURE_PHASE_163=1`, pointed at testnet.
2. `npm run proof:662 -- --base-url https://<preview-host> --burst 40` and confirm every line says PASS.
3. In a browser with Freighter on **testnet**:
   - pick `faucet.claim`, send with your wallet address, and note the result;
   - pick `rpc.call`, send `{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}`, then a made-up method, and confirm it shows "JSON-RPC error inside an HTTP 200 response";
   - pick `signals.create`, fill `title`, `body`, `channel`, click **Sign with wallet and send**, and approve in Freighter;
   - switch Freighter to mainnet and retry `signals.create`: it should be blocked with the wallet-network message and send nothing.
4. Fill in:

| Item | Value |
|---|---|
| Preview URL | No preview deploy. Local run of this branch on `http://localhost:3000` (2026-10-18) |
| Faucet claim tx hash | Pending: the local run had no `.env.local`, so the faucet and PHASELQ issuer were not configured |
| PHASELQ token contract ID in use (from env, not code) | Pending, same reason (not set locally) |
| Signal id returned by `signals.create` | `78dtefUb2J`, `X_QqiTXggA` (two signed testnet sends, both 201; the mainnet attempt in between created none) |
| `signature_verified` on that signal (`GET /api/signals`) | `true` on both signals (Freighter on testnet, local run of this branch, 2026-10-18; `signals.create` returned 201) |
| Retry-After seen in the burst | `2` (28 of 40 concurrent calls got 429, prod build) |
| `rpc.call` `getLatestLedger` (testnet, via /api/soroban-rpc) | 200, `sequence` 5255947, `protocolVersion` 29 (2026-10-18) |
| `rpc.call` unknown method (`fooBar`) | "200 · JSON-RPC error inside an HTTP 200 response" (2026-10-18) |
| Mainnet wallet fence message (screenshot) | "Blocked: your wallet is not on testnet. Switch it to Test SDF Network." (Freighter on Mainnet, 2026-10-18). Screenshot `<<ATTACH>>` |
| Proof file | `.data/proofs/662-2026-10-18T06-15-36-736Z.json` (local run, 5/5 PASS, 28/40 got 429 with `Retry-After: 2`) |

The first Freighter-signed attempt was rejected with `Invalid signature: payload not signed by this wallet`. That exposed a SEP-53 bug on main: the server verified the raw message bytes instead of `SHA-256("Stellar Signed Message:\n" + message)`. The fix is on `chore/fix-main-baseline` (see `docs/investigations/main-baseline-2026-10-17.md`) and is checked against the official SEP-53 test vectors. After it, the same flow returned 201 with `signature_verified: true`.

## Follow-up / out of scope for this PR

- `If-Match` / version-CAS support for edit routes (`PUT`/`PATCH /api/signals/[id]`), which aren't in this issue's list.
- Building and signing a `changeTrust` XDR in the console (`liq.trustline.submit` is docs-only for now).
- File upload for `ipfs.pin`.
- Localized operation summaries. The console shows `METHOD path · id` only, because the contract summaries are English.
- Wiring `checkProxyRateLimit` (the per-IP limiter in `/api/soroban-rpc`), which is defined but never called.
- Correlation-ID echo on the listed routes (they don't use `createApiRequestContext`).
