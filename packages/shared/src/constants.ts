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

// DeepBook constants
export const DEEPBOOK_PACKAGE_ID = '0xdee9';

// Walrus endpoints (testnet)
export const WALRUS_AGGREGATOR_URL = 'https://aggregator.walrus-testnet.walrus.space';
export const WALRUS_PUBLISHER_URL = 'https://publisher.walrus-testnet.walrus.space';

// Reasoning log version
export const REASONING_LOG_VERSION = '1.0.0';
