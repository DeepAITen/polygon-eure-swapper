#!/usr/bin/env node
require('dotenv').config();
const { ethers } = require('ethers');
const axios = require('axios');
const SwapperVault = require('./src/vault');
const config = require('./src/config');

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

const LIFI_API = 'https://li.quest/v1';

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { dryRun: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--from':
        parsed.from = args[++i];
        break;
      case '--to':
        parsed.to = args[++i];
        break;
      case '--amount':
        parsed.amount = args[++i];
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      default:
        console.error(`Unknown arg: ${args[i]}`);
        process.exit(1);
    }
  }

  if (!parsed.from || !parsed.to || !parsed.amount) {
    console.log('Usage: node swap.js --from USDT --to EURe --amount 10 [--dry-run]');
    process.exit(1);
  }

  return parsed;
}

async function main() {
  const parsed = parseArgs();

  const tokenInConfig = config.TOKENS[parsed.from];
  const tokenOutConfig = config.TOKENS[parsed.to];

  if (!tokenInConfig || !tokenOutConfig) {
    console.error('Token invalide. Disponibles: USDT, USDC, EURe');
    process.exit(1);
  }

  const vaultPassword = process.env.SWAPPER_VAULT_PASSWORD;
  if (!vaultPassword) {
    console.error('Set SWAPPER_VAULT_PASSWORD env var.');
    process.exit(1);
  }

  const vault = new SwapperVault(vaultPassword);
  const secrets = vault.load();
  const privateKey = secrets.wallet_private_key;

  const provider = new ethers.JsonRpcProvider(config.RPC_URL);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log(`Wallet:  ${wallet.address}`);
  console.log(`Swap:    ${parsed.amount} ${parsed.from} -> ${parsed.to}`);
  console.log(`Router:  LiFi (best route auto)`);
  console.log(`Mode:    ${parsed.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log('');

  const amountIn = ethers.parseUnits(parsed.amount, tokenInConfig.decimals);

  // Check balance
  const tokenInContract = new ethers.Contract(tokenInConfig.address, ERC20_ABI, provider);
  const balance = await tokenInContract.balanceOf(wallet.address);

  if (balance < amountIn) {
    const formatted = ethers.formatUnits(balance, tokenInConfig.decimals);
    console.error(`Insufficient ${parsed.from}: ${formatted} (need ${parsed.amount})`);
    process.exit(1);
  }

  console.log(`Balance ${parsed.from}: ${ethers.formatUnits(balance, tokenInConfig.decimals)}`);

  // Get quote from LiFi
  console.log('\nFetching quote from LiFi...');
  
  const quoteParams = {
    fromChain: config.CHAIN_ID.toString(),
    toChain: config.CHAIN_ID.toString(),
    fromToken: tokenInConfig.address,
    toToken: tokenOutConfig.address,
    fromAmount: amountIn.toString(),
    fromAddress: wallet.address,
    slippage: 0.005, // 0.5%
  };

  let quoteResponse;
  try {
    const response = await axios.get(`${LIFI_API}/quote`, { params: quoteParams });
    quoteResponse = response.data;
  } catch (error) {
    console.error('LiFi quote failed:', error.response?.data || error.message);
    process.exit(1);
  }

  const expectedOut = ethers.formatUnits(
    quoteResponse.estimate.toAmount,
    tokenOutConfig.decimals
  );

  console.log(`Quote:   ${parsed.amount} ${parsed.from} -> ${expectedOut} ${parsed.to}`);
  console.log(`Route:   ${quoteResponse.tool}`);
  console.log(`Gas:     ~${quoteResponse.estimate.gasCosts?.[0]?.estimate || 'unknown'}`);
  console.log('');

  if (parsed.dryRun) {
    console.log('--- DRY RUN ---');
    console.log('No transaction sent.');
    return;
  }

  // Check if approval needed
  const txRequest = quoteResponse.transactionRequest;
  
  if (txRequest.to !== tokenInConfig.address) {
    // Need to approve the LiFi contract
    const spender = txRequest.to;
    const allowance = await tokenInContract.allowance(wallet.address, spender);

    if (allowance < amountIn) {
      console.log(`Approving ${parsed.from} for ${spender}...`);
      const tokenWithSigner = tokenInContract.connect(wallet);
      const approveTx = await tokenWithSigner.approve(spender, ethers.MaxUint256);
      console.log(`Approve TX: ${approveTx.hash}`);
      await approveTx.wait();
      console.log('Approved!\n');
    }
  }

  // Execute swap
  console.log('Sending swap via LiFi...');
  
  const tx = await wallet.sendTransaction({
    to: txRequest.to,
    data: txRequest.data,
    value: txRequest.value || 0,
    gasLimit: txRequest.gasLimit || 500000,
  });

  console.log(`TX Hash: ${tx.hash}`);
  console.log('Waiting confirmation...');

  const receipt = await tx.wait();
  console.log(`Confirmed in block ${receipt.blockNumber}`);
  console.log(`Gas used: ${receipt.gasUsed.toString()}`);
  console.log('\n✅ Swap complete!');
}

main().catch((err) => {
  console.error('\nSwap failed:', err.message);
  process.exit(1);
});
