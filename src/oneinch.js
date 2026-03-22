const axios = require('axios');
const config = require('./config');

const ONEINCH_API = 'https://api.1inch.io/v5.0/137'; // Polygon chainId (v5 public)

class OneInchSwapper {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  }

  async getQuote(tokenIn, tokenOut, amount) {
    try {
      const response = await axios.get(`${ONEINCH_API}/quote`, {
        headers: this.headers,
        params: {
          fromTokenAddress: tokenIn,
          toTokenAddress: tokenOut,
          amount: amount.toString(),
        },
      });

      return {
        dstAmount: response.data.toTokenAmount || response.data.toAmount,
        estimatedGas: response.data.estimatedGas || 300000,
      };
    } catch (error) {
      throw new Error(`1inch quote failed: ${error.response?.data?.description || error.message}`);
    }
  }

  async getSwapData(tokenIn, tokenOut, amount, fromAddress, slippage = 0.5) {
    try {
      const response = await axios.get(`${ONEINCH_API}/swap`, {
        headers: this.headers,
        params: {
          fromTokenAddress: tokenIn,
          toTokenAddress: tokenOut,
          amount: amount.toString(),
          fromAddress: fromAddress,
          slippage: slippage,
          disableEstimate: true,
        },
      });

      return {
        to: response.data.tx.to,
        data: response.data.tx.data,
        value: response.data.tx.value || '0',
        gas: response.data.tx.gas,
        dstAmount: response.data.toTokenAmount || response.data.toAmount,
      };
    } catch (error) {
      throw new Error(`1inch swap failed: ${error.response?.data?.description || error.message}`);
    }
  }
}

module.exports = OneInchSwapper;
