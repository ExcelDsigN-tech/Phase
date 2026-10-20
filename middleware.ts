import { NextRequest, NextResponse } from "next/server"
import { isFeatureEnabled } from "@/lib/feature-flags"
import {
  ACCEPT_VERSION_HEADER,
  API_VERSION_HEADER,
  FORWARDED_API_VERSION_HEADER,
  negotiateApiVersion,
  versionResponseHeaders,
} from "@/lib/api-versioning"

function getPhaseEnvironment(): string {
  if (typeof process === "undefined" || !process.env) return "production"
  const env = process.env.NEXT_PUBLIC_PHASE_ENV ?? process.env.NODE_ENV ?? "production"
  return env
}

function buildCSP(): string {
  const environment = getPhaseEnvironment()
  const isDev = environment === "development"

  const cspParts = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-eval' 'unsafe-inline'${isDev ? " 'unsafe-inline'" : ""}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://*.stellar.org https://soroban-testnet.stellar.org wss:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ]

  return cspParts.join("; ")
}

/**
 * phase-api-versioning: negotiate the API version for /api/* (preflights excluded, they
 * cannot carry the header value). Unsupported versions stop here with a typed
 * 406/410; negotiated ones are forwarded to the handler and echoed back.
 */
function apiVersionResponse(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl
  if (!pathname.startsWith("/api/") || request.method === "OPTIONS") return null
  if (!isFeatureEnabled("phase-api-versioning")) return null

  const negotiated = negotiateApiVersion(request.headers)
  if (!negotiated.ok) {
    // Closed fields only: the requested value is caller-controlled and never logged.
    console.warn(JSON.stringify({ event: "api_version_rejected", error: negotiated.error, status: negotiated.status }))
    return NextResponse.json(
      { error: negotiated.error, requested: negotiated.requested, supported: negotiated.supported },
      { status: negotiated.status, headers: { Vary: `${ACCEPT_VERSION_HEADER}, ${API_VERSION_HEADER}` } },
    )
  }

  const forwarded = new Headers(request.headers)
  forwarded.set(FORWARDED_API_VERSION_HEADER, negotiated.version)
  const response = NextResponse.next({ request: { headers: forwarded } })
  for (const [name, value] of Object.entries(versionResponseHeaders(request.method, pathname, negotiated.version))) {
    response.headers.set(name, value)
  }
  return response
}

export function middleware(request: NextRequest): NextResponse {
  const response = apiVersionResponse(request) ?? NextResponse.next()
  const csp = buildCSP()

  response.headers.set("Content-Security-Policy", csp)
  response.headers.set("X-Content-Type-Options", "nosniff")
  response.headers.set("X-Frame-Options", "DENY")
  response.headers.set("X-XSS-Protection", "1; mode=block")

  return response
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
}
