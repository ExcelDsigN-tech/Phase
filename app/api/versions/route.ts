import { NextRequest, NextResponse } from "next/server"
import { isFeatureEnabled } from "@/lib/feature-flags"
import {
  API_CHANGELOG,
  API_VERSIONS,
  buildOpenApiDocument,
  currentApiVersion,
  ROUTE_DEPRECATIONS,
} from "@/lib/api-versioning"

export const dynamic = "force-dynamic"

/** phase-api-versioning: machine-readable versions, deprecations, changelog and OpenAPI contract. */
export async function GET(request: NextRequest) {
  if (!isFeatureEnabled("phase-api-versioning")) {
    return NextResponse.json({ error: "Feature phase-api-versioning disabled" }, { status: 404 })
  }
  const format = request.nextUrl.searchParams.get("format")
  if (format === "openapi") {
    return NextResponse.json(buildOpenApiDocument())
  }
  if (format && format !== "summary") {
    return NextResponse.json({ error: "format must be summary or openapi" }, { status: 400 })
  }
  return NextResponse.json({
    current: currentApiVersion(),
    versions: API_VERSIONS,
    deprecations: ROUTE_DEPRECATIONS,
    changelog: API_CHANGELOG,
  })
}
