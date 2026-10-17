/**
 * Script de despliegue del Phase Protocol
 *
 * Este script despliega el contrato PHASE a Testnet
 */

import { log, colors, runCommand, parseContractId, prompt, RPC_URL, REQUIRED_AMOUNT, TESTING_SECRET_KEY, getMockTokenId } from './utils.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { creatorPreflight } from "./creator-preflight.js"

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PHASE_CONTRACT_PATH = path.join(__dirname, '../contracts/phase-protocol/target/wasm32v1-none/release/phase_protocol.wasm');
const OPTIMIZED_PATH = path.join(__dirname, '../contracts/phase-protocol/target/wasm32v1-none/release/phase_protocol.optimized.wasm');

async function main() {
  log.section('PHASE Protocol - Despliegue del Contrato');

  // Check if wasm file exists
  if (!fs.existsSync(PHASE_CONTRACT_PATH)) {
    log.error('Contrato WASM no encontrado. Compilando primero...');

    log.info('Ejecutando: cargo build --target wasm32v1-none --release');
    const { stderr } = await runCommand(
      'cd ../contracts/phase-protocol && cargo build --target wasm32v1-none --release'
    );

    if (stderr && !stderr.includes('Compiling') && !stderr.includes('Finished')) {
      log.error(`Error de compilación: ${stderr}`);
      process.exit(1);
    }

    log.success('Compilación completada');
  }

  // Optimize
  log.info('Optimizando WASM...');
  const { stderr: optErr } = await runCommand(
    `stellar contract optimize --wasm "${PHASE_CONTRACT_PATH}" --wasm-out "${OPTIMIZED_PATH}"`
  );

  if (optErr && !optErr.includes('Success')) {
    log.warning(`Optimización (continuando con versión no optimizada): ${optErr}`);
  } else {
    log.success('WASM optimizado');
  }

  // Get admin address and token address
  const adminAddress = TESTING_SECRET_KEY 
    ? (await import('@stellar/stellar-sdk')).Keypair.fromSecret(TESTING_SECRET_KEY).publicKey()
    : process.env.FREIGHTER_PUBLIC_KEY || await prompt('Introduce tu dirección de Freighter (public key):');
  const tokenAddress = getMockTokenId() || await prompt('Introduce el MOCK_TOKEN_ID (del despliegue anterior):');

  if (!adminAddress || adminAddress.length < 56) {
    log.error('Dirección de admin inválida');
    process.exit(1);
  }

  if (!tokenAddress || tokenAddress.length < 56) {
    log.error('Contract ID del token inválido');
    process.exit(1);
  }

  // Deploy
  log.info(`Desplegando Phase Protocol a Testnet...`);
  log.info(`RPC: ${RPC_URL}`);
  log.info(`Admin: ${adminAddress}`);
  log.info(`Token: ${tokenAddress}`);
  log.info(`Required Amount: ${REQUIRED_AMOUNT} (${parseInt(REQUIRED_AMOUNT) / 10000000} tokens)`);

  const sourceFlag = TESTING_SECRET_KEY ? `--source deployer` : `--source ${adminAddress}`;
  const { stdout, stderr } = await runCommand(
    `stellar contract deploy --wasm "${OPTIMIZED_PATH}" ${sourceFlag} --network testnet --rpc-url ${RPC_URL}`
  );

  if (stderr && !stderr.includes('Success') && !stdout) {
    log.error(`Error de despliegue: ${stderr}`);
    process.exit(1);
  }

  // Parse contract ID
  const contractId = parseContractId(stdout + stderr);

  if (!contractId) {
    log.error('No se pudo obtener el Contract ID del output');
    console.log('Output:', stdout, stderr);
    process.exit(1);
  }

  log.success(`Phase Protocol desplegado!`);
  log.info(`Contract ID: ${colors.green}${contractId}${colors.reset}`);

  // Initialize protocol
  log.info('Inicializando Phase Protocol...');

  const initResult = await runCommand(
    `stellar contract invoke --id ${contractId} ${sourceFlag} --network testnet --rpc-url ${RPC_URL} -- initialize --admin ${adminAddress} --token_address ${tokenAddress} --required_amount ${REQUIRED_AMOUNT} --protocol_treasury ${adminAddress}`
  );

  if (initResult.stderr && !initResult.stderr.includes('Success')) {
    log.error(`Error de inicialización: ${initResult.stderr}`);
    process.exit(1);
  }

  log.success('Phase Protocol inicializado correctamente');

  // Update .env file
  const envPath = path.join(__dirname, '.env');
  let envContent = '';

  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf-8');
    // Replace or add PHASE_PROTOCOL_ID
    if (envContent.includes('PHASE_PROTOCOL_ID=')) {
      envContent = envContent.replace(/PHASE_PROTOCOL_ID=.*/g, `PHASE_PROTOCOL_ID=${contractId}`);
    } else {
      envContent += `\nPHASE_PROTOCOL_ID=${contractId}`;
    }
    // Update MOCK_TOKEN_ID if provided
    if (!envContent.includes('MOCK_TOKEN_ID=')) {
      envContent += `\nMOCK_TOKEN_ID=${tokenAddress}`;
    }
  } else {
    envContent = `PHASE_PROTOCOL_ID=${contractId}\nMOCK_TOKEN_ID=${tokenAddress}\n`;
  }

  fs.writeFileSync(envPath, envContent);
  log.success(`.env actualizado`);

  // Summary
  log.section('Resumen del Despliegue - PHASE Protocol');
  console.log(`  Admin:             ${adminAddress}`);
  console.log(`  Token Autorizado:  ${tokenAddress}`);
  console.log(`  Cantidad Requerida: ${REQUIRED_AMOUNT} (${parseInt(REQUIRED_AMOUNT) / 10000000} tokens)`);
  console.log(`  Phase Protocol ID: ${contractId}`);
  console.log(`  Network:           Testnet`);
  console.log(`  `);
  console.log(`  ${colors.yellow}¡Ambos contratos listos para interactuar!${colors.reset}`);
  console.log(`  ${colors.cyan}Ejecuta: npm run interact${colors.reset}`);
}

creatorPreflight({
  script: "deploy-phase.ts",
  plan: [
    "build and optimize contracts/phase-protocol (wasm32v1-none)",
    "stellar contract deploy it to testnet",
    "invoke initialize with the TESTING_SECRET_KEY address, MOCK_TOKEN_ID and REQUIRED_AMOUNT",
  ],
})

main().catch(console.error);
