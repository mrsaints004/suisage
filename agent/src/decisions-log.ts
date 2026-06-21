import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { TradeDecision, MarketSnapshot } from '@suisage/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Shared decisions log — written by agent, read by dashboard API
const LOG_DIR = path.resolve(__dirname, '../../.agent-decisions');
const LOG_FILE = path.join(LOG_DIR, 'decisions.json');
const MAX_ENTRIES = 50;

export interface DecisionEntry {
  timestamp: number;
  vaultId: string;
  action: string;
  confidence: number;
  quantity: number;
  price: number;
  reasoning: string;
  marketCondition: string;
  riskAssessment: string;
  midPrice: number;
  spreadBps: number;
  walrusBlobId: string;
  txDigest?: string;
  guardianApproved: boolean;
}

/**
 * Append a decision to the shared log file.
 * Dashboard reads this to display all decisions (including HOLDs).
 */
export function logDecision(
  decision: TradeDecision,
  market: MarketSnapshot,
  vaultId: string,
  walrusBlobId: string,
  guardianApproved: boolean,
  txDigest?: string,
): void {
  try {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }

    const entries = loadDecisions();

    entries.unshift({
      timestamp: Date.now(),
      vaultId,
      action: decision.action,
      confidence: decision.confidence,
      quantity: decision.quantity,
      price: decision.price,
      reasoning: decision.reasoning,
      marketCondition: decision.marketCondition,
      riskAssessment: decision.riskAssessment,
      midPrice: market.midPrice,
      spreadBps: market.spreadBps,
      walrusBlobId,
      txDigest,
      guardianApproved,
    });

    // Keep only recent entries
    const trimmed = entries.slice(0, MAX_ENTRIES);
    writeFileSync(LOG_FILE, JSON.stringify(trimmed, null, 2), 'utf-8');
  } catch (error) {
    console.warn('[DecisionsLog] Failed to write:', error);
  }
}

function loadDecisions(): DecisionEntry[] {
  try {
    if (!existsSync(LOG_FILE)) return [];
    const data = readFileSync(LOG_FILE, 'utf-8');
    return JSON.parse(data) as DecisionEntry[];
  } catch {
    return [];
  }
}
