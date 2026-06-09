// SUI units
export const MIST_PER_SUI = 1_000_000_000n;

// Trade type mapping (matches Move contract)
export const TRADE_TYPE = {
  BUY: 0,
  SELL: 1,
  REBALANCE: 2,
} as const;

// Default agent loop interval
export const DEFAULT_LOOP_INTERVAL_MS = 60_000;

// DeepBook V2 constants
export const DEEPBOOK_PACKAGE_ID = '0xdee9';
export const FLOAT_SCALING_FACTOR = 1_000_000_000n;

// DeepBook mainnet pool: SUI/wUSDC (low-fee, 0.02%)
export const DEEPBOOK_SUI_USDC_POOL = '0x4405b50d791fd3346754e8171aaab6bc2ed26c2c46efdd033c14b30ae507ac33';

// Coin types (mainnet)
export const SUI_COIN_TYPE = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
export const WUSDC_COIN_TYPE = '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN';

// Walrus endpoints (mainnet — override via env vars if mainnet unavailable)
export const WALRUS_AGGREGATOR_URL = 'https://aggregator.walrus.space';
export const WALRUS_PUBLISHER_URL = 'https://publisher.walrus.space';

// Reasoning log version (4.0: on-chain guardian, reasoning hash, performance fees)
export const REASONING_LOG_VERSION = '4.0.0';

// Guardian thresholds
export const GUARDIAN_DEFAULTS = {
  maxSpreadBps: 50,          // reject if spread > 50bps
  maxPositionPct: 30,        // max 30% of vault in one trade
  minBidDepth: 100,          // min depth to trade
  minAskDepth: 100,
  maxSlippageBps: 100,       // max 1% slippage
  minConfidence: 30,         // reject if AI confidence < 30%
  cooldownMs: 30_000,        // min 30s between trades
} as const;

// DeepBook Predict (testnet)
export const DEEPBOOK_PREDICT_PACKAGE_ID = '0x0'; // set after testnet deploy
export const DUSDC_COIN_TYPE = '0x0'; // dUSDC on testnet
