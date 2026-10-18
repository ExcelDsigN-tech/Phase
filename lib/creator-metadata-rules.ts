/**
 * Spike 661 (phase-165): offline mirror of the on-chain collection metadata
 * rules in `contracts/phase-protocol/src/lib.rs`.
 *
 * `create_collection` rejects with:
 * - `AmountBelowCollectionPrice` (#9) when `price <= 0`
 * - `InvalidCollectionMetadata` (#10) when `str_is_safe_for_json_fragment`
 *   fails for `name` (max 64) or `image_uri` (max 256)
 *
 * `str_is_safe_for_json_fragment` works on UTF-8 bytes: length is the byte
 * count, empty is allowed, and any `"`, `\` or byte below 0x20 is rejected.
 * It does not reject non-ASCII. This module checks bytes the same way, and
 * the parity vectors in `contracts/phase-protocol/test-vectors/` are run by
 * both the Rust and the vitest suites.
 */

export const ONCHAIN_NAME_MAX_BYTES = 64
export const ONCHAIN_IMAGE_URI_MAX_BYTES = 256

export const PHASE_ERROR_AMOUNT_BELOW_COLLECTION_PRICE = 9
export const PHASE_ERROR_INVALID_COLLECTION_METADATA = 10

export type FragmentRejection = "too_long" | "quote" | "backslash" | "control_char"

export type FragmentCheck =
  | { ok: true; bytes: number }
  | { ok: false; reason: FragmentRejection; bytes: number; byteIndex?: number }

/** Byte-exact port of `str_is_safe_for_json_fragment`. */
export function checkJsonFragmentBytes(bytes: Uint8Array, maxLen: number): FragmentCheck {
  const n = bytes.length
  if (n > maxLen) return { ok: false, reason: "too_long", bytes: n }
  for (let i = 0; i < n; i++) {
    const b = bytes[i]
    if (b === 0x22) return { ok: false, reason: "quote", bytes: n, byteIndex: i }
    if (b === 0x5c) return { ok: false, reason: "backslash", bytes: n, byteIndex: i }
    if (b < 0x20) return { ok: false, reason: "control_char", bytes: n, byteIndex: i }
  }
  return { ok: true, bytes: n }
}

export function checkJsonFragment(value: string, maxLen: number): FragmentCheck {
  return checkJsonFragmentBytes(new TextEncoder().encode(value), maxLen)
}

export type CollectionDraft = {
  name: string
  /** Stroops, as a decimal integer string (i128 on-chain). */
  price_stroops: string
  image_uri: string
}

export type MetadataIssue = {
  field: keyof CollectionDraft | "file"
  /** "chain": the contract would revert. "app": PHASE's own UI policy rejects it. "warn": allowed, but risky. */
  level: "chain" | "app" | "warn"
  code: string
  /** PhaseError discriminant when `level` is "chain". */
  phaseError?: number
  message: string
}

export type MetadataValidation = { valid: boolean; issues: MetadataIssue[] }

const I128_MAX = (BigInt(1) << BigInt(127)) - BigInt(1)

function fragmentIssues(field: "name" | "image_uri", value: string, max: number): MetadataIssue[] {
  const r = checkJsonFragment(value, max)
  if (r.ok) return []
  const where = r.byteIndex == null ? "" : ` at byte ${r.byteIndex}`
  const message: Record<FragmentRejection, string> = {
    too_long: `${field} is ${r.bytes} bytes; the contract allows ${max} (UTF-8 bytes, not characters)`,
    quote: `${field} contains a double quote${where}`,
    backslash: `${field} contains a backslash${where}`,
    control_char: `${field} contains a control character${where}`,
  }
  return [
    {
      field,
      level: "chain",
      code: `${field}_${r.reason}`,
      phaseError: PHASE_ERROR_INVALID_COLLECTION_METADATA,
      message: message[r.reason],
    },
  ]
}

/**
 * Validate a collection draft offline. `valid` is false when the contract would
 * revert or the app would refuse it; warnings never fail validation.
 */
export function validateCollectionDraft(input: unknown): MetadataValidation {
  const issues: MetadataIssue[] = []
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, issues: [{ field: "file", level: "app", code: "not_an_object", message: "collection file must be a JSON object" }] }
  }
  const draft = input as Partial<Record<keyof CollectionDraft, unknown>>

  for (const key of ["name", "price_stroops", "image_uri"] as const) {
    if (typeof draft[key] !== "string") {
      issues.push({ field: key, level: "app", code: `${key}_missing`, message: `${key} must be a string` })
    }
  }
  if (issues.length) return { valid: false, issues }
  const { name, price_stroops, image_uri } = draft as CollectionDraft

  issues.push(...fragmentIssues("name", name, ONCHAIN_NAME_MAX_BYTES))
  issues.push(...fragmentIssues("image_uri", image_uri, ONCHAIN_IMAGE_URI_MAX_BYTES))

  if (!/^-?\d+$/.test(price_stroops)) {
    issues.push({ field: "price_stroops", level: "app", code: "price_not_integer", message: "price_stroops must be an integer number of stroops" })
  } else {
    const price = BigInt(price_stroops)
    if (price <= BigInt(0)) {
      issues.push({
        field: "price_stroops",
        level: "chain",
        code: "price_not_positive",
        phaseError: PHASE_ERROR_AMOUNT_BELOW_COLLECTION_PRICE,
        message: "price_stroops must be greater than 0",
      })
    } else if (price > I128_MAX) {
      issues.push({ field: "price_stroops", level: "app", code: "price_overflow", message: "price_stroops does not fit in i128" })
    }
  }

  // App policy from lib/phase-protocol validateFinalContractImageUri: empty, https:// or ipfs://<cid>.
  if (image_uri !== "") {
    if (!/^(https|ipfs):\/\//i.test(image_uri)) {
      issues.push({ field: "image_uri", level: "app", code: "image_uri_scheme", message: "image_uri must start with https:// or ipfs://" })
    } else if (/^ipfs:\/\//i.test(image_uri) && image_uri.slice(7).replace(/^\/+/, "").length < 4) {
      issues.push({ field: "image_uri", level: "app", code: "image_uri_cid_short", message: "ipfs:// URI has no usable CID" })
    }
  }

  if (name.trim() === "") {
    issues.push({ field: "name", level: "warn", code: "name_empty", message: "name is empty; the contract allows it but wallets will show a blank title" })
  }
  for (const [field, value] of [["name", name], ["image_uri", image_uri]] as const) {
    // The contract accepts non-ASCII. Flag it because the byte budget shrinks and some wallets render it poorly.
    if (/[^\x00-\x7f]/.test(value)) {
      issues.push({ field, level: "warn", code: `${field}_non_ascii`, message: `${field} contains non-ASCII characters; allowed on-chain, counted as UTF-8 bytes` })
    }
    if (value !== value.trim()) {
      issues.push({ field, level: "warn", code: `${field}_whitespace`, message: `${field} has leading or trailing whitespace; it is stored as-is on-chain` })
    }
  }

  return { valid: !issues.some((i) => i.level !== "warn"), issues }
}

export const COLLECTION_TEMPLATE: CollectionDraft = {
  name: "",
  price_stroops: "10000000",
  image_uri: "",
}
