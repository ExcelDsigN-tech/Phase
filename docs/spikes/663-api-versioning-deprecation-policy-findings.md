# Spike 663 — Machine-Readable API Versioning, Changelog and Deprecation Policy Findings (Issue #526)

## What the issue claimed

The API has no version negotiation, no way to announce a deprecation or sunset, no machine-readable contract or changelog, and nothing in CI that stops a change from silently breaking a client.

## What the code actually did at spike time

- No route read `Accept-Version` or `X-API-Version`, and no response carried a version.
- No `Deprecation`, `Sunset` or `Link: rel="deprecation"` header existed anywhere.
- There was no OpenAPI document. Response shapes lived only in the handlers.
- `lib/api-observability.ts:createApiRequestContext` existed but no listed route used it. Every handler returns `NextResponse.json` directly, often from ten or more places.
- CI ran lint and typecheck as non-blocking and build as blocking. Nothing compared the API surface between commits.

## Delivered (phase-163)

1. **Contract source** (`lib/api-contract.ts`): one typed entry per operation (24, across 15 paths) with method, path, query/path/header params, body fields, the status codes each handler actually returns (read off the source per handler), `stateChanging` and `signing`. Spike 662's playground reads the same list.
2. **Negotiation** (`lib/api-versioning.ts:negotiateApiVersion`, wired in `middleware.ts`): for `/api/*` (not preflights) when the flag is on. `X-API-Version` pins an exact id and wins. `Accept-Version` takes a comma list and the first supported id. No header means the current version. Unknown or malformed gives a typed `406 UNSUPPORTED_API_VERSION` with the supported list. A version past its sunset gives `410 API_VERSION_SUNSET`. Version ids are dates (`YYYY-MM-DD`), starting at `2026-10-17`.
3. **Echo and deprecation headers** (`versionResponseHeaders`): every negotiated response carries `X-API-Version` and `Vary: Accept-Version, X-API-Version`. Deprecated versions or routes add `Deprecation: @<unix>` (RFC 9745), `Sunset: <HTTP-date>` (RFC 8594) and `Link` with `rel="deprecation"` and `rel="successor-version"`. Route entries use path templates (`/api/metadata/{id}`). `ROUTE_DEPRECATIONS` is empty today because nothing is deprecated. It is the one place to add entries.
4. **Handler visibility** (`lib/api-observability.ts`): middleware forwards the negotiated id as `x-phase-api-version`. `createApiRequestContext` logs it as `apiVersion` and echoes it, but only when it is a known id, so the log label stays a closed set.
5. **Machine-readable docs**: `docs/api/openapi.json` (OpenAPI 3.1, with `x-state-changing`, `x-signing` and `x-api-versions`) and `docs/api/changelog.json`, both rendered from source by `npm run api:contract -- --write`. `GET /api/versions` serves the summary, or the OpenAPI document with `?format=openapi`, and returns 404 when the flag is off.
6. **CI breaking-change gate** (`scripts/api-contract.cts`, `.github/workflows/ci.yml`): blocking step. On a PR it diffs the generated contract against the target branch's committed snapshot, so regenerating the snapshot cannot hide a break. Breaking means an operation, param, body field, 2xx status or response header removed, a param made required, or a version dropped before its sunset. A break passes only with a new current version and a changelog entry flagged `breaking: true`. Exit codes: 0 ok, 1 breaking, 2 stale snapshot, 64 bad args.

The CI gate is dev tooling and runs regardless of the flag. It checks source files, not runtime behavior.

## Files ruled out

| File | Why it is not changed |
|------|-----------------------|
| `app/api/faucet/route.ts`, `claim-bounty`, `soroban-rpc`, `classic-liq`, `classic-liq/trustline`, `nft-listings`, `market`, `signals`, `x402`, `ipfs`, `metadata/[id]` route files | Negotiation and headers run in `middleware.ts` for every `/api/*` path, which covers all eleven without editing their many return sites. Each one is described in `lib/api-contract.ts`, and the contract test asserts every status listed there is in the OpenAPI document. Per-route edits would duplicate the middleware and risk missing a return path. |
| `lib/server-data-paths.ts` | Nothing is persisted. Versions, deprecations and the changelog are source-controlled constants, and the snapshots are build artifacts under `docs/api/`, not runtime JSON sidecars. |

## Spike questions

The upstream issue text was not reachable from the session that built this, so these follow the summary it was given.

1. **Rollback?** Unset `FEATURE_PHASE_163` / `NEXT_PUBLIC_FEATURE_PHASE_163` and restart. Middleware stops negotiating, the version headers disappear, and `/api/versions` returns 404. Nothing is stored. The CI gate stays, since it only reads source.
2. **WASM or contract migration?** Does not apply. No Soroban contract, ledger state or storage changes.
3. **Metrics?** Handlers that use `createApiRequestContext` log `apiVersion` from a closed set. The middleware logs `api_version_rejected` with only `error` and `status`. The requested value is caller-controlled, so it is never logged. No wallet or PII fields.
4. **Tests?** `lib/__tests__/api-versioning.test.ts` (18 cases): negotiation precedence, 406 and 410 paths, RFC header formats, path-template deprecations, contract coverage, snapshot freshness, diff and gate rules, and the middleware with the flag off and on (including that preflights and pages are untouched).
5. **Error normalization?** Untouched. Negotiation only adds a pre-handler 406/410. Domain errors, including gate `#13` → `[ ERROR: BIOMETRIC_TRUST_GATE_CLOSED ]`, flow through the handlers exactly as before.

## Still needs manual verification

- A deployed check that middleware response headers merge onto every route's own headers (CORS on `/api/metadata/[id]` in particular) on Vercel.
- Middleware runs in an edge isolate, so the process-local `security-counters` module would not aggregate there. That's why rejections are logged rather than counted.
- Real clients have not been asked to send `X-API-Version` yet. Until one does, the flag only adds headers.
