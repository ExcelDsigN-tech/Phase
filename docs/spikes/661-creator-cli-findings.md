# Spike 661 — Creator CLI (Scaffold, Metadata Validation, Pin, Deploy) Findings (Issue #524)

## What the issue claimed

Deploying is a manual, multi-step shell process. Fifteen one-off scripts share no CLI framework, bin or validation layer. Metadata rules are only enforced on-chain, so creators find violations after paying fees, and pinning needs a running Next.js server. The goal is a standalone terminal CLI with scaffolding, offline validation that mirrors the Rust rules, resumable pin-then-deploy, and CI-friendly output (`--json`, `--dry-run`, `--network`, exit codes).

## What the code actually did at spike time

- The scripts under `scripts/` each load `.env.local` their own way, print free-form text, and `process.exit(1)` for every kind of failure. None had tests.
- `scripts/package.json` is `"type": "module"`, which breaks named imports from `lib/` under tsx. `scripts/diagnose-env.ts` already documented this.
- `create_collection` in `lib.rs` rejects with `#9` when `price <= 0` and `#10` when `str_is_safe_for_json_fragment` fails for `name` (64) or `image_uri` (256). That check counts **UTF-8 bytes**, allows empty strings, and rejects `"`, `\` and bytes below `0x20`. **It does not reject non-ASCII.**
- `lib/phase-protocol.ts:validateCollectionImageUri` counts UTF-16 code units, so a multi-byte URI can pass the UI and still revert on-chain with `#10`.
- `scripts/setup_token.ts` hardcodes a token contract ID and an admin address as fallbacks. That predates this spike and is listed under follow-up.

The issue asks for ASCII rejection, but the contract doesn't reject non-ASCII, so a validator that did would block names the chain accepts. The validator mirrors the contract and reports non-ASCII as a warning.

## Delivered in this PR (phase-creator-cli)

1. **One command tree** (`lib/creator-cli.ts`, entry `scripts/phase-creator.cts`, `bin: phase-creator`, `npm run creator --`): `scaffold`, `validate`, `env` (the diagnose command), `pin`, `deploy`, `run`. Global `--json`, `--dry-run`, `--network` (only `testnet`). Exit codes: 0 ok, 1 invalid input, 2 usage, 3 env missing, 4 remote failure, 5 flag off.
2. **Offline validation with Rust parity** (`lib/creator-metadata-rules.ts`): a byte-exact port of `str_is_safe_for_json_fragment` plus the price rule. Issues are tagged `chain` (would revert, with the PhaseError number), `app` or `warn`. Shared vectors in `contracts/phase-protocol/test-vectors/json-fragment.tsv` run in vitest and in `src/test.rs`.
3. **Headless pin**: `pin <file>` uses the shared `resolvePinataJwt` (the API route uses it too) and `pinFileToIpfsWithRetry` with checksum verification. The JWT and any Stellar seed are scrubbed from every message.
4. **Reusable env diagnostics** (`lib/env-validation.ts:diagnoseCreatorEnv`): presence and format per capability, a testnet passphrase check, and detection of a secret seed in a `NEXT_PUBLIC_*` var. It never returns a value. `diagnose-env.ts` shows the same section when the flag is on.
5. **Thin wrappers**: every listed script now calls `creatorPreflight()` (`scripts/creator-preflight.ts`) right before its `main()`. `--dry-run` prints that script's plan and exits 0 before any network call, key generation or file write. With `FEATURE_PHASE_CREATOR_CLI=1`, the script first runs `phase-creator env --json` and stops with exit 3 on a missing or malformed variable. With the flag off and no `--dry-run`, the preflight returns immediately and the script runs exactly as before. Each script's own logic is untouched.

## Spike questions (from the issue)

1. **Minimal testnet loop, and which listed files can break it?** For this CLI the loop is: validate the draft offline, pin the asset, deploy and `initialize` phase-protocol, `create_collection` with the validated draft, mint, then display it in `/chamber`. Files that can break it on their own: `lib/creator-metadata-rules.ts` (a validator that disagrees with `lib.rs` lets a draft through that reverts with `#10`; the shared vectors fence this), `lib/ipfs-upload-retry.ts` and `app/api/ipfs/route.ts` (JWT lookup and pin), `scripts/deploy-phase-sep50.ts` (deploy and `.env.local` rewrite), and `lib/env-validation.ts` (a wrong check blocks deploy with exit 3). The live run is in the checklist below.
2. **Replay and idempotency per write.** `validate` and `env` don't write. `pin` is content-addressed: pinning the same bytes twice returns the same CID, and the sha256 check catches corrupted retries. `deploy` is **not** idempotent, because each run deploys a new contract instance and rewrites `.env.local`. The CLI doesn't resume a half-finished deploy. That's the "resumable pin-then-deploy" ask, and it's listed under follow-up. A double submit after a timeout in `create_collection` creates two collections, since the contract has no dedupe key; the CLI doesn't call `create_collection` itself.
3. **Contract-ID drift, issuer rotation, gateway failover.** `env --needs deploy` checks that `NEXT_PUBLIC_PHASER_TOKEN_ID` is a valid `C…` and the treasury a valid `G…`, but it can't tell whether they point at the deployment you meant. Drift between `.env.local` and the deployed instance isn't detected (follow-up). Pinning goes through Pinata only; the multi-gateway paths (phase-117/123) are read-side and not used by `pin`.
4. **409/429/412 taxonomy.** The CLI maps outcomes to exit codes instead: Pinata 429/5xx is retried with backoff inside `pinFileToIpfsWithRetry`, then becomes exit 4 with the error code. No CLI command does an ETag/If-Match write. No input is lost because every command is file-based and nothing is overwritten (`scaffold` refuses an existing file).
5. **Migration and rollback.** No WASM change and no schema change. Rollback is unsetting `FEATURE_PHASE_CREATOR_CLI`: side-effecting CLI commands exit 5, the preflight goes back to a no-op, read-only commands keep working, and nothing is persisted. A deploy made through the CLI is the same as one made by the old script, so the existing "new instance, old NFTs stay on the old contract" story applies.

## Acceptance criteria status

| Criterion | Status |
|---|---|
| End-to-end testnet proof with tx hashes and contract IDs, no hardcoded IDs | Runner and checklist below. Needs the live run. The new code hardcodes no IDs. |
| Concurrency proof (409 with current version) | Not applicable: the CLI does no versioned writes. |
| Abuse proof (self-deal, sybil, replay, expired, tampered; no PII in labels) | Tampered or invalid metadata is rejected offline with the PhaseError it would cause. Secrets never reach output (tested). The rest is not applicable to a local tool. |
| Resilience proof (RPC/gateway/Horizon failover, circuit breaker) | Pin retry with backoff is tested. RPC/Horizon failover is not part of this CLI. |
| i18n, `#13` mapping, docs, flag row | CLI output is English-only by design (CI tool, no UI). `#13` handling is untouched. Flag row added in `PROJECT_ARCHITECTURE.md` §10 and `docs/TECHNICAL.md`. |
| No regression with flags off (tsc, vitest) | `tsc --noEmit` 0 errors, vitest green, `--dry-run` tested for every wrapped script. |

## Live proof checklist (run by the maintainer)

Prereqs: `stellar` CLI on PATH, a funded testnet admin account, a Pinata JWT, and the optimized WASM built (`cd contracts/phase-protocol && cargo build --target wasm32-unknown-unknown --release && stellar contract optimize ...`).

1. Put these in `.env.local` (never commit it): `FEATURE_PHASE_CREATOR_CLI=1`, `PINATA_JWT`, `ADMIN_SECRET_KEY`, `NEXT_PUBLIC_PHASER_TOKEN_ID`, `NEXT_PUBLIC_CLASSIC_LIQ_ISSUER`, `STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015`.
2. `npm run creator -- env --needs pin,deploy` should exit 0 with every check `ok`.
3. `npm run creator -- scaffold ./my-drop`, fill in `name` and `image_uri`, then `npm run creator -- validate ./my-drop/collection.json`. Then try a name with a `"` and confirm exit 1 with `PhaseError #10`.
4. Dry run: `npm run proof:661 -- --asset ./my-drop/cover.png --collection ./my-drop/collection.json`.
5. Live run: `npm run proof:661 -- --asset ./my-drop/cover.png --collection ./my-drop/collection.json --live`.
6. Wrapper check: `npx tsx scripts/reset-phase.ts --dry-run` and `npx tsx scripts/deploy-phase-sep50.ts --dry-run` print a plan and exit 0, and nothing appears on stellar.expert for the admin account.
7. Attach `.data/proofs/661-*.json` and fill in:

| Item | Value |
|---|---|
| Pinned CID (`pin` step `uri`) | `<<PASTE ipfs://…>>` |
| Pin sha256 | `<<PASTE>>` |
| New phase-protocol contract ID (deploy output) | `<<PASTE C…>>` |
| Deploy tx hash | `<<PASTE>>` |
| `initialize` tx hash | `<<PASTE>>` |
| `create_collection` tx hash (via `/forge` or `stellar contract invoke`) | `<<PASTE>>` |
| Collection id shown in `/chamber?collection=` | `<<PASTE>>` |
| Proof file name | `<<PASTE .data/proofs/661-….json>>` |

## Follow-up / out of scope for this PR

- **Resumable pin-then-deploy**: persist a step journal so a failed deploy resumes instead of starting over.
- **Contract-ID drift detection**: compare `.env.local` IDs with what the RPC reports for the WASM hash.
- **Fold the old scripts into the CLI**: they're wrappers now (preflight + dry-run), but their logic still lives in each file.
- **Fix `validateCollectionImageUri`'s UTF-16 counting** in `lib/phase-protocol.ts` (not in this issue's file list; changing it changes what the live UI accepts).
- **Remove the hardcoded fallback IDs** in `scripts/setup_token.ts`.
- **Run the Rust parity test in CI.** `phase-protocol` doesn't compile on main until the `PhaseError` discriminant collision is resolved (see `docs/investigations/main-baseline-2026-10-17.md`). Until then, the shared vectors have been verified against `str_is_safe_for_json_fragment` extracted verbatim into a scratch crate.
