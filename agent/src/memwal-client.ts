/**
 * MemWal Integration — Persistent, Verifiable Agent Memory on Walrus
 *
 * Uses the official MemWal SDK (@mysten-incubation/memwal) to give SuiSage
 * persistent, encrypted, semantically-searchable memory stored on Walrus.
 *
 * Features:
 * 1. REMEMBER — Store trade decisions, market patterns, and outcomes
 * 2. RECALL — Semantic search to find relevant past experiences
 * 3. CROSS-AGENT SHARING — Multiple SuiSage instances share memory via namespaces
 * 4. LEARNING LOOP — Agent queries its own history before each decision
 *
 * Namespaces:
 * - "trades" — Individual trade decisions and outcomes
 * - "patterns" — Discovered market patterns
 * - "shared" — Cross-agent shared intelligence (readable by all SuiSage instances)
 */

import { config } from './config.js';

// MemWal configuration from environment
const MEMWAL_DELEGATE_KEY = process.env.MEMWAL_DELEGATE_KEY || '';
const MEMWAL_ACCOUNT_ID = process.env.MEMWAL_ACCOUNT_ID || '';
const MEMWAL_SERVER_URL = process.env.MEMWAL_SERVER_URL || 'https://relayer.memory.walrus.xyz';

// Namespaces for memory organization
export const MEMORY_NAMESPACES = {
  TRADES: 'suisage-trades',
  PATTERNS: 'suisage-patterns',
  SHARED: 'suisage-shared', // Cross-agent shared namespace
} as const;

interface MemWalInstance {
  remember: (text: string, namespace?: string) => Promise<{ job_id: string; status: string }>;
  rememberAndWait: (text: string, namespace?: string) => Promise<{ id: string; blob_id: string }>;
  recall: (params: { query: string; limit?: number; namespace?: string }) => Promise<{ results: Array<{ blob_id: string; text: string; distance: number }>; total: number }>;
  health: () => Promise<{ status: string }>;
}

let memwalInstance: MemWalInstance | null = null;
let memwalEnabled = false;

/**
 * Initialize MemWal client. Call once at startup.
 */
export async function initMemWal(): Promise<boolean> {
  if (!MEMWAL_DELEGATE_KEY || !MEMWAL_ACCOUNT_ID) {
    console.log('[MemWal] Not configured (set MEMWAL_DELEGATE_KEY and MEMWAL_ACCOUNT_ID). Semantic memory disabled — agent will use Walrus blob memory only.');
    return false;
  }

  try {
    const { MemWal } = await import('@mysten-incubation/memwal');

    memwalInstance = MemWal.create({
      key: MEMWAL_DELEGATE_KEY,
      accountId: MEMWAL_ACCOUNT_ID,
      serverUrl: MEMWAL_SERVER_URL,
      namespace: MEMORY_NAMESPACES.TRADES,
    }) as MemWalInstance;

    // Health check
    const health = await memwalInstance.health();
    console.log(`[MemWal] Connected to relayer: ${health.status}`);
    memwalEnabled = true;
    return true;
  } catch (error) {
    console.warn('[MemWal] Initialization failed (non-fatal, semantic memory disabled):', error instanceof Error ? error.message : error);
    memwalEnabled = false;
    return false;
  }
}

/**
 * Check if MemWal is enabled and connected.
 */
export function isMemWalEnabled(): boolean {
  return memwalEnabled && memwalInstance !== null;
}

/**
 * Store a trade decision in MemWal with semantic embedding.
 * This enables future semantic recall ("what happened last time the spread was wide?").
 */
export async function rememberTrade(
  action: string,
  quantity: number,
  price: number,
  confidence: number,
  reasoning: string,
  marketCondition: string,
  outcome?: string,
): Promise<string | null> {
  if (!memwalInstance) return null;

  const memoryText = [
    `Trade Decision: ${action} ${quantity} SUI at $${price.toFixed(4)}`,
    `Confidence: ${confidence}%`,
    `Market condition: ${marketCondition}`,
    `Reasoning: ${reasoning}`,
    outcome ? `Outcome: ${outcome}` : '',
    `Timestamp: ${new Date().toISOString()}`,
  ].filter(Boolean).join('\n');

  try {
    const result = await memwalInstance.remember(memoryText, MEMORY_NAMESPACES.TRADES);
    console.log(`[MemWal] Trade remembered (job: ${result.job_id})`);
    return result.job_id;
  } catch (error) {
    console.warn('[MemWal] Failed to remember trade (non-fatal):', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Store a discovered market pattern in MemWal.
 */
export async function rememberPattern(pattern: string): Promise<string | null> {
  if (!memwalInstance) return null;

  try {
    const result = await memwalInstance.remember(pattern, MEMORY_NAMESPACES.PATTERNS);
    console.log(`[MemWal] Pattern remembered (job: ${result.job_id})`);
    return result.job_id;
  } catch (error) {
    console.warn('[MemWal] Failed to remember pattern (non-fatal):', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Share intelligence with other SuiSage agents via shared namespace.
 * Any SuiSage instance with access can recall shared memories.
 */
export async function shareWithAgents(intelligence: string): Promise<string | null> {
  if (!memwalInstance) return null;

  const sharedMemory = [
    `[Agent: ${config.suiNetwork}/${config.agentId || 'primary'}]`,
    intelligence,
    `Shared at: ${new Date().toISOString()}`,
  ].join('\n');

  try {
    const result = await memwalInstance.remember(sharedMemory, MEMORY_NAMESPACES.SHARED);
    console.log(`[MemWal] Shared with agent network (job: ${result.job_id})`);
    return result.job_id;
  } catch (error) {
    console.warn('[MemWal] Failed to share (non-fatal):', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Recall relevant past trades using semantic search.
 * E.g., "what happened when spread was over 30 bps?"
 */
export async function recallTrades(query: string, limit: number = 5): Promise<string[]> {
  if (!memwalInstance) return [];

  try {
    const result = await memwalInstance.recall({
      query,
      limit,
      namespace: MEMORY_NAMESPACES.TRADES,
    });

    console.log(`[MemWal] Recalled ${result.results.length} trade memories`);
    return result.results.map((r) => r.text);
  } catch (error) {
    console.warn('[MemWal] Failed to recall trades (non-fatal):', error instanceof Error ? error.message : error);
    return [];
  }
}

/**
 * Recall discovered patterns using semantic search.
 */
export async function recallPatterns(query: string, limit: number = 5): Promise<string[]> {
  if (!memwalInstance) return [];

  try {
    const result = await memwalInstance.recall({
      query,
      limit,
      namespace: MEMORY_NAMESPACES.PATTERNS,
    });

    console.log(`[MemWal] Recalled ${result.results.length} pattern memories`);
    return result.results.map((r) => r.text);
  } catch (error) {
    console.warn('[MemWal] Failed to recall patterns (non-fatal):', error instanceof Error ? error.message : error);
    return [];
  }
}

/**
 * Recall shared intelligence from other SuiSage agents.
 */
export async function recallSharedIntelligence(query: string, limit: number = 5): Promise<string[]> {
  if (!memwalInstance) return [];

  try {
    const result = await memwalInstance.recall({
      query,
      limit,
      namespace: MEMORY_NAMESPACES.SHARED,
    });

    console.log(`[MemWal] Recalled ${result.results.length} shared memories from agent network`);
    return result.results.map((r) => r.text);
  } catch (error) {
    console.warn('[MemWal] Failed to recall shared intelligence (non-fatal):', error instanceof Error ? error.message : error);
    return [];
  }
}

/**
 * Build a comprehensive memory context for the AI reasoner by querying
 * all MemWal namespaces with the current market context.
 */
export async function buildMemWalContext(
  currentPrice: number,
  spreadBps: number,
  marketCondition: string,
): Promise<string> {
  if (!memwalInstance) {
    return '[MemWal not configured — using local memory only]';
  }

  const parts: string[] = [];
  parts.push('=== MEMWAL PERSISTENT MEMORY (Walrus-backed, encrypted) ===');

  try {
    // Recall from all three namespaces in parallel for speed
    const marketQuery = `market condition ${marketCondition} price around $${currentPrice.toFixed(2)} spread ${spreadBps.toFixed(0)} bps`;
    const [similarTrades, patterns, shared] = await Promise.all([
      recallTrades(marketQuery, 3),
      recallPatterns(`${marketCondition} market trading pattern`, 3),
      recallSharedIntelligence(`${marketCondition} SUI USDC trading insights`, 2),
    ]);

    if (similarTrades.length > 0) {
      parts.push('\nSimilar past situations (semantic recall):');
      for (const trade of similarTrades) {
        parts.push(`  ${trade.substring(0, 200)}`);
      }
    }

    if (patterns.length > 0) {
      parts.push('\nRelevant learned patterns:');
      for (const pattern of patterns) {
        parts.push(`  ${pattern.substring(0, 200)}`);
      }
    }

    if (shared.length > 0) {
      parts.push('\nCross-agent shared intelligence:');
      for (const intel of shared) {
        parts.push(`  ${intel.substring(0, 200)}`);
      }
    }

    if (similarTrades.length === 0 && patterns.length === 0 && shared.length === 0) {
      parts.push('No relevant memories found for current conditions — building knowledge base.');
    }
  } catch (error) {
    parts.push(`Memory recall error (non-fatal): ${error instanceof Error ? error.message : 'unknown'}`);
  }

  parts.push('\n=== END MEMWAL MEMORY ===');
  return parts.join('\n');
}
