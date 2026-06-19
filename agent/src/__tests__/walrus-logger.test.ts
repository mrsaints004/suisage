/**
 * Tests for Walrus logger retry logic and local fallback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReasoningLog } from '@suisage/shared';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock fs
vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn(),
}));

// Mock config
vi.mock('../config.js', () => ({
  config: {
    walrusPublisherUrl: 'https://publisher.test.walrus.space',
    walrusAggregatorUrl: 'https://aggregator.test.walrus.space',
  },
}));

function makeReasoningLog(): ReasoningLog {
  return {
    version: '4.0.0',
    agentId: '0xtest',
    timestamp: Date.now(),
    marketSnapshot: {
      pool: 'test', baseAsset: 'SUI', quoteAsset: 'USDC',
      midPrice: 3.5, bestBid: 3.49, bestAsk: 3.51,
      spread: 0.02, spreadBps: 5.7,
      bidDepth: 500, askDepth: 500,
      volume24h: 100000, timestamp: Date.now(),
    },
    vaultState: { balance: '100', deployed: '0', totalShares: '100', totalValue: '100' },
    decision: {
      action: 'HOLD', reasoning: 'Test', confidence: 50,
      quantity: 0, price: 0, orderType: 'MARKET',
      riskAssessment: 'Test', marketCondition: 'UNKNOWN', timestamp: Date.now(),
    },
  };
}

describe('Walrus Logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should store reasoning successfully on first attempt', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ newlyCreated: { blobObject: { blobId: 'test-blob-123' } } }),
    });

    const { storeReasoning } = await import('../walrus-logger.js');
    const blobId = await storeReasoning(makeReasoningLog());
    expect(blobId).toBe('test-blob-123');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should handle alreadyCertified response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ alreadyCertified: { blobId: 'existing-blob-456' } }),
    });

    const { storeReasoning } = await import('../walrus-logger.js');
    const blobId = await storeReasoning(makeReasoningLog());
    expect(blobId).toBe('existing-blob-456');
  });

  it('should retry on failure with exponential backoff', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Timeout'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ newlyCreated: { blobObject: { blobId: 'retry-blob-789' } } }),
      });

    const { storeReasoning } = await import('../walrus-logger.js');
    const blobId = await storeReasoning(makeReasoningLog());
    expect(blobId).toBe('retry-blob-789');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('should fall back to local storage after all retries fail', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockRejectedValueOnce(new Error('fail 3'));

    const { storeReasoning } = await import('../walrus-logger.js');
    const blobId = await storeReasoning(makeReasoningLog());
    expect(blobId).toMatch(/^local-/);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('should retrieve reasoning successfully', async () => {
    const log = makeReasoningLog();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => log,
    });

    const { retrieveReasoning } = await import('../walrus-logger.js');
    const result = await retrieveReasoning('test-blob-123');
    expect(result).toEqual(log);
  });

  it('should return null for error blob IDs', async () => {
    const { retrieveReasoning } = await import('../walrus-logger.js');
    const result = await retrieveReasoning('error-12345');
    expect(result).toBeNull();
  });
});
