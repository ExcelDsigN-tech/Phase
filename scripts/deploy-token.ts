/**
 * Script de despliegue del Mock Token SEP-41
 *
 * Este script compila y despliega el contrato Mock Token a Testnet
 */

import {
  log,
  colors,
  runCommand,
  parseContractId,
  prompt,
  RPC_URL,
  TOKEN_DECIMALS,
  TOKEN_NAME,
  TOKEN_SYMBOL,
  TOKEN_ICON_PATH,
  TESTING_SECRET_KEY,
} from './utils.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { creatorPreflight } from "./creator-preflight.js"

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN_CONTRACT_PATH = path.join(__dirname, '../contracts/mock-token/target/wasm32-unknown-unknown/release/mock_token.wasm');
const OPTIMIZED_PATH = path.join(__dirname, '../contracts/mock-token/target/wasm32-unknown-unknown/release/mock_token.optimized.wasm');

async function main() {
  log.section('PHASE Protocol - Despliegue de Mock Token');

  // Check if wasm file exists
  if (!fs.existsSync(TOKEN_CONTRACT_PATH)) {
    log.error('Contrato WASM no encontrado. Compilando primero...');

    log.info('Ejecutando: cargo build --target wasm32-unknown-unknown --release');
    const { stderr } = await runCommand(
      'cd ../contracts/mock-token && cargo build --target wasm32-unknown-unknown --release'
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
    `stellar contract optimize --wasm "${TOKEN_CONTRACT_PATH}" --wasm-out "${OPTIMIZED_PATH}"`
  );

  if (optErr && !optErr.includes('Success')) {
    log.warning(`Optimización (continuando con versión no optimizada): ${optErr}`);
  } else {
    log.success('WASM optimizado');
  }

  // Get admin address
  const adminAddress = TESTING_SECRET_KEY 
    ? (await import('@stellar/stellar-sdk')).Keypair.fromSecret(TESTING_SECRET_KEY).publicKey()
    : process.env.FREIGHTER_PUBLIC_KEY || await prompt('Introduce tu dirección de Freighter (public key):');

  if (!adminAddress || adminAddress.length < 56) {
    log.error('Dirección inválida');
    process.exit(1);
  }

  // Deploy
  log.info(`Desplegando contrato a Testnet...`);
  log.info(`RPC: ${RPC_URL}`);
  log.info(`Admin: ${adminAddress}`);

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

  log.success(`Contrato desplegado!`);
  log.info(`Contract ID: ${colors.green}${contractId}${colors.reset}`);

  // Initialize token
  log.info('Inicializando token...');

  const initResult = await runCommand(
    `stellar contract invoke --id ${contractId} ${sourceFlag} --network testnet --rpc-url ${RPC_URL} -- initialize --admin ${adminAddress} --decimals ${TOKEN_DECIMALS} --name "${TOKEN_NAME}" --symbol "${TOKEN_SYMBOL}"`
  );

  if (initResult.stderr && !initResult.stderr.includes('Success')) {
    log.error(`Error de inicialización: ${initResult.stderr}`);
    process.exit(1);
  }

  log.success('Token inicializado correctamente');

  // Persist off-chain metadata profile used by frontend + stellar.toml
  const metadataPath = path.join(__dirname, '../public/phaser-liq.metadata.json');
  const tokenMetadata = {
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    icon: TOKEN_ICON_PATH,
    contract: contractId,
    network: 'testnet',
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(metadataPath, JSON.stringify(tokenMetadata, null, 2));
  log.success(`Metadata guardada en ${metadataPath}`);

  // Update .env file
  const envPath = path.join(__dirname, '.env');
  let envContent = '';

  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf-8');
    // Replace or add MOCK_TOKEN_ID
    if (envContent.includes('MOCK_TOKEN_ID=')) {
      envContent = envContent.replace(/MOCK_TOKEN_ID=.*/g, `MOCK_TOKEN_ID=${contractId}`);
    } else {
      envContent += `\nMOCK_TOKEN_ID=${contractId}`;
    }
    if (envContent.includes('TOKEN_NAME=')) {
      envContent = envContent.replace(/TOKEN_NAME=.*/g, `TOKEN_NAME="${TOKEN_NAME}"`);
    } else {
      envContent += `\nTOKEN_NAME="${TOKEN_NAME}"`;
    }
    if (envContent.includes('TOKEN_SYMBOL=')) {
      envContent = envContent.replace(/TOKEN_SYMBOL=.*/g, `TOKEN_SYMBOL="${TOKEN_SYMBOL}"`);
    } else {
      envContent += `\nTOKEN_SYMBOL="${TOKEN_SYMBOL}"`;
    }
    if (envContent.includes('TOKEN_ICON_PATH=')) {
      envContent = envContent.replace(/TOKEN_ICON_PATH=.*/g, `TOKEN_ICON_PATH="${TOKEN_ICON_PATH}"`);
    } else {
      envContent += `\nTOKEN_ICON_PATH="${TOKEN_ICON_PATH}"`;
    }
  } else {
    envContent = `MOCK_TOKEN_ID=${contractId}\nTOKEN_NAME="${TOKEN_NAME}"\nTOKEN_SYMBOL="${TOKEN_SYMBOL}"\nTOKEN_ICON_PATH="${TOKEN_ICON_PATH}"\n`;
  }

  fs.writeFileSync(envPath, envContent);
  log.success(`.env actualizado con MOCK_TOKEN_ID`);

  // Summary
  log.section('Resumen del Despliegue');
  console.log(`  Token Name:    ${TOKEN_NAME}`);
  console.log(`  Token Symbol:  ${TOKEN_SYMBOL}`);
  console.log(`  Token Icon:    ${TOKEN_ICON_PATH}`);
  console.log(`  Decimals:      ${TOKEN_DECIMALS}`);
  console.log(`  Admin:         ${adminAddress}`);
  console.log(`  Contract ID:   ${contractId}`);
  console.log(`  Network:       Testnet`);
  console.log(`  `);
  console.log(`  ${colors.yellow}Guarda este Contract ID, lo necesitarás para el despliegue de Phase Protocol${colors.reset}`);
}

creatorPreflight({
  script: "deploy-token.ts",
  plan: [
    "build contracts/mock-token",
    "stellar contract deploy it to testnet",
    "invoke initialize with TOKEN_DECIMALS, TOKEN_NAME and TOKEN_SYMBOL",
  ],
})

main().catch(console.error);
