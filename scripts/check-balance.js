#!/usr/bin/env node
require('dotenv').config();
const { ethers } = require('ethers');
const SwapperVault = require('../src/vault');
const config = require('../src/config');

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

async function main() {
  const vaultPassword = process.env.SWAPPER_VAULT_PASSWORD;
  if (!vaultPassword) {
    console.error('Set SWAPPER_VAULT_PASSWORD env var.');
    process.exit(1);
  }

  const vault = new SwapperVault(vaultPassword);
  const secrets = vault.load();
  const walletAddress = secrets.wallet.address;

  const provider = new ethers.JsonRpcProvider(config.RPC_URL);

  console.log(`Wallet: ${walletAddress}\n`);

  // MATIC balance
  const maticBalance = await provider.getBalance(walletAddress);
  console.log(`  POL:    ${ethers.formatEther(maticBalance)}`);

  // Token balances
  for (const [name, token] of Object.entries(config.TOKENS)) {
    const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
    const balance = await contract.balanceOf(walletAddress);
    const formatted = ethers.formatUnits(balance, token.decimals);
    console.log(`  ${name.padEnd(7)} ${formatted}`);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
