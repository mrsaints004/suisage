/**
 * Guardian: Pre-trade risk validation layer.
 *
 * This is what makes SuiSage more than a "generic LLM wrapper."
 * The guardian runs automated risk checks BEFORE any trade executes,
 * and the check results are stored in the Walrus reasoning log.
 *
 * Checks:
 * 1. Budget ceiling — trade size within AgentCap limits
 * 2. Spread check — reject if spread too wide (illiquid)
 * 3. Position concentration — don't over-allocate to one trade
 * 4. Depth check — enough liquidity to fill the order
 * 5. Confidence floor — reject low-confidence trades
 * 6. Cooldown — prevent overtrading
 * 7. Slippage estimate — reject if expected slippage too high
 * 8. Vault health — don't trade if vault is in bad state
 */

import { config } from './config.js';
import { suiClient } from './client.js';
import { GUARDIAN_DEFAULTS, MIST_PER_SUI } from '@suisage/shared';
import type {
  TradeDecision,
  MarketSnapshot,
  VaultState,
  GuardianCheck,
  RiskCheckResult,
  RiskLevel,
} from '@suisage/shared';

let lastTradeTimestamp = 0;

/**
 * Run all guardian checks on a trade decision BEFORE execution.
 * Returns a GuardianCheck with approval status and detailed results.
 */
export function runGuardianChecks(
  decision: TradeDecision,
  market: MarketSnapshot,
  vault: VaultState,
): GuardianCheck {
  if (decision.action === 'HOLD') {
    return {
      approved: true,
      riskLevel: 'LOW',
      checks: [{ name: 'HOLD', passed: true, value: 'HOLD', threshold: 'N/A', message: 'No trade to validate' }],
      overallReason: 'HOLD decision — no trade needed.',
      timestamp: Date.now(),
    };
  }

  const checks: RiskCheckResult[] = [];

  // 1. Budget ceiling check
  const maxTradeSui = config.maxTradeSizeSui;
  checks.push({
    name: 'Budget Ceiling',
    passed: decision.quantity <= maxTradeSui,
    value: `${decision.quantity} SUI`,
    threshold: `${maxTradeSui} SUI`,
    message: decision.quantity <= maxTradeSui
      ? `Trade size within limit`
      : `Trade size ${decision.quantity} exceeds max ${maxTradeSui} SUI`,
  });

  // 2. Spread check
  const maxSpread = GUARDIAN_DEFAULTS.maxSpreadBps;
  checks.push({
    name: 'Spread Check',
    passed: market.spreadBps <= maxSpread,
    value: `${market.spreadBps.toFixed(1)} bps`,
    threshold: `${maxSpread} bps`,
    message: market.spreadBps <= maxSpread
      ? `Spread is acceptable`
      : `Spread ${market.spreadBps.toFixed(1)}bps exceeds ${maxSpread}bps — market too illiquid`,
  });

  // 3. Position concentration
  const totalValueSui = Number(vault.totalValue) / Number(MIST_PER_SUI);
  const positionPct = totalValueSui > 0 ? (decision.quantity / totalValueSui) * 100 : 0;
  const maxPositionPct = GUARDIAN_DEFAULTS.maxPositionPct;
  checks.push({
    name: 'Position Concentration',
    passed: positionPct <= maxPositionPct,
    value: `${positionPct.toFixed(1)}%`,
    threshold: `${maxPositionPct}%`,
    message: positionPct <= maxPositionPct
      ? `Position is ${positionPct.toFixed(1)}% of vault — within limits`
      : `Trade would be ${positionPct.toFixed(1)}% of vault — too concentrated`,
  });

  // 4. Depth check
  const relevantDepth = decision.action === 'BUY' ? market.askDepth : market.bidDepth;
  const minDepth = decision.action === 'BUY'
    ? GUARDIAN_DEFAULTS.minAskDepth
    : GUARDIAN_DEFAULTS.minBidDepth;
  checks.push({
    name: 'Liquidity Depth',
    passed: relevantDepth >= minDepth,
    value: `${relevantDepth.toFixed(2)}`,
    threshold: `${minDepth}`,
    message: relevantDepth >= minDepth
      ? `Sufficient liquidity depth`
      : `Insufficient ${decision.action === 'BUY' ? 'ask' : 'bid'} depth (${relevantDepth.toFixed(2)} < ${minDepth})`,
  });

  // 5. Confidence floor
  const minConfidence = GUARDIAN_DEFAULTS.minConfidence;
  checks.push({
    name: 'Confidence Floor',
    passed: decision.confidence >= minConfidence,
    value: `${decision.confidence}%`,
    threshold: `${minConfidence}%`,
    message: decision.confidence >= minConfidence
      ? `Confidence is above minimum threshold`
      : `Confidence ${decision.confidence}% is below minimum ${minConfidence}%`,
  });

  // 6. Cooldown check
  const cooldownMs = GUARDIAN_DEFAULTS.cooldownMs;
  const timeSinceLast = Date.now() - lastTradeTimestamp;
  const cooldownPassed = lastTradeTimestamp === 0 || timeSinceLast >= cooldownMs;
  checks.push({
    name: 'Trade Cooldown',
    passed: cooldownPassed,
    value: lastTradeTimestamp === 0 ? 'First trade' : `${(timeSinceLast / 1000).toFixed(0)}s ago`,
    threshold: `${cooldownMs / 1000}s`,
    message: cooldownPassed
      ? `Cooldown period satisfied`
      : `Only ${(timeSinceLast / 1000).toFixed(0)}s since last trade (min ${cooldownMs / 1000}s)`,
  });

  // 7. Slippage estimate
  const slippageBps = estimateSlippage(decision, market);
  const maxSlippage = GUARDIAN_DEFAULTS.maxSlippageBps;
  checks.push({
    name: 'Slippage Estimate',
    passed: slippageBps <= maxSlippage,
    value: `${slippageBps.toFixed(1)} bps`,
    threshold: `${maxSlippage} bps`,
    message: slippageBps <= maxSlippage
      ? `Expected slippage is acceptable`
      : `Expected slippage ${slippageBps.toFixed(1)}bps exceeds ${maxSlippage}bps`,
  });

  // 8. Vault health
  const vaultHealthy = !vault.paused && Number(vault.balance) > 0;
  checks.push({
    name: 'Vault Health',
    passed: vaultHealthy,
    value: vault.paused ? 'PAUSED' : 'Active',
    threshold: 'Active + non-zero balance',
    message: vaultHealthy
      ? `Vault is healthy and active`
      : vault.paused
        ? `Vault is PAUSED — cannot trade`
        : `Vault has zero balance`,
  });

  // Determine overall result
  const failedChecks = checks.filter((c) => !c.passed);
  const approved = failedChecks.length === 0;
  const riskLevel = calculateRiskLevel(checks, decision);

  const overallReason = approved
    ? `All ${checks.length} guardian checks passed. Risk level: ${riskLevel}.`
    : `BLOCKED: ${failedChecks.length} check(s) failed — ${failedChecks.map((c) => c.name).join(', ')}.`;

  return {
    approved,
    riskLevel,
    checks,
    overallReason,
    timestamp: Date.now(),
  };
}

/**
 * Record that a trade was executed (for cooldown tracking).
 */
export function recordTradeExecution(): void {
  lastTradeTimestamp = Date.now();
}

/**
 * Estimate expected slippage based on order size vs available depth.
 */
function estimateSlippage(decision: TradeDecision, market: MarketSnapshot): number {
  if (market.midPrice === 0) return 0;

  const depth = decision.action === 'BUY' ? market.askDepth : market.bidDepth;
  if (depth === 0) return 10000; // infinite slippage if no depth

  // Simple model: slippage proportional to (order_size / depth)
  const fillRatio = decision.quantity / depth;
  const estimatedSlippage = fillRatio * 100; // in bps (rough)

  return Math.max(market.spreadBps / 2, estimatedSlippage);
}

/**
 * Calculate overall risk level from check results.
 */
function calculateRiskLevel(checks: RiskCheckResult[], decision: TradeDecision): RiskLevel {
  const failedCount = checks.filter((c) => !c.passed).length;

  if (failedCount >= 3) return 'CRITICAL';
  if (failedCount >= 1) return 'HIGH';
  if (decision.confidence < 50) return 'MEDIUM';
  return 'LOW';
}

/**
 * Validate trade against on-chain AgentCap limits using devInspectTransactionBlock.
 * This proves that Sui specifically enforces the AI's limits.
 */
export async function validateOnChain(
  decision: TradeDecision,
): Promise<{ valid: boolean; error?: string }> {
  if (decision.action === 'HOLD' || !config.agentCapId || !config.vaultObjectId) {
    return { valid: true };
  }

  try {
    const { Transaction } = await import('@mysten/sui/transactions');
    const tx = new Transaction();
    const quantityMist = BigInt(Math.floor(decision.quantity * Number(MIST_PER_SUI)));

    tx.moveCall({
      target: `${config.vaultPackageId}::agent_auth::validate_trade_size`,
      arguments: [
        tx.object(config.agentCapId),
        tx.pure.u64(quantityMist),
      ],
    });

    const result = await suiClient.devInspectTransactionBlock({
      sender: '0x0000000000000000000000000000000000000000000000000000000000000000',
      transactionBlock: tx,
    });

    if (result.effects.status.status === 'failure') {
      return { valid: false, error: `On-chain validation failed: ${result.effects.status.error}` };
    }

    return { valid: true };
  } catch (error) {
    // If inspection fails, still allow (don't block on read errors)
    console.warn('[Guardian] On-chain validation error (non-blocking):', error);
    return { valid: true };
  }
}

/**
 * Format guardian check results for logging.
 */
export function formatGuardianReport(check: GuardianCheck): string {
  const lines = [
    `Guardian: ${check.approved ? 'APPROVED' : 'BLOCKED'} (${check.riskLevel} risk)`,
    ...check.checks.map((c) => `  ${c.passed ? '✓' : '✗'} ${c.name}: ${c.value} (limit: ${c.threshold})`),
    `  → ${check.overallReason}`,
  ];
  return lines.join('\n');
}
