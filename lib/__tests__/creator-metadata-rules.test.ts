import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  checkJsonFragmentBytes,
  COLLECTION_TEMPLATE,
  PHASE_ERROR_AMOUNT_BELOW_COLLECTION_PRICE,
  PHASE_ERROR_INVALID_COLLECTION_METADATA,
  validateCollectionDraft,
} from "@/lib/creator-metadata-rules"
import { validateCollectionImageUri } from "@/lib/phase-protocol"

const VECTORS = fs
  .readFileSync(path.resolve(__dirname, "../../contracts/phase-protocol/test-vectors/json-fragment.tsv"), "utf8")
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => {
    const [expect, max, hex, note] = l.split("\t")
    return { expect, max: Number(max), bytes: Uint8Array.from(Buffer.from(hex, "hex")), note }
  })

describe("phase-165 parity with str_is_safe_for_json_fragment", () => {
  it("loads the shared vectors", () => {
    expect(VECTORS.length).toBeGreaterThanOrEqual(15)
  })

  for (const v of VECTORS) {
    it(`${v.expect}: ${v.note}`, () => {
      const r = checkJsonFragmentBytes(v.bytes, v.max)
      expect(r.ok).toBe(v.expect === "ok")
      if (!r.ok) expect(r.reason).toBe(v.expect)
    })
  }

  it("documents the drift in the existing UTF-16 image URI check", () => {
    // 129 two-byte chars: 129 UTF-16 units (old check passes), 258 bytes (contract rejects).
    const uri = `ipfs://${"é".repeat(125)}`
    expect(validateCollectionImageUri(uri).ok).toBe(true)
    expect(checkJsonFragmentBytes(new TextEncoder().encode(uri), 256).ok).toBe(false)
  })
})

describe("phase-165 collection draft validation", () => {
  const draft = { name: "Genesis", price_stroops: "10000000", image_uri: "ipfs://bafybeigdyrzt" }

  it("accepts a clean draft", () => {
    expect(validateCollectionDraft(draft)).toEqual({ valid: true, issues: [] })
  })

  it("maps contract reverts to their PhaseError codes", () => {
    const r = validateCollectionDraft({ ...draft, name: 'a"b', price_stroops: "0" })
    expect(r.valid).toBe(false)
    expect(r.issues).toContainEqual(expect.objectContaining({ code: "name_quote", level: "chain", phaseError: PHASE_ERROR_INVALID_COLLECTION_METADATA }))
    expect(r.issues).toContainEqual(
      expect.objectContaining({ code: "price_not_positive", level: "chain", phaseError: PHASE_ERROR_AMOUNT_BELOW_COLLECTION_PRICE }),
    )
  })

  it("separates app policy from chain rules", () => {
    const r = validateCollectionDraft({ ...draft, image_uri: "http://x.test/a.png" })
    expect(r.valid).toBe(false)
    expect(r.issues).toEqual([expect.objectContaining({ code: "image_uri_scheme", level: "app" })])
  })

  it("non-ASCII is a warning, not a failure, because the contract accepts it", () => {
    const r = validateCollectionDraft({ ...draft, name: "Génesis" })
    expect(r.valid).toBe(true)
    expect(r.issues).toEqual([expect.objectContaining({ code: "name_non_ascii", level: "warn" })])
  })

  it("rejects malformed files and prices", () => {
    expect(validateCollectionDraft([]).valid).toBe(false)
    expect(validateCollectionDraft({ name: "x" }).issues.map((i) => i.code)).toEqual(["price_stroops_missing", "image_uri_missing"])
    expect(validateCollectionDraft({ ...draft, price_stroops: "1.5" }).issues[0].code).toBe("price_not_integer")
    expect(validateCollectionDraft({ ...draft, price_stroops: (BigInt(1) << BigInt(127)).toString() }).issues[0].code).toBe("price_overflow")
  })

  it("the scaffold template validates once a name is filled in", () => {
    expect(validateCollectionDraft({ ...COLLECTION_TEMPLATE, name: "Mine" }).valid).toBe(true)
  })
})
