// Polygon Mainnet addresses
module.exports = {
  // Network
  CHAIN_ID: 137,
  RPC_URL: 'https://polygon-rpc.com',
  RPC_URL_FALLBACK: 'https://rpc-mainnet.maticvigil.com',

  // Tokens on Polygon
  TOKENS: {
    USDT: {
      address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      decimals: 6,
      symbol: 'USDT',
    },
    USDC: {
      address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // Native USDC
      decimals: 6,
      symbol: 'USDC',
    },
    'USDC.e': {
      address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // Bridged USDC.e
      decimals: 6,
      symbol: 'USDC.e',
    },
    EURe: {
      address: '0x18ec0A6E18E5bc3784fDd3a3669906d2bfC04b36',
      decimals: 18,
      symbol: 'EURe',
    },
  },

  // Uniswap V3 SwapRouter02 on Polygon
  SWAP_ROUTER: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',

  // Uniswap V3 Quoter V2 on Polygon
  QUOTER_V2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',

  // Pool fee tiers (in hundredths of a bip)
  FEE_TIERS: {
    LOWEST: 100,   // 0.01%
    LOW: 500,      // 0.05%
    MEDIUM: 3000,  // 0.3%
    HIGH: 10000,   // 1%
  },

  // Swap settings
  SLIPPAGE_BPS: 50, // 0.5%
  DEADLINE_SECONDS: 300, // 5 minutes
};
