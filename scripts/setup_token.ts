/**
 * Inicializa metadata del token existente en testnet (CDW3...).
 *
 * Uso:
 *   cd scripts && npm run setup:token
 */

import { Keypair, StrKey } from "@stellar/stellar-sdk"
import { colors, log, RPC_URL, runCommand, TESTING_SECRET_KEY } from "./utils.js"
import { creatorPreflight } from "./creator-preflight.js"

const TOKEN_CONTRACT_ID =
  process.env.TOKEN_CONTRACT_ID?.trim() ||
  process.env.MOCK_TOKEN_ID?.trim() ||
  "CDOAXHWC6YJB7U3ELV67HKJY6HEMJFBNRGJK6WZGUAELBWP3WP77RLFD"

const DEFAULT_ADMIN = "GDLYJDLSXBIFDM3NHGUESEM4CWO47ECD37O5I5XOA6SMILWB3AJHXLSX"
const ADMIN_ADDRESS =
  process.env.TOKEN_ADMIN_ADDRESS?.trim() ||
  process.env.FREIGHTER_PUBLIC_KEY?.trim() ||
  DEFAULT_ADMIN

const TOKEN_DECIMALS = 7
const TOKEN_NAME = "Phase Liquidity"
const TOKEN_SYMBOL = "PHASELQ"

async function main() {
  log.section("PHASE Token - Setup Metadata (initialize)")

  if (!StrKey.isValidContract(TOKEN_CONTRACT_ID)) {
    log.error(`Contract ID inválido: ${TOKEN_CONTRACT_ID}`)
    process.exit(1)
  }
  if (!StrKey.isValidEd25519PublicKey(ADMIN_ADDRESS)) {
    log.error(`Admin inválido: ${ADMIN_ADDRESS}`)
    process.exit(1)
  }

  const sourceFlag = TESTING_SECRET_KEY
    ? "--source deployer"
    : `--source ${ADMIN_ADDRESS}`

  if (TESTING_SECRET_KEY) {
    try {
      const derived = Keypair.fromSecret(TESTING_SECRET_KEY).publicKey()
      log.info(`Signer (from TESTING_SECRET_KEY): ${derived}`)
    } catch {
      log.warning("TESTING_SECRET_KEY presente pero inválida. Se intentará igualmente con alias deployer.")
    }
  }

  log.info(`Contract: ${TOKEN_CONTRACT_ID}`)
  log.info(`Admin: ${ADMIN_ADDRESS}`)
  log.info(`RPC: ${RPC_URL}`)
  log.info(`Metadata: name="${TOKEN_NAME}", symbol="${TOKEN_SYMBOL}", decimals=${TOKEN_DECIMALS}`)

  const cmd =
    `stellar contract invoke --id ${TOKEN_CONTRACT_ID} ${sourceFlag} ` +
    `--network testnet --rpc-url ${RPC_URL} -- initialize ` +
    `--admin ${ADMIN_ADDRESS} --decimals ${TOKEN_DECIMALS} --name "${TOKEN_NAME}" --symbol "${TOKEN_SYMBOL}"`

  const { stdout, stderr } = await runCommand(cmd)
  const out = `${stdout}\n${stderr}`

  if (/already\s*initialized|Error\(Contract,\s*#1\)|AlreadyInitialized/i.test(out)) {
    log.warning("El contrato ya estaba inicializado. No se hicieron cambios.")
    process.exit(0)
  }

  if (stderr && !/success/i.test(stderr) && !stdout) {
    log.error(`Falló initialize: ${stderr}`)
    process.exit(1)
  }

  log.success("Token inicializado/configurado correctamente.")
  console.log(`${colors.cyan}Contract:${colors.reset} ${TOKEN_CONTRACT_ID}`)
  console.log(`${colors.cyan}Admin:${colors.reset}    ${ADMIN_ADDRESS}`)
  console.log(`${colors.cyan}Name:${colors.reset}     ${TOKEN_NAME}`)
  console.log(`${colors.cyan}Symbol:${colors.reset}   ${TOKEN_SYMBOL}`)
  console.log(`${colors.cyan}Decimals:${colors.reset} ${TOKEN_DECIMALS}`)
}

creatorPreflight({
  script: "setup_token.ts",
  plan: [
    "invoke initialize/metadata on the existing token contract (TOKEN_CONTRACT_ID or MOCK_TOKEN_ID)",
  ],
})

main().catch((e) => {
  log.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
