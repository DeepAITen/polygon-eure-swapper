#!/usr/bin/env node
require('dotenv').config();
const { ethers } = require('ethers');
const SwapperVault = require('./src/vault');
const config = require('./src/config');

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

// Uniswap V3 SwapRouter
const UNISWAP_V3_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
const UNISWAP_V3_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
];

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
    console.log('Usage: node swap-direct.js --from USDT --to EURe --amount 10 [--dry-run]');
    process.exit(1);
  }

  return parsed;
}

async function main() {
  const args = parseArgs();

  const tokenInConfig = config.TOKENS[args.from];
  const tokenOutConfig = config.TOKENS[args.to];

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
  console.log(`Swap:    ${args.amount} ${args.from} -> ${args.to}`);
  console.log(`Mode:    ${args.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log('');

  const amountIn = ethers.parseUnits(args.amount, tokenInConfig.decimals);

  // Check balance
  const tokenInContract = new ethers.Contract(tokenInConfig.address, ERC20_ABI, provider);
  const balance = await tokenInContract.balanceOf(wallet.address);

  if (balance < amountIn) {
    const formatted = ethers.formatUnits(balance, tokenInConfig.decimals);
    console.error(`Insufficient ${args.from}: ${formatted} (need ${args.amount})`);
    process.exit(1);
  }

  console.log(`Balance ${args.from}: ${ethers.formatUnits(balance, tokenInConfig.decimals)}`);

  if (args.dryRun) {
    console.log('\n--- DRY RUN ---');
    console.log('No transaction sent.');
    return;
  }

  // Check allowance
  const allowance = await tokenInContract.allowance(wallet.address, UNISWAP_V3_ROUTER);

  if (allowance < amountIn) {
    console.log(`\nApproving ${args.from}...`);
    const tokenWithSigner = tokenInContract.connect(wallet);
    const approveTx = await tokenWithSigner.approve(UNISWAP_V3_ROUTER, ethers.MaxUint256);
    console.log(`Approve TX: ${approveTx.hash}`);
    await approveTx.wait();
    console.log('Approved!\n');
  }

  // Swap params
  const router = new ethers.Contract(UNISWAP_V3_ROUTER, UNISWAP_V3_ROUTER_ABI, wallet);

  const params = {
    tokenIn: tokenInConfig.address,
    tokenOut: tokenOutConfig.address,
    fee: 3000, // 0.3% fee tier
    recipient: wallet.address,
    deadline: Math.floor(Date.now() / 1000) + 300, // 5 min
    amountIn: amountIn,
    amountOutMinimum: 0, // No slippage protection for now (testing)
    sqrtPriceLimitX96: 0,
  };

  console.log('Sending swap...');
  const swapTx = await router.exactInputSingle(params);
  console.log(`TX Hash: ${swapTx.hash}`);
  console.log('Waiting confirmation...');

  const receipt = await swapTx.wait();
  console.log(`Confirmed in block ${receipt.blockNumber}`);
  console.log(`Gas used: ${receipt.gasUsed.toString()}`);
  console.log('\n✅ Swap complete!');
}

main().catch((err) => {
  console.error('\nSwap failed:', err.message);
  process.exit(1);
});
