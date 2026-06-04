/**
 * Walrus-backed memory layer for the SuiSage agent.
 *
 * The agent stores every decision on Walrus and reads back past decisions
 * to learn from its own history. This turns Walrus from "append-only logging"
 * into a genuine AI memory and learning system.
 *
 * Key features:
 * - Retrieves past reasoning logs from Walrus using on-chain blob ID references
 * - Computes performance stats (win rate, PnL, streaks)
 * - Extracts patterns from past trades for Claude to learn from
 * - Maintains a local index of blob IDs for fast retrieval
 */

import { suiClient } from './client.js';
import { config } from './config.js';
import { retrieveReasoning } from './walrus-logger.js';
import type {
  AgentMemory,
  MemoryEntry,
  PerformanceStats,
  ReasoningLog,
  TradeAction,
} from '@suisage/shared';

// Local memory index: maps blob IDs to memory entries
const memoryIndex: MemoryEntry[] = [];
let lastMemoryRefresh = 0;
const MEMORY_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * Load agent memory from Walrus by fetching past reasoning blobs
 * referenced in on-chain TradeRecordEvents.
 */
export async function loadMemory(): Promise<AgentMemory> {
  const now = Date.now();

  // Refresh from chain periodically
  if (now - lastMemoryRefresh > MEMORY_REFRESH_INTERVAL || memoryIndex.length === 0) {
    await refreshMemoryFromChain();
    lastMemoryRefresh = now;
  }

  // Compute performance stats
  const performance = computePerformance(memoryIndex);

  // Extract patterns
  const patterns = extractPatterns(memoryIndex);

  return {
    recentDecisions: memoryIndex.slice(-20), // last 20 decisions
    performance,
    patterns,
  };
}

/**
 * Add a new entry to the local memory index after storing on Walrus.
 */
export function addToMemory(entry: MemoryEntry): void {
  memoryIndex.push(entry);
  // Keep max 100 entries in memory
  if (memoryIndex.length > 100) {
    memoryIndex.splice(0, memoryIndex.length - 100);
  }
}

/**
 * Fetch past trade events from chain and retrieve their reasoning from Walrus.
 */
async function refreshMemoryFromChain(): Promise<void> {
  if (!config.vaultPackageId) return;

  try {
    const events = await suiClient.queryEvents({
      query: {
        MoveEventType: `${config.vaultPackageId}::agent_auth::TradeRecordEvent`,
      },
      limit: 30,
      order: 'descending',
    });

    if (events.data.length === 0) {
      console.log('[Memory] No past trade events found on-chain');
      return;
    }

    console.log(`[Memory] Found ${events.data.length} past trades on-chain, fetching from Walrus...`);

    // Only fetch blobs we don't already have
    const existingBlobIds = new Set(memoryIndex.map((e) => e.blobId));
    let newEntries = 0;

    for (const event of events.data) {
      const fields = event.parsedJson as Record<string, unknown>;
      const blobIdBytes = fields.walrus_blob_id as number[];
      const blobId = new TextDecoder().decode(new Uint8Array(blobIdBytes));

      if (existingBlobIds.has(blobId) || blobId.startsWith('error-')) continue;

      try {
        const log = await retrieveReasoning(blobId);
        if (log) {
          const entry = reasoningToMemoryEntry(blobId, log);
          memoryIndex.push(entry);
          existingBlobIds.add(blobId);
          newEntries++;
        }
      } catch {
        // Skip blobs that fail to load
      }
    }

    // Sort by timestamp
    memoryIndex.sort((a, b) => a.timestamp - b.timestamp);

    // Compute PnL for sequential buy/sell pairs
    computePnL(memoryIndex);

    if (newEntries > 0) {
      console.log(`[Memory] Loaded ${newEntries} new entries from Walrus (total: ${memoryIndex.length})`);
    }
  } catch (error) {
    console.error('[Memory] Failed to refresh from chain:', error);
  }
}

/**
 * Convert a Walrus reasoning log into a memory entry.
 */
function reasoningToMemoryEntry(blobId: string, log: ReasoningLog): MemoryEntry {
  return {
    blobId,
    timestamp: log.timestamp,
    action: log.decision.action,
    price: log.decision.price,
    quantity: log.decision.quantity,
    confidence: log.decision.confidence,
    marketCondition: log.decision.marketCondition,
    outcome: 'PENDING',
  };
}

/**
 * Compute PnL for buy/sell pairs retroactively.
 */
function computePnL(entries: MemoryEntry[]): void {
  let lastBuyPrice = 0;

  for (const entry of entries) {
    if (entry.action === 'BUY') {
      lastBuyPrice = entry.price;
      entry.outcome = 'PENDING';
    } else if (entry.action === 'SELL' && lastBuyPrice > 0) {
      const pnl = (entry.price - lastBuyPrice) * entry.quantity;
      entry.pnl = pnl;
      entry.outcome = pnl > 0 ? 'PROFIT' : pnl < 0 ? 'LOSS' : 'NEUTRAL';
      lastBuyPrice = 0;
    } else if (entry.action === 'HOLD') {
      entry.outcome = 'NEUTRAL';
      entry.pnl = 0;
    }
  }
}

/**
 * Compute aggregate performance statistics from memory.
 */
function computePerformance(entries: MemoryEntry[]): PerformanceStats {
  const trades = entries.filter((e) => e.action !== 'HOLD');
  const completedTrades = trades.filter((e) => e.outcome && e.outcome !== 'PENDING');
  const wins = completedTrades.filter((e) => e.outcome === 'PROFIT');

  const pnls = completedTrades.map((e) => e.pnl ?? 0);
  const totalPnl = pnls.reduce((sum, p) => sum + p, 0);
  const avgPnl = pnls.length > 0 ? totalPnl / pnls.length : 0;

  // Count consecutive holds at the end
  let consecutiveHolds = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].action === 'HOLD') consecutiveHolds++;
    else break;
  }

  return {
    totalTrades: trades.length,
    winRate: completedTrades.length > 0 ? wins.length / completedTrades.length : 0,
    avgConfidence: trades.length > 0
      ? trades.reduce((sum, t) => sum + t.confidence, 0) / trades.length
      : 0,
    avgPnlPerTrade: avgPnl,
    totalPnl,
    bestTrade: pnls.length > 0 ? Math.max(...pnls) : 0,
    worstTrade: pnls.length > 0 ? Math.min(...pnls) : 0,
    consecutiveHolds,
  };
}

/**
 * Extract behavioral patterns from past trades for Claude to learn from.
 */
function extractPatterns(entries: MemoryEntry[]): string[] {
  const patterns: string[] = [];

  if (entries.length < 3) {
    patterns.push('Insufficient trade history for pattern detection.');
    return patterns;
  }

  const trades = entries.filter((e) => e.action !== 'HOLD');
  const completedTrades = trades.filter((e) => e.pnl !== undefined);

  // Win rate pattern
  if (completedTrades.length >= 3) {
    const wins = completedTrades.filter((e) => e.outcome === 'PROFIT');
    const winRate = wins.length / completedTrades.length;
    if (winRate > 0.6) {
      patterns.push(`Strong win rate (${(winRate * 100).toFixed(0)}%) — current strategy is working.`);
    } else if (winRate < 0.4) {
      patterns.push(`Low win rate (${(winRate * 100).toFixed(0)}%) — consider being more selective or reducing position sizes.`);
    }
  }

  // High confidence accuracy
  const highConfTrades = completedTrades.filter((e) => e.confidence >= 70);
  if (highConfTrades.length >= 2) {
    const highConfWins = highConfTrades.filter((e) => e.outcome === 'PROFIT');
    const highConfWinRate = highConfWins.length / highConfTrades.length;
    if (highConfWinRate > 0.7) {
      patterns.push('High-confidence trades (70%+) are accurate — trust your strong convictions.');
    } else if (highConfWinRate < 0.4) {
      patterns.push('High-confidence trades are underperforming — recalibrate confidence scoring.');
    }
  }

  // Market condition performance
  const conditions = ['BULLISH', 'BEARISH', 'SIDEWAYS', 'VOLATILE'] as const;
  for (const cond of conditions) {
    const condTrades = completedTrades.filter((e) => e.marketCondition === cond);
    if (condTrades.length >= 2) {
      const avgPnl = condTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0) / condTrades.length;
      if (avgPnl > 0) {
        patterns.push(`Performs well in ${cond} markets (avg PnL: +${avgPnl.toFixed(4)} SUI).`);
      } else if (avgPnl < 0) {
        patterns.push(`Struggles in ${cond} markets (avg PnL: ${avgPnl.toFixed(4)} SUI) — consider holding during these conditions.`);
      }
    }
  }

  // Consecutive hold detection
  const lastEntries = entries.slice(-5);
  const recentHolds = lastEntries.filter((e) => e.action === 'HOLD').length;
  if (recentHolds >= 4) {
    patterns.push('Extended holding period detected — market may be too uncertain or parameters too tight.');
  }

  // Overtrading detection
  const lastHour = entries.filter((e) => Date.now() - e.timestamp < 3600000);
  if (lastHour.filter((e) => e.action !== 'HOLD').length > 10) {
    patterns.push('High trading frequency in the last hour — risk of overtrading and fee erosion.');
  }

  return patterns;
}

/**
 * Format memory context as a string for injection into Claude's prompt.
 */
export function formatMemoryForPrompt(memory: AgentMemory): string {
  const parts: string[] = [];

  parts.push('=== AGENT MEMORY (from Walrus) ===');

  // Performance summary
  const p = memory.performance;
  if (p.totalTrades > 0) {
    parts.push(`Performance: ${p.totalTrades} trades | Win rate: ${(p.winRate * 100).toFixed(0)}% | Total PnL: ${p.totalPnl.toFixed(4)} SUI`);
    parts.push(`Avg confidence: ${p.avgConfidence.toFixed(0)}% | Best: +${p.bestTrade.toFixed(4)} | Worst: ${p.worstTrade.toFixed(4)}`);
  } else {
    parts.push('No completed trades yet — this is early operation.');
  }

  // Patterns
  if (memory.patterns.length > 0) {
    parts.push('');
    parts.push('Learned patterns:');
    for (const pattern of memory.patterns) {
      parts.push(`  - ${pattern}`);
    }
  }

  // Recent decisions
  if (memory.recentDecisions.length > 0) {
    parts.push('');
    parts.push(`Last ${Math.min(5, memory.recentDecisions.length)} decisions:`);
    for (const d of memory.recentDecisions.slice(-5)) {
      const time = new Date(d.timestamp).toISOString().slice(11, 19);
      const outcomeStr = d.outcome ? ` → ${d.outcome}${d.pnl ? ` (${d.pnl > 0 ? '+' : ''}${d.pnl.toFixed(4)} SUI)` : ''}` : '';
      parts.push(`  [${time}] ${d.action} ${d.quantity} @ $${d.price.toFixed(4)} (${d.confidence}% conf, ${d.marketCondition})${outcomeStr}`);
    }
  }

  parts.push('=== END MEMORY ===');
  return parts.join('\n');
}
