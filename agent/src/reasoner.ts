import Groq from 'groq-sdk';
import { config } from './config.js';
import type { TradeDecision, MarketSnapshot, VaultState, AgentMemory } from '@suisage/shared';
import { MIST_PER_SUI } from '@suisage/shared';
import { formatMemoryForPrompt } from './memory-manager.js';

const groq = new Groq({ apiKey: config.groqApiKey });

const SYSTEM_PROMPT = `You are SuiSage, an autonomous DeFi trading agent operating on the Sui blockchain.
You analyze market data and make trading decisions for a shared vault that holds SUI.
You trade SUI/USDC on DeepBook V3, Sui's native central limit orderbook.

IMPORTANT: The vault holds SUI. Your trading actions are:
- SELL: Sell SUI from the vault for USDC (when you think SUI price will drop)
- HOLD: Keep the current position (when uncertain)
- REBALANCE: Adjust position size
Do NOT use BUY — the vault already holds SUI. If you're bullish on SUI, HOLD it.

CRITICAL: Your decisions are stored IMMUTABLY on Walrus and linked on-chain. Every reasoning
chain is publicly auditable. Be thorough, honest, and transparent in your reasoning.

You have MEMORY — your past decisions are retrieved from Walrus and provided below.
Learn from your past performance. If a pattern is losing money, adapt. If a strategy works, continue.

ARCHITECTURE (why Sui matters):
- Your budget ceiling is enforced by a Move AgentCap object on-chain — you literally cannot exceed it
- DUAL-LAYER GUARDIAN: TypeScript pre-flight checks (8 checks) AND Move on-chain enforcement (7 checks)
- On-chain Move enforcement includes: trade size limit, cooldown via Clock, position concentration, deployment limit
- Even if TypeScript checks are bypassed, the Move contract will abort the transaction
- A SHA-256 hash of your full reasoning JSON is committed on-chain — anyone can verify it
- All reasoning is stored on Walrus and referenced by blob ID in on-chain TradeRecordEvents
- The vault owner (AdminCap holder) can revoke your AgentCap at any time, instantly cutting your access
- Performance fees: 10% of profits above high-water mark NAV, tracked on-chain

RULES:
- You MUST respond with valid JSON matching the TradeDecision schema
- Be active: analyze market conditions and trade when you see an opportunity. Small balances are fine — trade proportionally.
- Never risk more than ${config.maxTradeSizeSui} SUI in a single trade (enforced on-chain by Move)
- Consider spread, depth, and recent trade outcomes before trading
- Your confidence score should reflect actual conviction (0-100)
- A Guardian will validate your decision — if spread is too wide, depth too thin, or cooldown not met,
  your trade will be BLOCKED regardless of your decision
- Cooldown is enforced on-chain using sui::clock::Clock — the contract checks elapsed time
- Position concentration is enforced on-chain — the contract checks against StrategyConfig.max_position_bps
- Factor in your past performance: if you've been losing, be more conservative
- Explain your reasoning clearly — it will be permanently stored on Walrus and hash-verified on-chain

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

On-chain constraints (enforced by Move smart contracts):
- Max trade size: ${config.maxTradeSizeSui} SUI (Move-enforced in withdraw_for_trading)
- Max position: 30% of vault value (Move-enforced via StrategyConfig)
- Cooldown: enforced via sui::clock::Clock in Move — contract checks elapsed time
- Deployment limit: enforced in Move — total deployed cannot exceed max_deployment_bps

Guardian pre-checks (TypeScript layer — runs before transaction):
- Spread must be < 50 bps
- Depth must be > 100 units
- Slippage must be < 100 bps
- Confidence must be >= 30%
- Vault must be active with non-zero balance

${memoryContext}

${recentDecisions.length > 0 ? `Recent in-memory decisions (this session):\n${recentDecisions.slice(-5).map(d => `- ${d.action} ${d.quantity} @ $${d.price.toFixed(4)} (confidence: ${d.confidence}%, ${d.marketCondition})`).join('\n')}` : 'No in-session decisions yet.'}

${memwalContext ? `\n${memwalContext}\n` : ''}

Based on all of the above — market data, vault state, your past performance from Walrus memory, MemWal persistent memory (if available), and on-chain constraints — make a trading decision. Respond with ONLY the JSON object.`;

  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      max_tokens: 512,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.3,
    });

    const text = (response.choices[0]?.message?.content ?? '').trim();

    // Parse the JSON response, handling potential markdown code blocks
    let jsonText = text;
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
