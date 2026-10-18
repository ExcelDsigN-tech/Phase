# Main baseline repair (2026-10-17)

Branch `chore/fix-main-baseline`, cut from `main` at `74308a0`.

| Check | Before | After |
|---|---|---|
| `tsc --noEmit` | 120 errors | 0 |
| `vitest run` | 32 failed / 351 passed, 1 file not loading | 414 passed (56 files, after merging upstream #573) |
| `next build` | failed, 12 errors | passes (3 file-tracing warnings, below) |
| `npm run lint` | could not start (no `eslint-config-next`) | runs: 286 errors, 106 warnings, all pre-existing |
| `cargo test` mock-token | failed to build | 1 passed |
| `cargo test` phase-protocol | failed to build | **still fails**: see "Blocked" |

## What was wrong

- **Dropped union members.** `PhaseFeatureFlag` lost `phase-146`..`phase-153`, `phase-editions`, `phase-timed-drops`. `SecurityCounterName` lost about 50 counters. That accounted for 94 of the 120 tsc errors.
- **Encoding damage (0d14b9a).** Several files were re-encoded as cp1252-decoded UTF-8 and given a BOM plus `// @ts-nocheck`. Spanish UI strings shipped as `TransacciÃ³n` and `â€¦`, and `●` / `”` were lost. Repaired.
- **Incomplete refactor (60001c5, #33).** `fusion-chamber.tsx` imported ten `components/chamber/*` modules. Four were never committed and five were one-word `placeholder` files. The four used ones are recreated verbatim from the deleted code. The placeholders are removed.
- **Merge losses.** The collab-split fan-out in the offers route, `IpfsDisplayImg`'s `fallback` prop, `washScreenReasonForEdition`, `viewerSignatureShort`, and the four b89c4f2 tables (`exhibitions`, `price_suggestions`, `moderation_queue`, `quest_arcs`) were all restored from the commits that introduced them.
- **Every page crashed in the browser.** `lib/stellar-wallet-kit.ts` (loaded by the wallet provider on every route) imported `randomUUID` from `node:crypto`, which the client polyfill doesn't provide, so hydration threw `randomUUID is not a function`. It now uses `globalThis.crypto.randomUUID()` (the code path is browser-only). Found with a headless Chromium smoke test.
- **No wallet signature could ever verify (SEP-53).** SEP-53 has the wallet sign `SHA256("Stellar Signed Message:\n" + message)`. Signals, world roles, avatar ownership and gated-preview viewer auth all verified the raw prefixed bytes instead, so a real Freighter signature was always rejected ("Invalid signature: payload not signed by this wallet", found during the spike 662 live proof). The tests passed because they signed the same raw bytes. All four sites now go through `verifySep53Signature`, which is tested against the official SEP-53 vectors. `tests/viewer-authorization.test.ts` also used a wallet address unrelated to its signing seed, so it could never pass; fixed.
- **Real bugs found on the way:** an SSRF gap in `validateWebhookUrl` (`127.0.0.1`, `172.16/12` and others accepted), settle verification in `lib/stellar.ts` that could never succeed (meta v4 unread, `ContractEventV0.contractId()` gone), artist attestation never reading `true`, and a winback route calling a function that never existed.

## Blocked: phase-protocol error discriminants (needs a maintainer decision)

`contracts/phase-protocol/src/lib.rs` has 36 errors because three merged spikes each numbered new `PhaseError` variants from 18 upward, and the merges kept only one set:

| Spike / commit | Variants | Discriminants |
|---|---|---|
| Economy 694/697/698/699 (on main now) | `CoinAlreadyRegistered` … `InvalidSchedule` | 18–39 |
| Spikes 672–675, 3e4b562 | `EditionSupplyExhausted`, `DropNotLive`, `InvalidSplitPayees`, `DutchQuoteStale` | 18–21 |
| Raffle, dd3e75c | `RaffleNotFound` … `RaffleMintGated` | 18–33 |

The `DataKey` variants from 3e4b562 (`EditionCounter`, `EditionCap`, `SplitPayees`, `DropWindow`, `DutchConfig`) and the raffle ones are missing too. `lib/phase-protocol.ts:spikeContractErrorCode` still maps `#18`..`#21` to the edition codes, which now collide with `Coin*` on main.

The original values exist in history but conflict, so restoring them means choosing new numbers for two of the three sets. That changes on-chain error codes and the TS mapping, so it was not done here. A maintainer needs to decide the final numbering (and whether any of these WASMs is already deployed with its numbering).

## Also found, not fixed

- **Flag collision:** b89c4f2 used `phase-142`/`phase-143` for the curator and pricing oracle, while `lib/feature-flags.ts` documents `phase-142` as AI thumbnails and `phase-143` as churn/winback. Both features read the same env var.
- **Other 3e4b562 losses:** most of its `app/api/market/route.ts` edition/split changes and its doc rows are gone. Restoring them is feature work, not a baseline fix.
- **Lint:** 286 pre-existing errors, so the CI lint step stays non-blocking.
- **CSP blocks the ticker:** `connect-src` doesn't allow `api.coingecko.com` or `timeapi.io`, which `components/system-ticker.tsx` fetches, so XLM price and EST time never load in the browser. Widening the CSP is a security call for a maintainer.
- **Build tracing warnings:** `lib/settlement-store.ts` makes Next trace the whole project from `/api/x402/verify`.
