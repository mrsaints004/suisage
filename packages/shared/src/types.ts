// ===== Trade Decision (from Claude API) =====

export type TradeAction = 'BUY' | 'SELL' | 'HOLD' | 'REBALANCE';
export type OrderType = 'MARKET' | 'LIMIT';
export type MarketCondition = 'BULLISH' | 'BEARISH' | 'SIDEWAYS' | 'VOLATILE' | 'UNKNOWN';

export interface TradeDecision {
  action: TradeAction;
  reasoning: string;
  confidence: number; // 0-100
  quantity: number; // in base asset units
  price: number; // target price
  orderType: OrderType;
  riskAssessment: string;
  marketCondition: MarketCondition;
  timestamp: number;
}

// ===== Market Data =====

export interface OrderbookLevel {
  price: number;
  quantity: number;
}

export interface MarketSnapshot {
  pool: string;
  baseAsset: string;
  quoteAsset: string;
  midPrice: number;
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadBps: number;
  bidDepth: number;
  askDepth: number;
  volume24h: number;
  timestamp: number;
}

// ===== Vault State =====

export interface VaultState {
  vaultId: string;
  balance: bigint; // MIST
  totalShares: bigint;
  deployedAmount: bigint;
  paused: boolean;
  totalValue: bigint; // balance + deployed
}

// ===== Walrus Reasoning Log =====

export interface ReasoningLog {
  version: string;
  agentId: string;
  timestamp: number;
  marketSnapshot: MarketSnapshot;
  vaultState: {
    balance: string;
    deployed: string;
    totalShares: string;
    totalValue: string;
  };
  decision: TradeDecision;
  executionResult?: ExecutionResult;
}

export interface ExecutionResult {
  success: boolean;
  txDigest?: string;
  filledQuantity?: number;
  filledPrice?: number;
  error?: string;
}

// ===== On-chain Events =====

export interface TradeRecordEvent {
  vaultId: string;
  agent: string;
  tradeType: number; // 0=BUY, 1=SELL, 2=REBALANCE
  amount: string;
  price: string;
  walrusBlobId: string;
  timestampMs: string;
}

export interface DepositEvent {
  vaultId: string;
  depositor: string;
  amount: string;
  sharesMinted: string;
  totalShares: string;
}

export interface WithdrawEvent {
  vaultId: string;
  withdrawer: string;
  amount: string;
  sharesBurned: string;
  totalShares: string;
}

// ===== Strategy Config (mirrors on-chain) =====

export interface StrategyConfig {
  maxPositionBps: number;
  stopLossBps: number;
  minTradeIntervalSec: number;
  maxOpenPositions: number;
  allowedPools: string[];
  active: boolean;
}
