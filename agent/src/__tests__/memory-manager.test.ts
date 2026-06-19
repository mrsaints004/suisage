/**
 * Tests for the memory manager — Walrus-backed learning system.
 */

import { describe, it, expect } from 'vitest';
import { formatMemoryForPrompt } from '../memory-manager.js';
import type { AgentMemory } from '@suisage/shared';

describe('Memory Manager', () => {
  it('should format empty memory correctly', () => {
    const memory: AgentMemory = {
      recentDecisions: [],
      performance: {
        totalTrades: 0,
        winRate: 0,
        avgConfidence: 0,
        avgPnlPerTrade: 0,
        totalPnl: 0,
        bestTrade: 0,
        worstTrade: 0,
        consecutiveHolds: 0,
      },
      patterns: [],
    };

    const result = formatMemoryForPrompt(memory);
    expect(result).toContain('AGENT MEMORY');
    expect(result).toContain('No completed trades yet');
  });

  it('should format performance stats correctly', () => {
    const memory: AgentMemory = {
      recentDecisions: [
        {
          blobId: 'blob1',
          timestamp: Date.now(),
          action: 'BUY',
          price: 3.5,
          quantity: 5,
          confidence: 75,
          marketCondition: 'BULLISH',
          outcome: 'PROFIT',
          pnl: 0.5,
        },
      ],
      performance: {
        totalTrades: 10,
        winRate: 0.65,
        avgConfidence: 72,
        avgPnlPerTrade: 0.15,
        totalPnl: 1.5,
        bestTrade: 0.8,
        worstTrade: -0.3,
        consecutiveHolds: 0,
      },
      patterns: [
        'Strong win rate (65%) — current strategy is working.',
        'Performs well in BULLISH markets.',
      ],
    };

    const result = formatMemoryForPrompt(memory);
    expect(result).toContain('10 trades');
    expect(result).toContain('65%');
    expect(result).toContain('1.5');
    expect(result).toContain('Learned patterns:');
    expect(result).toContain('Strong win rate');
    expect(result).toContain('Last 1 decisions:');
    expect(result).toContain('BUY');
  });

  it('should include recent decisions in formatted output', () => {
    const memory: AgentMemory = {
      recentDecisions: [
        {
          blobId: 'blob1',
          timestamp: Date.now() - 60000,
          action: 'BUY',
          price: 3.40,
          quantity: 5,
          confidence: 80,
          marketCondition: 'BULLISH',
          outcome: 'PROFIT',
          pnl: 0.5,
        },
        {
          blobId: 'blob2',
          timestamp: Date.now() - 30000,
          action: 'SELL',
          price: 3.50,
          quantity: 5,
          confidence: 70,
          marketCondition: 'BEARISH',
          outcome: 'PROFIT',
          pnl: 0.5,
        },
        {
          blobId: 'blob3',
          timestamp: Date.now(),
          action: 'HOLD',
          price: 0,
          quantity: 0,
          confidence: 40,
          marketCondition: 'SIDEWAYS',
          outcome: 'NEUTRAL',
          pnl: 0,
        },
      ],
      performance: {
        totalTrades: 2,
        winRate: 1.0,
        avgConfidence: 75,
        avgPnlPerTrade: 0.5,
        totalPnl: 1.0,
        bestTrade: 0.5,
        worstTrade: 0.5,
        consecutiveHolds: 1,
      },
      patterns: [],
    };

    const result = formatMemoryForPrompt(memory);
    expect(result).toContain('BUY');
    expect(result).toContain('SELL');
    expect(result).toContain('HOLD');
    expect(result).toContain('PROFIT');
  });
});
