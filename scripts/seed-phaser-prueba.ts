/**
 * Crea en testnet una colección de prueba **PHASERPRUEBA** (`create_collection` en el contrato PHASE).
 * Cada dirección G solo puede tener **una** colección: usá una cuenta dedicada (Friendbot) o
 * `SEED_PHASER_PRUEBA_SECRET`; si ya tiene colección, el script imprime el id y sale.
 *
 * Después: abrí `/chamber?collection=<id>`, conectá **Albedo** (o otra wallet del kit), pagá el settle
 * con PHASELQ — el NFT queda en Soroban igual que con Freighter.
 *
 * Requiere: `stellar` CLI, cuenta con XLM testnet, y en `.env.local` del repo:
 *   - `NEXT_PUBLIC_PHASE_PROTOCOL_ID` o `PHASE_PROTOCOL_ID` (C… del PHASE NFT)
 *   - `SEED_PHASER_PRUEBA_SECRET` o `ADMIN_SECRET_KEY` (S… de la cuenta creadora)
 *
 * Uso (desde la raíz del repo):
 *   npm run seed:phaser-prueba
 *
 * Opcional en `.env.local`:
 *   SEED_PHASER_PRUEBA_PRICE_STROOPS=10000000   (default = REQUIRED_AMOUNT o 10000000)
 *   SEED_PHASER_PRUEBA_IMAGE_URI=https://...     (HTTPS, sin " ni \\ en la cadena)
 */

import { config } from "dotenv"
import { execFileSync } from "child_process"
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { Keypair } from "@stellar/stellar-sdk"
import { creatorPreflight } from "./creator-preflight.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")

config({ path: resolve(ROOT, ".env.local") })

const RPC = process.env.STELLAR_RPC_URL?.trim() || "https://soroban-testnet.stellar.org"
const NET = process.env.STELLAR_NETWORK_PASSPHRASE?.trim() || "Test SDF Network ; September 2015"

const COLLECTION_NAME = process.env.SEED_PHASER_PRUEBA_NAME?.trim() || "PHASERPRUEBA"
const IMAGE_URI =
  process.env.SEED_PHASER_PRUEBA_IMAGE_URI?.trim() ||
  "https://placehold.co/512x512/0a1628/00ffff/png?text=PHASERPRUEBA"

function phaseContractIdFromEnvOrDefaults(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_PHASE_PROTOCOL_ID?.trim() || process.env.PHASE_PROTOCOL_ID?.trim()
  if (fromEnv && fromEnv.length >= 32) return fromEnv
  const defPath = resolve(ROOT, "lib/phase-contract-defaults.ts")
  if (!existsSync(defPath)) {
    throw new Error("Missing NEXT_PUBLIC_PHASE_PROTOCOL_ID and lib/phase-contract-defaults.ts")
  }
  const text = readFileSync(defPath, "utf8")
  const m = text.match(/export const DEFAULT_PHASE_CONTRACT = "([^"]+)"/)
  if (!m?.[1]) throw new Error("Could not parse DEFAULT_PHASE_CONTRACT from phase-contract-defaults.ts")
  return m[1]
}

function parseU64Line(stdout: string): number | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    if (/^null$/i.test(line) || /^none$/i.test(line)) return null
    const m = line.match(/^\d+$/)
    if (m) return parseInt(m[0]!, 10)
  }
  const last = lines[lines.length - 1] ?? ""
  const any = last.match(/\b(\d{1,12})\b/)
  return any ? parseInt(any[1]!, 10) : null
}

function stellar(secret: string, args: string[]): string {
  return execFileSync("stellar", args, {
    encoding: "utf8",
    env: { ...process.env, STELLAR_ACCOUNT: secret },
    maxBuffer: 16 * 1024 * 1024,
  })
}

function printNextSteps(collectionId: number, origin: string) {
  const chamber = `${origin}/chamber?collection=${collectionId}`
  console.log("\n── Colección PHASERPRUEBA (testnet) ──")
  console.log("  collection_id:", collectionId)
  console.log("  Chamber:", chamber)
  console.log("\nOpcional en .env.local (atajo UI / docs):")
  console.log(`  NEXT_PUBLIC_PHASER_PRUEBA_COLLECTION_ID=${collectionId}`)
  console.log("\nConectá Albedo → misma página → EXECUTE_SETTLEMENT: el NFT queda guardado en el contrato PHASE.")
}

function main() {
  const secret =
    process.env.SEED_PHASER_PRUEBA_SECRET?.trim() || process.env.ADMIN_SECRET_KEY?.trim()
  if (!secret || secret.length < 20) {
    console.error(
      "Missing SEED_PHASER_PRUEBA_SECRET or ADMIN_SECRET_KEY in .env.local (S… de cuenta con XLM testnet).",
    )
    process.exit(1)
  }

  const contractId = phaseContractIdFromEnvOrDefaults()
  const kp = Keypair.fromSecret(secret)
  const pub = kp.publicKey()

  const price =
    process.env.SEED_PHASER_PRUEBA_PRICE_STROOPS?.trim() ||
    process.env.REQUIRED_AMOUNT?.trim() ||
    "10000000"

  console.log("PHASE contract:", contractId)
  console.log("Creator (must have no prior collection):", pub)

  const readOut = stellar(secret, [
    "contract",
    "invoke",
    "--id",
    contractId,
    "--network",
    "testnet",
    "--rpc-url",
    RPC,
    "--network-passphrase",
    NET,
    "--send",
    "no",
    "--",
    "get_creator_collection_id",
    "--creator",
    pub,
  ])

  const existing = parseU64Line(readOut)
  if (existing != null && existing > 0) {
    const origin = process.env.NEXT_PUBLIC_APP_ORIGIN?.trim() || "http://localhost:3000"
    console.log("Esta cuenta ya tiene colección on-chain:", existing)
    printNextSteps(existing, origin.replace(/\/$/, ""))
    process.exit(0)
  }

  console.log("Invocando create_collection…")
  // La CLI Soroban espera strings como JSON (p. ej. --name '"PHASERPRUEBA"').
  const createOut = stellar(secret, [
    "contract",
    "invoke",
    "--id",
    contractId,
    "--network",
    "testnet",
    "--rpc-url",
    RPC,
    "--network-passphrase",
    NET,
    "--",
    "create_collection",
    "--creator",
    pub,
    "--name",
    JSON.stringify(COLLECTION_NAME),
    "--price",
    price,
    "--image_uri",
    JSON.stringify(IMAGE_URI),
  ])

  if (createOut) console.log(createOut.slice(0, 1200))

  const newId = parseU64Line(createOut)
  if (newId == null || newId <= 0) {
    console.error("No se pudo leer collection_id del output. Revisá errores arriba (¿CreatorAlreadyHasCollection?).")
    process.exit(1)
  }

  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN?.trim() || "http://localhost:3000"
  printNextSteps(newId, origin.replace(/\/$/, ""))
}

creatorPreflight({
  script: "seed-phaser-prueba.ts",
  plan: [
    "invoke create_collection(PHASERPRUEBA) on the PHASE contract from SEED_PHASER_PRUEBA_SECRET or ADMIN_SECRET_KEY",
    "print the collection id and /chamber link",
  ],
})

main()
