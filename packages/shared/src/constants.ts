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

// DeepBook V3 constants
export const DEEPBOOK_PACKAGE_ID = '0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809';
export const FLOAT_SCALING_FACTOR = 1_000_000_000n;

// DeepBook V3 mainnet pool: SUI/USDC
export const DEEPBOOK_SUI_USDC_POOL = '0xe05dafb5133bcffb8d59f4e12465dc0e9faeaa05e3e342a08fe135800e3e4407';

// DeepBook V3 registry
export const DEEPBOOK_REGISTRY_ID = '0xaf16199a2dff736e9f07a845f23c5da6df6f756eddb631aed9d24a93efc4549d';

// Coin types (mainnet)
export const SUI_COIN_TYPE = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
export const USDC_COIN_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
export const DEEP_COIN_TYPE = '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP';

// Legacy alias (for backward compatibility in executor references)
export const WUSDC_COIN_TYPE = USDC_COIN_TYPE;

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
  minConfidence: 30,         // reject if confidence < 30%
  cooldownMs: 30_000,        // min 30s between trades
} as const;

// DeepBook Predict (testnet)
export const DEEPBOOK_PREDICT_PACKAGE_ID = '0x0'; // set after testnet deploy
export const DUSDC_COIN_TYPE = '0x0'; // dUSDC on testnet
