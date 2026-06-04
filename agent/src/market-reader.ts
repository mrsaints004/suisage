import { deepbookClient, discoverPools } from './client.js';
import { config } from './config.js';
import type { MarketSnapshot } from '@suisage/shared';

const FLOAT_SCALING = 1_000_000_000n;

// Cache the resolved pool ID so we only discover once
let resolvedPoolId: string | null = null;

/**
 * Resolve the DeepBook pool to use. If DEEPBOOK_POOL_ID is set, use it.
 * Otherwise discover pools and pick the first SUI-paired one.
 */
async function getPoolId(): Promise<string | null> {
  if (resolvedPoolId) return resolvedPoolId;

  if (config.deepbookPoolId) {
    resolvedPoolId = config.deepbookPoolId;
    return resolvedPoolId;
  }

  // Auto-discover
  try {
    const pools = await discoverPools();
    const suiPool = pools.find(
      (p) =>
        p.baseAsset.includes('SUI') ||
        p.quoteAsset.includes('SUI'),
    );
    if (suiPool) {
      resolvedPoolId = suiPool.poolId;
      console.log(`[MarketReader] Auto-discovered pool: ${resolvedPoolId}`);
      return resolvedPoolId;
    }
  } catch (error) {
    console.warn('[MarketReader] Pool discovery failed:', error);
  }

  return null;
}

/**
 * Read real market state from a DeepBook pool.
 */
export async function readMarketState(): Promise<MarketSnapshot> {
  const poolId = await getPoolId();

  if (!poolId) {
    console.warn('[MarketReader] No pool available, using simulated data');
    return getSimulatedMarketData();
  }

  try {
    // 1. Get best bid/ask from DeepBook
    const marketPrice = await deepbookClient.getMarketPrice(poolId);

    const bestBid = marketPrice.bestBidPrice
      ? Number(marketPrice.bestBidPrice) / Number(FLOAT_SCALING)
      : undefined;
    const bestAsk = marketPrice.bestAskPrice
      ? Number(marketPrice.bestAskPrice) / Number(FLOAT_SCALING)
      : undefined;

    if (!bestBid && !bestAsk) {
      console.warn('[MarketReader] Empty orderbook, using simulated data');
      return getSimulatedMarketData();
    }

    const midPrice = bestBid && bestAsk
      ? (bestBid + bestAsk) / 2
      : bestBid || bestAsk || 0;

    const spread = bestBid && bestAsk ? bestAsk - bestBid : 0;
    const spreadBps = midPrice > 0 ? (spread / midPrice) * 10000 : 0;

    // 2. Get orderbook depth
    let bidDepth = 0;
    let askDepth = 0;

    try {
      // Query a +-10% range around mid price for depth
      const lowerBound = BigInt(Math.floor(midPrice * 0.9 * Number(FLOAT_SCALING)));
      const upperBound = BigInt(Math.ceil(midPrice * 1.1 * Number(FLOAT_SCALING)));

      const [bidLevels, askLevels] = (await deepbookClient.getLevel2BookStatus(
        poolId,
        lowerBound,
        upperBound,
        'both',
      )) as Array<Array<{ price: bigint; depth: bigint }>>;

      for (const level of bidLevels) {
        bidDepth += Number(level.depth) / Number(FLOAT_SCALING);
      }
      for (const level of askLevels) {
        askDepth += Number(level.depth) / Number(FLOAT_SCALING);
      }
    } catch (depthError) {
      console.warn('[MarketReader] Could not read depth:', depthError);
    }

    console.log(
      `[MarketReader] Mid: $${midPrice.toFixed(4)} | Bid: $${bestBid?.toFixed(4) ?? 'N/A'} | Ask: $${bestAsk?.toFixed(4) ?? 'N/A'} | Spread: ${spreadBps.toFixed(1)}bps`,
    );

    return {
      pool: poolId,
      baseAsset: 'SUI',
      quoteAsset: 'USDC',
      midPrice,
      bestBid: bestBid ?? midPrice,
      bestAsk: bestAsk ?? midPrice,
      spread,
      spreadBps,
      bidDepth,
      askDepth,
      volume24h: 0, // DeepBook SDK v0.9 doesn't expose 24h volume directly
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error('[MarketReader] Error reading DeepBook pool:', error);
    return getSimulatedMarketData();
  }
}

/**
 * Fallback simulated data - only used when no pool is available or on error.
 */
function getSimulatedMarketData(): MarketSnapshot {
  const basePrice = 1.5;
  const variance = (Math.random() - 0.5) * 0.1;
  const midPrice = basePrice + variance;
  const spread = midPrice * 0.002;

  return {
    pool: 'simulated',
    baseAsset: 'SUI',
    quoteAsset: 'USDC',
    midPrice,
    bestBid: midPrice - spread / 2,
    bestAsk: midPrice + spread / 2,
    spread,
    spreadBps: 20,
    bidDepth: 10000 + Math.random() * 5000,
    askDepth: 10000 + Math.random() * 5000,
    volume24h: 500000 + Math.random() * 200000,
    timestamp: Date.now(),
  };
}
