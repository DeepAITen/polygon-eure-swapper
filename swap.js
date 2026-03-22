#!/usr/bin/env node
const { ethers } = require('ethers');
const SwapperVault = require('./src/vault');
const config = require('./src/config');

// --- ABI fragments ---
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

const SWAP_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
];

const QUOTER_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
];

// --- Arg parsing ---
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { dryRun: false, feeTier: null };

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
      case '--fee':
        parsed.feeTier = parseInt(args[++i], 10);
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
Usage: node swap.js --from <TOKEN> --to <TOKEN> --amount <AMOUNT> [--dry-run] [--fee <FEE_TIER>]

Tokens: USDT, USDC, USDC.e, EURe

Examples:
  node swap.js --from USDC --to EURe --amount 100
  node swap.js --from EURe --to USDT --amount 50 --dry-run
  node swap.js --from USDT --to EURe --amount 200 --fee 3000
`);
}

// --- Find best fee tier ---
async function findBestFeeTier(quoter, tokenIn, tokenOut, amountIn) {
  const feeTiers = [
    config.FEE_TIERS.LOWEST,
    config.FEE_TIERS.LOW,
    config.FEE_TIERS.MEDIUM,
    config.FEE_TIERS.HIGH,
  ];

  let bestQuote = null;
  let bestFee = null;

  for (const fee of feeTiers) {
    try {
      const result = await quoter.quoteExactInputSingle.staticCall({
        tokenIn,
        tokenOut,
        amountIn,
        fee,
        sqrtPriceLimitX96: 0,
      });
      const amountOut = result[0];
      if (!bestQuote || amountOut > bestQuote) {
        bestQuote = amountOut;
        bestFee = fee;
      }
    } catch {
      // Pool doesn't exist for this fee tier
    }
  }

  if (!bestFee) {
    throw new Error('No liquidity pool found for this pair. Try a different token pair.');
  }

  return { fee: bestFee, expectedOut: bestQuote };
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

  // Get quote
  const quoter = new ethers.Contract(config.QUOTER_V2, QUOTER_ABI, provider);

  const feeTier = args.feeTier;
  let fee, expectedOut;

  if (feeTier) {
    // Use specified fee tier
    try {
      const result = await quoter.quoteExactInputSingle.staticCall({
        tokenIn: tokenInConfig.address,
        tokenOut: tokenOutConfig.address,
        amountIn,
        fee: feeTier,
        sqrtPriceLimitX96: 0,
      });
      fee = feeTier;
      expectedOut = result[0];
    } catch (err) {
      console.error(`No pool found for fee tier ${feeTier}. Try without --fee to auto-detect.`);
      process.exit(1);
    }
  } else {
    // Auto-detect best fee tier
    console.log('Finding best pool...');
    const best = await findBestFeeTier(quoter, tokenInConfig.address, tokenOutConfig.address, amountIn);
    fee = best.fee;
    expectedOut = best.expectedOut;
  }

  const expectedOutFormatted = ethers.formatUnits(expectedOut, tokenOutConfig.decimals);
  console.log(`Pool:    fee tier ${fee / 10000}%`);
  console.log(`Quote:   ${args.amount} ${args.from} -> ${expectedOutFormatted} ${args.to}`);

  // Slippage
  const slippageFactor = BigInt(10000 - config.SLIPPAGE_BPS);
  const amountOutMinimum = (expectedOut * slippageFactor) / 10000n;
  const minOutFormatted = ethers.formatUnits(amountOutMinimum, tokenOutConfig.decimals);
  console.log(`Min out: ${minOutFormatted} ${args.to} (${config.SLIPPAGE_BPS / 100}% slippage)`);

  // Gas estimate
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice;
  console.log(`Gas:     ${ethers.formatUnits(gasPrice, 'gwei')} gwei`);

  if (args.dryRun) {
    console.log('\n--- DRY RUN COMPLETE ---');
    console.log('No transaction was sent.');
    return;
  }

  // Approve if needed
  const router = new ethers.Contract(config.SWAP_ROUTER, SWAP_ROUTER_ABI, wallet);
  const allowance = await tokenInContract.allowance(wallet.address, config.SWAP_ROUTER);

  if (allowance < amountIn) {
    console.log('\nApproving router...');
    const approveTx = await tokenInContract.approve(config.SWAP_ROUTER, ethers.MaxUint256);
    console.log(`Approve tx: ${approveTx.hash}`);
    await approveTx.wait();
    console.log('Approved.');
  }

  // Execute swap
  console.log('\nExecuting swap...');
  const deadline = Math.floor(Date.now() / 1000) + config.DEADLINE_SECONDS;

  const swapTx = await router.exactInputSingle({
    tokenIn: tokenInConfig.address,
    tokenOut: tokenOutConfig.address,
    fee,
    recipient: wallet.address,
    amountIn,
    amountOutMinimum,
    sqrtPriceLimitX96: 0,
  });

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
