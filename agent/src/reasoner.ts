import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import type { TradeDecision, MarketSnapshot, VaultState } from '@suisage/shared';
import { MIST_PER_SUI } from '@suisage/shared';

const anthropic = new Anthropic({
  apiKey: config.anthropicApiKey,
});

const SYSTEM_PROMPT = `You are SuiSage, an autonomous DeFi trading agent operating on the Sui blockchain.
You analyze market data and make trading decisions for a vault that holds SUI.

Your decisions are stored immutably on Walrus for public audit, so be thorough in your reasoning.

RULES:
- You MUST respond with valid JSON matching the TradeDecision schema
- Be conservative: prefer HOLD when uncertain
- Never risk more than 30% of vault value in a single trade
- Consider spread, depth, and volume before trading
- Your confidence score should reflect actual conviction (0-100)
- Explain your reasoning clearly - it will be publicly auditable

TradeDecision JSON schema:
{
  "action": "BUY" | "SELL" | "HOLD" | "REBALANCE",
  "reasoning": "detailed explanation of why this decision was made",
  "confidence": 0-100,
  "quantity": number (in SUI units, 0 for HOLD),
  "price": number (target price, 0 for HOLD),
  "orderType": "MARKET" | "LIMIT",
  "riskAssessment": "assessment of risks",
  "marketCondition": "BULLISH" | "BEARISH" | "SIDEWAYS" | "VOLATILE" | "UNKNOWN"
}`;

export async function makeDecision(
  market: MarketSnapshot,
  vault: VaultState,
  recentDecisions: TradeDecision[] = [],
): Promise<TradeDecision> {
  const vaultBalanceSui = Number(vault.balance) / Number(MIST_PER_SUI);
  const deployedSui = Number(vault.deployedAmount) / Number(MIST_PER_SUI);
  const totalValueSui = Number(vault.totalValue) / Number(MIST_PER_SUI);

  const userMessage = `Current market state:
- Pool: ${market.baseAsset}/${market.quoteAsset}
- Mid price: $${market.midPrice.toFixed(4)}
- Best bid: $${market.bestBid.toFixed(4)}
- Best ask: $${market.bestAsk.toFixed(4)}
- Spread: ${market.spreadBps.toFixed(1)} bps
- Bid depth: ${market.bidDepth.toFixed(0)} units
- Ask depth: ${market.askDepth.toFixed(0)} units
- 24h volume: $${market.volume24h.toFixed(0)}

Vault state:
- Available balance: ${vaultBalanceSui.toFixed(4)} SUI
- Deployed to trading: ${deployedSui.toFixed(4)} SUI
- Total value: ${totalValueSui.toFixed(4)} SUI
- Total shares: ${vault.totalShares.toString()}

Max trade size: ${config.maxTradeSizeSui} SUI

${recentDecisions.length > 0 ? `Recent decisions:\n${recentDecisions.slice(-3).map(d => `- ${d.action} ${d.quantity} @ $${d.price} (confidence: ${d.confidence})`).join('\n')}` : 'No recent decisions.'}

Analyze the market and make a trading decision. Respond with ONLY the JSON object.`;

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

    console.log(`[Reasoner] Decision: ${decision.action} | Confidence: ${decision.confidence} | Qty: ${decision.quantity}`);
    return decision;
  } catch (error) {
    console.error('[Reasoner] Error making decision:', error);
    // Return safe HOLD decision on error
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
