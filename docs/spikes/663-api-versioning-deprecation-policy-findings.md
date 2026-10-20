# Spike 663 — Machine-Readable API Versioning, Changelog and Deprecation Policy Findings (Issue #526)

## What the issue claimed

The public API has no version prefix, no `Accept-Version` / `X-API-Version` header and no sunset mechanism, so compatibility rests on convention. Flag-gated extensions change response shapes without negotiation, and the architecture doc requires doc updates but defines no deprecation lifecycle. The goal: version the HTTP surface with a published changelog and enforced deprecation windows. That includes a machine-readable manifest (OpenAPI generated from zod), CI checks for breaking changes, `Sunset` headers, `410 Gone` after the window, a changelog backfilled from git history, and dual-version serving during migrations.

## What the code actually did at spike time

- No route read `Accept-Version` or `X-API-Version`, and no response carried a version.
- No `Deprecation`, `Sunset` or `Link: rel="deprecation"` header existed.
- There was no OpenAPI document. Shapes lived only in the handlers, and only some routes validate with zod (`classic-liq/trustline`, `ipfs`); most parse bodies by hand.
- `lib/api-observability.ts:createApiRequestContext` existed, but no listed route used it.
- Several `/api` routes set `Vary: Authorization` (gated metadata, IPFS, OG) so shared caches can't leak gated responses.

## Delivered in this PR (phase-api-versioning)

1. **Contract source** (`lib/api-contract.ts`): one typed entry per operation (24, across 15 paths) with params, body fields, the status codes each handler returns (read per handler), `stateChanging` and `signing`.
2. **Negotiation** (`lib/api-versioning.ts`, wired in `middleware.ts` for `/api/*`, preflights excluded). `X-API-Version` pins an exact id and wins over `Accept-Version`, which takes the first supported id from a list. No header means the current version. Unknown or malformed gives `406 UNSUPPORTED_API_VERSION` with the supported list. Past its sunset gives `410 API_VERSION_SUNSET`.
3. **Headers on every listed route**: `X-API-Version` echo; `Deprecation: @<unix>` (RFC 9745), `Sunset: <HTTP-date>` (RFC 8594) and `Link` with `rel="deprecation"` / `rel="successor-version"` for deprecated versions or routes (`ROUTE_DEPRECATIONS`, path templates). `Vary` is a superset of every token an `/api` route uses (`API_VARY_TOKENS`), so the middleware can't drop a route's `Vary: Authorization`. A test scans `app/api` to keep it complete.
4. **Handler visibility**: middleware forwards the negotiated id. `createApiRequestContext` logs it as `apiVersion` (known ids only, so the label set stays closed) and echoes it.
5. **Machine-readable docs**: `docs/api/openapi.json` (OpenAPI 3.1, with `x-state-changing`, `x-signing`, `x-api-versions`) and `docs/api/changelog.json`, rendered by `npm run api:contract -- --write`. `GET /api/versions` serves them, and returns 404 when the flag is off.
6. **Breaking-change check** (`npm run api:contract`, blocking CI step): diffs the generated contract against the target branch's snapshot. It catches removed operations, params, body fields, 2xx statuses and response headers, newly required params, and versions removed before their sunset. A break passes only with a new current version plus a changelog entry flagged `breaking: true`. Exit codes: 0 ok, 1 breaking, 2 stale snapshot, 64 bad args.

## Spike questions (from the issue)

1. **Minimal testnet loop, and which listed files can break it?** Negotiation sits in front of every route in the loop (faucet, `classic-liq`/trustline, `soroban-rpc`, `x402`, `metadata/[id]`, `market`). With the flag on, `middleware.ts` and `lib/api-versioning.ts` are the single point that can break all of them at once: a bad current version or a throwing negotiation would 406 or 500 every call. That's why negotiation is pure, unit-tested and defaults to the current version when no header is sent. Route files only fail on their own as before. `npm run proof:663` exercises every listed route through the middleware.
2. **Replay and idempotency per write.** Unchanged: negotiation adds no state and doesn't touch the contract `settled` flag, `used-settlements.json`, `viewer_jti`, `faucetPending` or version CAS. A double submit after a serverless timeout reaches the handler exactly as before. A 406/410 happens before the handler, so a rejected version can never half-apply a write.
3. **Contract-ID drift, issuer rotation, gateway failover.** Not affected and not fenced by this spike; the existing checks in the handlers still apply. What versioning adds is a fence for **shape drift**: a client pinned to a version gets a 406/410 instead of silently receiving a different shape.
4. **409/429/412 taxonomy.** Untouched in the handlers. This spike adds `406 UNSUPPORTED_API_VERSION` (unknown or malformed id, with `supported`) and `410 API_VERSION_SUNSET`. Both are typed JSON and logged as `api_version_rejected` with closed fields only. `Retry-After`, `ETag`/`If-Match` and vector-clock semantics are unchanged. UI recovery isn't needed because first-party clients send no version header and always get the current one.
5. **Migration and rollback.** No WASM, schema or sidecar change. Rollback: unset the flag and restart. Negotiation stops, version headers disappear, `/api/versions` returns 404, and nothing is persisted. The CI gate only reads source files, so it stays.

## Acceptance criteria status

| Criterion | Status |
|---|---|
| End-to-end testnet proof with tx hashes and contract IDs | `npm run proof:663` proves headers and negotiation on a deployment (read-only). Tx hashes don't apply: negotiation never writes on-chain. Placeholders are below. |
| Concurrency proof | Not applicable: no new writes. |
| Abuse proof (replay, tampered input; no PII in labels) | Malformed or oversized version headers → typed 406. The requested value is never logged. The `x-phase-api-version` a client sends is overwritten by middleware and only known ids are logged. |
| Resilience proof | Not applicable to header negotiation. The handlers' failover is unchanged. |
| i18n, `#13`, docs, flag row | No new UI strings. `#13` handling is untouched. Architecture and technical docs updated with a flag row and rollback. |
| No regression with flags off | tsc 0 errors, vitest green. With the flag off, middleware returns the same response as before (tested). |

## Lab results (production build, cloud container)

`next build && next start` of `feat/docs-api-playground` (which contains this branch), run on 2026-10-18.

- **Flag on (`FEATURE_PHASE_API_VERSIONING=1`):** `npm run proof:663` passed 15/15. `/api/versions` returned 200 with current `2026-10-17`, the OpenAPI document has 15 paths, all ten listed routes echo `X-API-Version` with the full `Vary` superset, `X-API-Version` pinning and `Accept-Version` lists work, and `1999-01-01` gets a typed `406 UNSUPPORTED_API_VERSION`.
- **Gated cache key kept:** `/api/metadata/1` responds with `Vary: Accept-Version, X-API-Version, Authorization, Accept-Language, X-Phase-Lang`.
- **Flag off:** the proof reports `/api/versions` → 404 as expected. `GET /api/market` with `X-API-Version: nope` returns 200 with no `X-API-Version` header, which is the pre-spike behavior.

A deployed preview run (checklist below) still confirms the same on Vercel's edge.

## Live proof checklist (run by the maintainer)

1. Deploy this branch to a preview with `FEATURE_PHASE_API_VERSIONING=1` (no other env needed for this proof).
2. `npm run proof:663 -- --base-url https://<preview-host>`. Every line should say PASS, and the run writes `.data/proofs/663-*.json`.
3. Check gated caching on a real token: `curl -sI "https://<preview-host>/api/metadata/<TOKEN_ID>?c=<CONTRACT_ID>"` must still include `Authorization` in `Vary` and the route's CORS headers. Take `TOKEN_ID` and `CONTRACT_ID` from your deployment's env, not from code.
4. Unset `FEATURE_PHASE_API_VERSIONING`, redeploy, and rerun step 2. The first check should fail with "returned 404", and no `X-API-Version` header should appear.
5. Fill in:

| Item | Value |
|---|---|
| Preview URL | `<<PASTE>>` |
| Current version reported by `/api/versions` | `<<PASTE>>` |
| `Vary` on `/api/metadata/<id>` (flag on) | `<<PASTE>>` |
| Proof file (flag on) | `<<PASTE .data/proofs/663-….json>>` |
| Proof file (flag off) | `<<PASTE .data/proofs/663-….json>>` |

## Follow-up / out of scope for this PR

- **OpenAPI generated from zod.** The contract is a hand-written typed list because most listed routes have no zod schema. Generating from zod means adding schemas to those handlers first.
- **Changelog backfilled from git history.** `changelog.json` starts at `2026-10-17`, and earlier route changes aren't reconstructed.
- **Dual-version serving.** There's only one version today. The negotiation and the forwarded `x-phase-api-version` are the hook handlers would branch on, but no handler serves two shapes yet.
- **Response-shape diffing.** The contract records field names and statuses, not full response schemas, so a changed response body isn't caught.
- **Route adoption of `createApiRequestContext`.** Only routes that use it log `apiVersion`; none of the listed routes do yet.
