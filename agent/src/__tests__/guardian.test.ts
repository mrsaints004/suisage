/**
 * Integration tests for the Guardian risk validation layer.
 *
 * Tests the TypeScript pre-flight checks (Layer 1).
 * Move on-chain enforcement (Layer 2) is tested in contracts/sources/agent_auth_tests.move.
 */

import { describe, it, expect } from 'vitest';
import { runGuardianChecks } from '../guardian.js';
import type { TradeDecision, MarketSnapshot, VaultState, OnChainConfig } from '@suisage/shared';

function makeMarket(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    pool: 'SUI/USDC',
    baseAsset: 'SUI',
    quoteAsset: 'USDC',
    midPrice: 3.50,
    bestBid: 3.49,
    bestAsk: 3.51,
    spread: 0.02,
    spreadBps: 5.7,
    bidDepth: 500,
    askDepth: 500,
    volume24h: 100000,
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeVault(overrides: Partial<VaultState> = {}): VaultState {
  return {
    vaultId: '0xvault',
    balance: 100_000_000_000n, // 100 SUI
    totalShares: 100_000_000_000n,
    deployedAmount: 0n,
    paused: false,
    totalValue: 100_000_000_000n,
    ...overrides,
  };
}

function makeDecision(overrides: Partial<TradeDecision> = {}): TradeDecision {
  return {
    action: 'BUY',
    reasoning: 'Test trade',
    confidence: 75,
    quantity: 5,
    price: 3.50,
    orderType: 'LIMIT',
    riskAssessment: 'Low risk test',
    marketCondition: 'BULLISH',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('Guardian TypeScript Layer', () => {
  it('should approve a valid trade within all limits', () => {
    const result = runGuardianChecks(makeDecision(), makeMarket(), makeVault());
    expect(result.approved).toBe(true);
    expect(result.riskLevel).toBe('LOW');
    expect(result.checks.every(c => c.passed)).toBe(true);
  });

  it('should always approve HOLD decisions', () => {
    const result = runGuardianChecks(
      makeDecision({ action: 'HOLD', quantity: 0, price: 0 }),
      makeMarket(),
      makeVault(),
    );
    expect(result.approved).toBe(true);
  });

  it('should block trades with too-wide spread', () => {
    const result = runGuardianChecks(
      makeDecision(),
      makeMarket({ spreadBps: 100 }), // over 50 bps limit
      makeVault(),
    );
    expect(result.approved).toBe(false);
    const spreadCheck = result.checks.find(c => c.name === 'Spread Check');
    expect(spreadCheck?.passed).toBe(false);
  });

  it('should block trades exceeding budget ceiling', () => {
    const result = runGuardianChecks(
      makeDecision({ quantity: 100 }), // over default 10 SUI max
      makeMarket(),
      makeVault(),
    );
    expect(result.approved).toBe(false);
    const budgetCheck = result.checks.find(c => c.name === 'Budget Ceiling');
    expect(budgetCheck?.passed).toBe(false);
  });

  it('should block trades with low confidence', () => {
    const result = runGuardianChecks(
      makeDecision({ confidence: 10 }), // below 30% minimum
      makeMarket(),
      makeVault(),
    );
    expect(result.approved).toBe(false);
    const confCheck = result.checks.find(c => c.name === 'Confidence Floor');
    expect(confCheck?.passed).toBe(false);
  });

  it('should block trades when vault is paused', () => {
    const result = runGuardianChecks(
      makeDecision(),
      makeMarket(),
      makeVault({ paused: true }),
    );
    expect(result.approved).toBe(false);
    const healthCheck = result.checks.find(c => c.name === 'Vault Health');
    expect(healthCheck?.passed).toBe(false);
  });

  it('should block trades with insufficient depth', () => {
    const result = runGuardianChecks(
      makeDecision({ action: 'BUY' }),
      makeMarket({ askDepth: 10 }), // below 100 minimum
      makeVault(),
    );
    expect(result.approved).toBe(false);
    const depthCheck = result.checks.find(c => c.name === 'Liquidity Depth');
    expect(depthCheck?.passed).toBe(false);
  });

  it('should block trades with excessive position concentration', () => {
    const result = runGuardianChecks(
      makeDecision({ quantity: 50 }), // 50% of 100 SUI vault, over 30% limit
      makeMarket(),
      makeVault(),
    );
    expect(result.approved).toBe(false);
    const posCheck = result.checks.find(c => c.name === 'Position Concentration');
    expect(posCheck?.passed).toBe(false);
  });

  it('should use on-chain AgentCap limits when available', () => {
    const onChainConfig: OnChainConfig = {
      agentCap: {
        agentCapId: '0xcap',
        vaultId: '0xvault',
        maxTradeSize: 5_000_000_000n, // 5 SUI on-chain limit
        maxDeploymentBps: 5000,
        active: true,
        lastTradeTimestampMs: 0,
        totalTrades: 0,
        totalVolume: 0n,
      },
    };

    // 7 SUI exceeds 5 SUI on-chain limit
    const result = runGuardianChecks(
      makeDecision({ quantity: 7 }),
      makeMarket(),
      makeVault(),
      onChainConfig,
    );
    expect(result.approved).toBe(false);
    const budgetCheck = result.checks.find(c => c.name === 'Budget Ceiling');
    expect(budgetCheck?.passed).toBe(false);
    expect(budgetCheck?.threshold).toContain('on-chain');
  });

  it('should block when agent cap is inactive', () => {
    const onChainConfig: OnChainConfig = {
      agentCap: {
        agentCapId: '0xcap',
        vaultId: '0xvault',
        maxTradeSize: 10_000_000_000n,
        maxDeploymentBps: 5000,
        active: false, // REVOKED
        lastTradeTimestampMs: 0,
        totalTrades: 0,
        totalVolume: 0n,
      },
    };

    const result = runGuardianChecks(
      makeDecision(),
      makeMarket(),
      makeVault(),
      onChainConfig,
    );
    expect(result.approved).toBe(false);
    expect(result.riskLevel).toBe('CRITICAL');
  });

  it('should block when strategy is inactive', () => {
    const onChainConfig: OnChainConfig = {
      strategyConfig: {
        strategyConfigId: '0xstrat',
        vaultId: '0xvault',
        maxPositionBps: 3000,
        stopLossBps: 500,
        minTradeIntervalSec: 30,
        maxOpenPositions: 3,
        allowedPools: [],
        active: false, // DISABLED
      },
    };

    const result = runGuardianChecks(
      makeDecision(),
      makeMarket(),
      makeVault(),
      onChainConfig,
    );
    expect(result.approved).toBe(false);
    expect(result.riskLevel).toBe('CRITICAL');
  });

  it('should return CRITICAL risk when 3+ checks fail', () => {
    const result = runGuardianChecks(
      makeDecision({ quantity: 100, confidence: 5 }), // budget + confidence fail
      makeMarket({ spreadBps: 200, askDepth: 1 }), // spread + depth fail
      makeVault(),
    );
    expect(result.approved).toBe(false);
    expect(result.riskLevel).toBe('CRITICAL');
  });

  it('should run all 8 checks', () => {
    const result = runGuardianChecks(makeDecision(), makeMarket(), makeVault());
    expect(result.checks.length).toBe(8);
    const checkNames = result.checks.map(c => c.name);
    expect(checkNames).toContain('Budget Ceiling');
    expect(checkNames).toContain('Spread Check');
    expect(checkNames).toContain('Position Concentration');
    expect(checkNames).toContain('Liquidity Depth');
    expect(checkNames).toContain('Confidence Floor');
    expect(checkNames).toContain('Trade Cooldown');
    expect(checkNames).toContain('Slippage Estimate');
    expect(checkNames).toContain('Vault Health');
  });
});
