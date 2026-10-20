/**
 * xBull full support with sign, trustline and Freighter-difference matrix.
 *
 * Feature flag: phase-168 (Spike 624 / Issue #487).
 * Rollback: unset NEXT_PUBLIC_FEATURE_PHASE_168 / FEATURE_PHASE_168. Zero persistent migration.
 */

import { isFeatureEnabled, flagRollbackNote } from "@/lib/feature-flags"
import { recordSecurityCounter } from "@/lib/security-counters"

export function isXBullEnabled(): boolean {
  return isFeatureEnabled("phase-168")
}

export function xbullRollbackNote(): string {
  return flagRollbackNote("phase-168")
}

export const XBULL_ID = "xbull"
const LS_SELECTED_MODULE_ID = "@StellarWalletsKit/selectedModuleId"

/**
 * Checks whether xBull is the currently selected wallet module in StellarWalletsKit.
 */
export function isXBullSelected(): boolean {
  if (typeof window === "undefined") return false
  const selected = window.localStorage.getItem(LS_SELECTED_MODULE_ID)?.trim()?.toLowerCase()
  return selected === XBULL_ID || selected === "xbull-wallet"
}

// ── Freighter vs xBull Difference Matrix ─────────────────────────────────────

export const FREIGHTER_XBULL_DIFFERENCE_MATRIX = {
  returnShape: {
    freighter: "{ signedTxXdr: string }",
    xbull: "{ signedTxXdr?: string, signedTransaction?: string } | raw string",
    resolution: "Normalized via normalizeXBullSignResult() into standard { signedTxXdr, signedTransaction }",
  },
  errorHandling: {
    freighter: "Standard Error with message",
    xbull: "Error object or string (e.g. 'user_rejected', 'cancelled', 'Extension not installed')",
    resolution: "Mapped via mapXBullError() with retryable and humanized bilingual copy",
  },
  trustlines: {
    freighter: "Batched changeTrust accepted without sequence re-sync",
    xbull: "Requires fee-bump verification and explicit networkPassphrase validation",
    resolution: "Validate network and envelopment before submitting",
  },
  windowFocus: {
    freighter: "Background modal keeps state",
    xbull: "Extension popup can dismiss on blur",
    resolution: "Retry prompt with persistence guidance",
  },
} as const

// ── Result Normalizer ────────────────────────────────────────────────────────

/**
 * Normalizes any xBull signature return shape into the standard Phase signed result.
 */
export function normalizeXBullSignResult(result: unknown): {
  signedTxXdr: string
  signedTransaction: string
} {
  if (!result) {
    throw new Error("xBull returned empty signature result.")
  }

  // String result (raw XDR)
  if (typeof result === "string" && result.trim().length > 0) {
    const raw = result.trim()
    recordSecurityCounter("xbull_sign_success")
    return { signedTxXdr: raw, signedTransaction: raw }
  }

  if (typeof result === "object" && result !== null) {
    const res = result as Record<string, unknown>
    const candidate =
      (typeof res.signedTxXdr === "string" && res.signedTxXdr.trim()) ||
      (typeof res.signedTransaction === "string" && res.signedTransaction.trim()) ||
      (typeof res.xdr === "string" && res.xdr.trim()) ||
      (typeof res.result === "string" && res.result.trim()) ||
      ""

    if (candidate) {
      recordSecurityCounter("xbull_sign_success")
      return { signedTxXdr: candidate, signedTransaction: candidate }
    }
  }

  throw new Error("xBull signature result could not be normalized into transaction XDR.")
}

// ── Error Mapper ─────────────────────────────────────────────────────────────

export type XBullErrorMapped = {
  code: "REJECTED" | "NOT_INSTALLED" | "LOCKED" | "INVALID_NETWORK" | "POPUP_CLOSED" | "UNKNOWN"
  message: string
  retryable: boolean
  userAction: string
}

/**
 * Maps raw xBull exceptions or error codes into human-readable Phase errors.
 */
export function mapXBullError(err: unknown): XBullErrorMapped {
  recordSecurityCounter("xbull_sign_rejected")
  const raw = err instanceof Error ? err.message : typeof err === "object" && err !== null ? JSON.stringify(err) : String(err)
  const lower = raw.toLowerCase()

  if (/user_rejected|cancelled|cancelado|rejected|denied/i.test(lower)) {
    return {
      code: "REJECTED",
      message: "xBull: Transacción cancelada por el usuario. / Transaction rejected by user in xBull.",
      retryable: true,
      userAction: "Reintentá cuando estés listo para firmar en xBull.",
    }
  }

  if (/extension not installed|not found|no provider/i.test(lower)) {
    return {
      code: "NOT_INSTALLED",
      message: "xBull: Extensión no detectada en el navegador. / xBull extension not detected.",
      retryable: false,
      userAction: "Instalá la extensión xBull o seleccioná otra wallet en el selector.",
    }
  }

  if (/password rejected|locked|bloquead/i.test(lower)) {
    return {
      code: "LOCKED",
      message: "xBull: La wallet está bloqueada o contraseña incorrecta. / xBull wallet is locked.",
      retryable: true,
      userAction: "Desbloqueá la extensión xBull e intentá nuevamente.",
    }
  }

  if (/invalid network|network mismatch|wrong network/i.test(lower)) {
    return {
      code: "INVALID_NETWORK",
      message: "xBull: Red incorrecta configurada en la wallet. / xBull network mismatch.",
      retryable: true,
      userAction: "Abrí xBull y cambiá a la red Stellar Testnet.",
    }
  }

  if (/closed|blur|dismissed/i.test(lower)) {
    return {
      code: "POPUP_CLOSED",
      message: "xBull: La ventana de firma se cerró antes de completar. / xBull popup closed.",
      retryable: true,
      userAction: "Mantené la ventana de xBull visible durante la firma.",
    }
  }

  return {
    code: "UNKNOWN",
    message: `xBull error: ${raw}`,
    retryable: true,
    userAction: "Revisá la extensión xBull y volvé a intentar.",
  }
}
