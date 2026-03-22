// Polygon Mainnet addresses
module.exports = {
  // Network
  CHAIN_ID: 137,
  RPC_URL: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',

  // Tokens on Polygon
  TOKENS: {
    USDC: {
      address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      decimals: 6,
      symbol: 'USDC',
    },
    USDT: {
      address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      decimals: 6,
      symbol: 'USDT',
    },
    EURe: {
      address: '0x18ec0A6E18E5bc3784fDd3a3634b31245ab704F6',
      decimals: 18,
      symbol: 'EURe',
    },
  },

  // QuickSwap Router V2 on Polygon
  QUICKSWAP_ROUTER: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff',

  // Wrapped MATIC (for intermediate routing if needed)
  WMATIC: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',

  // Swap settings
  SLIPPAGE_BPS: 50, // 0.5%
  DEADLINE_SECONDS: 300, // 5 minutes
};
