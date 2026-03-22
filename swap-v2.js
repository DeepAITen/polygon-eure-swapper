#!/usr/bin/env node
require('dotenv').config();
const { ethers } = require('ethers');
const SwapperVault = require('./src/vault');
const config = require('./src/config');
const OneInchSwapper = require('./src/oneinch');

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

// --- Arg parsing ---
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
        printUsage();
        process.exit(1);
    }
  }

  if (!parsed.from || !parsed.to || !parsed.amount) {
    printUsage();
    process.exit(1);
  }

  return parsed;
}

function printUsage() {
  console.log(`
Usage: node swap-v2.js --from <TOKEN> --to <TOKEN> --amount <AMOUNT> [--dry-run]

Tokens: USDT, USDC, EURe

Examples:
  node swap-v2.js --from USDC --to EURe --amount 100
  node swap-v2.js --from EURe --to USDT --amount 50 --dry-run
  node swap-v2.js --from USDT --to EURe --amount 200
`);
}

// --- Main ---
async function main() {
  const args = parseArgs();

  // Resolve tokens
  const tokenInConfig = config.TOKENS[args.from];
  const tokenOutConfig = config.TOKENS[args.to];

  if (!tokenInConfig || !tokenOutConfig) {
    console.error(`Unknown token. Available: USDT, USDC, EURe`);
    process.exit(1);
  }

  if (args.from === args.to) {
    console.error('Cannot swap the same token');
    process.exit(1);
  }

  // Load vault
  const vaultPassword = process.env.SWAPPER_VAULT_PASSWORD;
  if (!vaultPassword) {
    console.error('Set SWAPPER_VAULT_PASSWORD env var.');
    process.exit(1);
  }

  const vault = new SwapperVault(vaultPassword);
  const secrets = vault.load();
  const privateKey = secrets.wallet_private_key;

  // Connect
  const provider = new ethers.JsonRpcProvider(config.RPC_URL);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log(`Wallet:  ${wallet.address}`);
  console.log(`Swap:    ${args.amount} ${args.from} -> ${args.to}`);
  console.log(`Mode:    ${args.dryRun ? 'DRY RUN (no tx will be sent)' : 'LIVE SWAP'}`);
  console.log('');

  // Amount in wei
  const amountIn = ethers.parseUnits(args.amount, tokenInConfig.decimals);

  // Check balance
  const tokenInContract = new ethers.Contract(tokenInConfig.address, ERC20_ABI, provider);
  const balance = await tokenInContract.balanceOf(wallet.address);

  if (balance < amountIn) {
    const formatted = ethers.formatUnits(balance, tokenInConfig.decimals);
    console.error(`Insufficient ${args.from} balance: ${formatted} (need ${args.amount})`);
    process.exit(1);
  }

  // 1inch setup
  const oneInch = new OneInchSwapper(process.env.ONEINCH_API_KEY); // Optional API key

  // Get quote
  console.log('Getting quote from 1inch...');
  const quote = await oneInch.getQuote(
    tokenInConfig.address,
    tokenOutConfig.address,
    amountIn
  );

  const expectedOut = ethers.formatUnits(quote.dstAmount, tokenOutConfig.decimals);
  console.log(`Quote:   ${args.amount} ${args.from} -> ${expectedOut} ${args.to}`);
  console.log(`Gas:     ~${quote.estimatedGas}`);
  console.log('');

  if (args.dryRun) {
    console.log('--- DRY RUN COMPLETE ---');
    console.log('No transaction was sent.');
    return;
  }

  // Check allowance
  const ONEINCH_ROUTER = '0x111111125421cA6dc452d289314280a0f8842A65'; // 1inch v6 router
  const allowance = await tokenInContract.allowance(wallet.address, ONEINCH_ROUTER);

  if (allowance < amountIn) {
    console.log(`Approving ${args.from} for 1inch router...`);
    const tokenInWithSigner = tokenInContract.connect(wallet);
    const approveTx = await tokenInWithSigner.approve(ONEINCH_ROUTER, ethers.MaxUint256);
    console.log(`Approve TX: ${approveTx.hash}`);
    await approveTx.wait();
    console.log('Approved!\n');
  }

  // Get swap data
  console.log('Building swap transaction...');
  const swapData = await oneInch.getSwapData(
    tokenInConfig.address,
    tokenOutConfig.address,
    amountIn,
    wallet.address,
    0.5 // 0.5% slippage
  );

  // Execute swap
  console.log('Sending swap transaction...');
  const tx = await wallet.sendTransaction({
    to: swapData.to,
    data: swapData.data,
    value: swapData.value,
    gasLimit: BigInt(swapData.gas) + 50000n, // Add buffer
  });

  console.log(`TX Hash: ${tx.hash}`);
  console.log('Waiting for confirmation...');

  const receipt = await tx.wait();
  console.log(`Confirmed in block ${receipt.blockNumber}`);
  console.log('');

  const outAmount = ethers.formatUnits(swapData.dstAmount, tokenOutConfig.decimals);
  console.log(`✅ Swap complete: ${args.amount} ${args.from} -> ${outAmount} ${args.to}`);
  console.log(`Gas used: ${receipt.gasUsed.toString()}`);
}

main().catch((err) => {
  console.error('\nSwap failed:', err.message);
  process.exit(1);
});
