#!/usr/bin/env node
require('dotenv').config();
const { ethers } = require('ethers');
const SwapperVault = require('./src/vault');
const config = require('./src/config');

// --- ABI fragments ---
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

const ROUTER_V2_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] calldata path) view returns (uint256[] memory amounts)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) returns (uint256[] memory amounts)',
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
Usage: node swap.js --from <TOKEN> --to <TOKEN> --amount <AMOUNT> [--dry-run]

Tokens: USDT, USDC, EURe

Examples:
  node swap.js --from USDC --to EURe --amount 100
  node swap.js --from EURe --to USDT --amount 50 --dry-run
  node swap.js --from USDT --to EURe --amount 200
`);
}

// --- Build swap path ---
function buildPath(tokenIn, tokenOut) {
  // Direct path first; if both are stablecoins (non-EURe), direct works.
  // For stablecoin <-> EURe, try direct. QuickSwap may route via WMATIC internally.
  return [tokenIn.address, tokenOut.address];
}

// --- Main ---
async function main() {
  const args = parseArgs();

  // Resolve tokens
  const tokenInConfig = config.TOKENS[args.from];
  const tokenOutConfig = config.TOKENS[args.to];

  if (!tokenInConfig) {
    console.error(`Unknown token: ${args.from}. Available: ${Object.keys(config.TOKENS).join(', ')}`);
    process.exit(1);
  }
  if (!tokenOutConfig) {
    console.error(`Unknown token: ${args.to}. Available: ${Object.keys(config.TOKENS).join(', ')}`);
    process.exit(1);
  }

  // Load wallet from vault
  const vaultPassword = process.env.SWAPPER_VAULT_PASSWORD;
  if (!vaultPassword) {
    console.error('Set SWAPPER_VAULT_PASSWORD env var.');
    process.exit(1);
  }

  const vault = new SwapperVault(vaultPassword);
  const secrets = vault.load();
  const privateKey = secrets.wallet.privateKey;

  // Connect
  const provider = new ethers.JsonRpcProvider(config.RPC_URL);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log(`Wallet:  ${wallet.address}`);
  console.log(`Swap:    ${args.amount} ${args.from} -> ${args.to}`);
  if (args.dryRun) console.log(`Mode:    DRY RUN (no tx will be sent)\n`);
  else console.log();

  // Parse amount
  const amountIn = ethers.parseUnits(args.amount, tokenInConfig.decimals);

  // Check balance
  const tokenInContract = new ethers.Contract(tokenInConfig.address, ERC20_ABI, wallet);
  const balance = await tokenInContract.balanceOf(wallet.address);
  if (balance < amountIn) {
    const balFormatted = ethers.formatUnits(balance, tokenInConfig.decimals);
    console.error(`Insufficient ${args.from} balance: ${balFormatted} (need ${args.amount})`);
    process.exit(1);
  }

  // Build path and get quote
  const router = new ethers.Contract(config.QUICKSWAP_ROUTER, ROUTER_V2_ABI, wallet);
  const path = buildPath(tokenInConfig, tokenOutConfig);

  let amounts;
  try {
    amounts = await router.getAmountsOut(amountIn, path);
  } catch {
    // Try routing via WMATIC if direct pair has no liquidity
    console.log('No direct pool, trying WMATIC route...');
    path.splice(1, 0, config.WMATIC);
    amounts = await router.getAmountsOut(amountIn, path);
  }

  const expectedOut = amounts[amounts.length - 1];
  const expectedOutFormatted = ethers.formatUnits(expectedOut, tokenOutConfig.decimals);
  console.log(`Quote:   ${args.amount} ${args.from} -> ${expectedOutFormatted} ${args.to}`);
  console.log(`Route:   ${path.length === 2 ? 'direct' : 'via WMATIC'}`);

  // Slippage
  const slippageFactor = BigInt(10000 - config.SLIPPAGE_BPS);
  const amountOutMinimum = (expectedOut * slippageFactor) / 10000n;
  const minOutFormatted = ethers.formatUnits(amountOutMinimum, tokenOutConfig.decimals);
  console.log(`Min out: ${minOutFormatted} ${args.to} (${config.SLIPPAGE_BPS / 100}% slippage)`);

  // Gas price
  const feeData = await provider.getFeeData();
  console.log(`Gas:     ${ethers.formatUnits(feeData.gasPrice, 'gwei')} gwei`);

  if (args.dryRun) {
    console.log('\n--- DRY RUN COMPLETE ---');
    console.log('No transaction was sent.');
    return;
  }

  // Approve if needed
  const allowance = await tokenInContract.allowance(wallet.address, config.QUICKSWAP_ROUTER);

  if (allowance < amountIn) {
    console.log('\nApproving router...');
    const approveTx = await tokenInContract.approve(config.QUICKSWAP_ROUTER, ethers.MaxUint256);
    console.log(`Approve tx: ${approveTx.hash}`);
    await approveTx.wait();
    console.log('Approved.');
  }

  // Execute swap
  console.log('\nExecuting swap...');
  const deadline = Math.floor(Date.now() / 1000) + config.DEADLINE_SECONDS;

  const swapTx = await router.swapExactTokensForTokens(
    amountIn,
    amountOutMinimum,
    path,
    wallet.address,
    deadline,
  );

  console.log(`Swap tx: ${swapTx.hash}`);
  console.log('Waiting for confirmation...');

  const receipt = await swapTx.wait();

  console.log(`\nSwap confirmed in block ${receipt.blockNumber}`);
  console.log(`Gas used: ${receipt.gasUsed.toString()}`);
  console.log(`Tx:  https://polygonscan.com/tx/${receipt.hash}`);

  // Show new balances
  const newBalIn = await tokenInContract.balanceOf(wallet.address);
  const tokenOutContract = new ethers.Contract(tokenOutConfig.address, ERC20_ABI, provider);
  const newBalOut = await tokenOutContract.balanceOf(wallet.address);

  console.log(`\nBalances after swap:`);
  console.log(`  ${args.from}: ${ethers.formatUnits(newBalIn, tokenInConfig.decimals)}`);
  console.log(`  ${args.to}:   ${ethers.formatUnits(newBalOut, tokenOutConfig.decimals)}`);
}

main().catch((err) => {
  console.error(`\nSwap failed: ${err.message}`);
  process.exit(1);
});
