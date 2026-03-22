#!/usr/bin/env node
require('dotenv').config();
const readline = require('readline');
const SwapperVault = require('../src/vault');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stderr,
});

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  console.log('=== Polygon EURe Swapper - Vault Setup ===\n');

  const vaultPassword = process.env.SWAPPER_VAULT_PASSWORD;
  if (!vaultPassword) {
    console.error('Set SWAPPER_VAULT_PASSWORD env var first.');
    process.exit(1);
  }

  const vault = new SwapperVault(vaultPassword);

  const privateKey = await ask('Enter wallet private key (0x...): ');

  if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
    console.error('Invalid private key format. Must be 0x + 64 hex chars.');
    rl.close();
    process.exit(1);
  }

  const walletAddress = await ask('Enter wallet address (0x...): ');

  const secrets = {
    wallet: {
      privateKey,
      address: walletAddress,
      created: new Date().toISOString(),
    },
  };

  const vaultPath = vault.save(secrets);
  console.log(`\nVault saved: ${vaultPath}`);
  console.log('Private key is now encrypted. You can delete your shell history.');

  rl.close();
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
