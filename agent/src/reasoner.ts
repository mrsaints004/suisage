import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import type { TradeDecision, MarketSnapshot, VaultState, AgentMemory } from '@suisage/shared';
import { MIST_PER_SUI } from '@suisage/shared';
import { formatMemoryForPrompt } from './memory-manager.js';

const anthropic = new Anthropic({
  apiKey: config.anthropicApiKey,
});

const SYSTEM_PROMPT = `You are SuiSage, an autonomous DeFi trading agent operating on the Sui blockchain.
You analyze market data and make trading decisions for a shared vault that holds SUI.
You trade SUI/wUSDC on DeepBook, Sui's native central limit orderbook.

CRITICAL: Your decisions are stored IMMUTABLY on Walrus and linked on-chain. Every reasoning
chain is publicly auditable. Be thorough, honest, and transparent in your reasoning.

You have MEMORY — your past decisions are retrieved from Walrus and provided below.
Learn from your past performance. If a pattern is losing money, adapt. If a strategy works, continue.

ARCHITECTURE (why Sui matters):
- Your budget ceiling is enforced by a Move AgentCap object on-chain — you literally cannot exceed it
- A Guardian risk layer validates every trade before execution (spread, depth, slippage, cooldown)
- All reasoning is stored on Walrus and referenced by blob ID in on-chain TradeRecordEvents
- The vault owner (AdminCap holder) can revoke your AgentCap at any time, instantly cutting your access
- This is NOT a generic chatbot — Sui Move enforces your constraints at the type level

RULES:
- You MUST respond with valid JSON matching the TradeDecision schema
- Be conservative: prefer HOLD when uncertain
- Never risk more than ${config.maxTradeSizeSui} SUI in a single trade (enforced on-chain)
- Consider spread, depth, and recent trade outcomes before trading
- Your confidence score should reflect actual conviction (0-100)
- A Guardian will validate your decision — if spread is too wide, depth too thin, or cooldown not met,
  your trade will be BLOCKED regardless of your decision
- Factor in your past performance: if you've been losing, be more conservative
- Explain your reasoning clearly — it will be permanently stored and publicly auditable

TradeDecision JSON schema:
{
  "action": "BUY" | "SELL" | "HOLD" | "REBALANCE",
  "reasoning": "detailed explanation of why this decision was made, referencing specific data points",
  "confidence": 0-100,
  "quantity": number (in SUI units, 0 for HOLD),
  "price": number (target price in USD, 0 for HOLD),
  "orderType": "MARKET" | "LIMIT",
  "riskAssessment": "honest assessment of what could go wrong",
  "marketCondition": "BULLISH" | "BEARISH" | "SIDEWAYS" | "VOLATILE" | "UNKNOWN"
}`;

export async function makeDecision(
  market: MarketSnapshot,
  vault: VaultState,
  recentDecisions: TradeDecision[] = [],
  memory?: AgentMemory,
  memwalContext?: string,
): Promise<TradeDecision> {
  const vaultBalanceSui = Number(vault.balance) / Number(MIST_PER_SUI);
  const deployedSui = Number(vault.deployedAmount) / Number(MIST_PER_SUI);
  const totalValueSui = Number(vault.totalValue) / Number(MIST_PER_SUI);

  // Build memory context from Walrus-backed history
  const memoryContext = memory ? formatMemoryForPrompt(memory) : 'No memory loaded yet — first cycle.';

  const userMessage = `Current market state (live from DeepBook orderbook):
- Pool: ${market.baseAsset}/${market.quoteAsset}
- Mid price: $${market.midPrice.toFixed(6)}
- Best bid: $${market.bestBid.toFixed(6)}
- Best ask: $${market.bestAsk.toFixed(6)}
- Spread: ${market.spreadBps.toFixed(1)} bps
- Bid depth: ${market.bidDepth.toFixed(2)} units
- Ask depth: ${market.askDepth.toFixed(2)} units
- Depth imbalance: ${market.bidDepth > 0 && market.askDepth > 0 ? ((market.bidDepth / market.askDepth) * 100).toFixed(1) + '% bid-heavy' : 'N/A'}

Vault state (from on-chain Vault object):
- Available balance: ${vaultBalanceSui.toFixed(4)} SUI
- Deployed to trading: ${deployedSui.toFixed(4)} SUI
- Total value: ${totalValueSui.toFixed(4)} SUI
- Total shares: ${vault.totalShares.toString()}
- Vault paused: ${vault.paused}

On-chain constraints (enforced by Move AgentCap):
- Max trade size: ${config.maxTradeSizeSui} SUI (Move-enforced ceiling)
- Max position: 30% of vault value

Guardian pre-checks that will validate your decision:
- Spread must be < 50 bps
- Depth must be > 100 units
- Cooldown: 30s between trades
- Slippage must be < 100 bps

${memoryContext}

${recentDecisions.length > 0 ? `Recent in-memory decisions (this session):\n${recentDecisions.slice(-5).map(d => `- ${d.action} ${d.quantity} @ $${d.price.toFixed(4)} (confidence: ${d.confidence}%, ${d.marketCondition})`).join('\n')}` : 'No in-session decisions yet.'}

${memwalContext ? `\n${memwalContext}\n` : ''}

Based on all of the above — market data, vault state, your past performance from Walrus memory, MemWal persistent memory (if available), and on-chain constraints — make a trading decision. Respond with ONLY the JSON object.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    // Parse the JSON response, handling potential markdown code blocks
    let jsonText = content.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const decision = JSON.parse(jsonText) as TradeDecision;
    decision.timestamp = Date.now();

    // Validate and clamp values
    decision.confidence = Math.max(0, Math.min(100, decision.confidence));
    decision.quantity = Math.max(0, Math.min(config.maxTradeSizeSui, decision.quantity));

    console.log(`[Reasoner] Decision: ${decision.action} | Confidence: ${decision.confidence}% | Qty: ${decision.quantity}`);
    return decision;
  } catch (error) {
    console.error('[Reasoner] Error making decision:', error);
    return {
      action: 'HOLD',
      reasoning: `Error during analysis: ${error instanceof Error ? error.message : 'unknown'}. Defaulting to HOLD for safety.`,
      confidence: 0,
      quantity: 0,
      price: 0,
      orderType: 'MARKET',
      riskAssessment: 'Error state - holding all positions',
      marketCondition: 'UNKNOWN',
      timestamp: Date.now(),
    };
  }
}
