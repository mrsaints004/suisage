// ===== Trade Decision =====

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
  // Performance tracking
  performanceFeeBps?: number;
  highWaterMark?: bigint;
  accruedFees?: bigint;
  totalProfit?: bigint;
  totalLoss?: bigint;
  navPerShare?: bigint;
  profitEvents?: number;
}

// ===== Guardian Risk Check =====

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface GuardianCheck {
  approved: boolean;
  riskLevel: RiskLevel;
  checks: RiskCheckResult[];
  overallReason: string;
  timestamp: number;
}

export interface RiskCheckResult {
  name: string;
  passed: boolean;
  value: string;
  threshold: string;
  message: string;
}

// ===== Agent Memory (Walrus-backed) =====

export interface AgentMemory {
  /** Last N reasoning logs retrieved from Walrus */
  recentDecisions: MemoryEntry[];
  /** Aggregated performance stats */
  performance: PerformanceStats;
  /** Patterns the agent has observed */
  patterns: string[];
}

export interface MemoryEntry {
  blobId: string;
  timestamp: number;
  action: TradeAction;
  price: number;
  quantity: number;
  confidence: number;
  marketCondition: MarketCondition;
  outcome?: 'PROFIT' | 'LOSS' | 'NEUTRAL' | 'PENDING';
  pnl?: number;
}

export interface PerformanceStats {
  totalTrades: number;
  winRate: number; // 0-1
  avgConfidence: number;
  avgPnlPerTrade: number;
  totalPnl: number;
  bestTrade: number;
  worstTrade: number;
  consecutiveHolds: number;
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
  guardianCheck?: GuardianCheck;
  memoryContext?: {
    recentTradeCount: number;
    winRate: number;
    patterns: string[];
    lastAction: TradeAction | null;
  };
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
  reasoningHash: string;
  timestampMs: string;
  guardianApproved: boolean;
  confidence: number;
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

export interface PerformanceEvent {
  vaultId: string;
  profit: string;
  feeTaken: string;
  newHighWaterMark: string;
  navPerShare: string;
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

// ===== On-chain AgentCap state (read from chain each cycle) =====

export interface AgentCapState {
  agentCapId: string;
  vaultId: string;
  maxTradeSize: bigint; // in MIST
  maxDeploymentBps: number;
  active: boolean;
  lastTradeTimestampMs: number;
  totalTrades: number;
  totalVolume: bigint;
}

// ===== On-chain StrategyConfig state (read from chain each cycle) =====

export interface StrategyConfigState {
  strategyConfigId: string;
  vaultId: string;
  maxPositionBps: number;
  stopLossBps: number;
  minTradeIntervalSec: number;
  maxOpenPositions: number;
  allowedPools: string[];
  active: boolean;
}

// ===== Combined on-chain config for guardian =====

export interface OnChainConfig {
  agentCap?: AgentCapState;
  strategyConfig?: StrategyConfigState;
}

// ===== Multi-vault discovery =====

export interface ManagedVault {
  vaultId: string;
  agentCapId: string;
  strategyConfigId: string | null;
}

// ===== DeepBook Predict =====

export interface PredictPosition {
  marketId: string;
  direction: 'UP' | 'DOWN';
  amount: number;
  entryPrice: number;
  expiryMs: number;
  settled: boolean;
  payout?: number;
}

export interface PredictMarket {
  marketId: string;
  oraclePrice: number;
  strikePrice: number;
  expiryMs: number;
  totalYes: number;
  totalNo: number;
  impliedProb: number;
}
