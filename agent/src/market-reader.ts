import { deepbookClient, discoverPools } from './client.js';
import { config } from './config.js';
import type { MarketSnapshot } from '@suisage/shared';
import { FLOAT_SCALING_FACTOR } from '@suisage/shared';

/**
 * Read real market state from the configured DeepBook pool (mainnet SUI/wUSDC).
 */
export async function readMarketState(): Promise<MarketSnapshot> {
  const poolId = config.deepbookPoolId;

  if (!poolId) {
    throw new Error('[MarketReader] DEEPBOOK_POOL_ID is required. Set it in .env');
  }

  try {
    // 1. Get best bid/ask from DeepBook
    const marketPrice = await deepbookClient.getMarketPrice(poolId);

    const bestBid = marketPrice.bestBidPrice
      ? Number(marketPrice.bestBidPrice) / Number(FLOAT_SCALING_FACTOR)
      : undefined;
    const bestAsk = marketPrice.bestAskPrice
      ? Number(marketPrice.bestAskPrice) / Number(FLOAT_SCALING_FACTOR)
      : undefined;

    if (!bestBid && !bestAsk) {
      console.warn('[MarketReader] Empty orderbook - no bids or asks');
      return buildSnapshot(poolId, 0, 0, 0, 0, 0);
    }

    const midPrice = bestBid && bestAsk
      ? (bestBid + bestAsk) / 2
      : bestBid || bestAsk || 0;

    const spread = bestBid && bestAsk ? bestAsk - bestBid : 0;
    const spreadBps = midPrice > 0 ? (spread / midPrice) * 10000 : 0;

    // 2. Get orderbook depth in a +-10% range
    let bidDepth = 0;
    let askDepth = 0;

    try {
      const lowerBound = BigInt(Math.floor(midPrice * 0.9 * Number(FLOAT_SCALING_FACTOR)));
      const upperBound = BigInt(Math.ceil(midPrice * 1.1 * Number(FLOAT_SCALING_FACTOR)));

      const [bidLevels, askLevels] = (await deepbookClient.getLevel2BookStatus(
        poolId,
        lowerBound,
        upperBound,
        'both',
      )) as Array<Array<{ price: bigint; depth: bigint }>>;

      for (const level of bidLevels) {
        bidDepth += Number(level.depth) / Number(FLOAT_SCALING_FACTOR);
      }
      for (const level of askLevels) {
        askDepth += Number(level.depth) / Number(FLOAT_SCALING_FACTOR);
      }
    } catch (depthError) {
      console.warn('[MarketReader] Could not read depth:', depthError);
    }

    console.log(
      `[MarketReader] Mid: $${midPrice.toFixed(4)} | Bid: $${bestBid?.toFixed(4) ?? 'N/A'} | Ask: $${bestAsk?.toFixed(4) ?? 'N/A'} | Spread: ${spreadBps.toFixed(1)}bps | Bid depth: ${bidDepth.toFixed(2)} | Ask depth: ${askDepth.toFixed(2)}`,
    );

    return buildSnapshot(poolId, midPrice, bestBid ?? midPrice, bestAsk ?? midPrice, bidDepth, askDepth);
  } catch (error) {
    console.error('[MarketReader] Error reading DeepBook pool:', error);
    throw error;
  }
}

function buildSnapshot(
  poolId: string,
  midPrice: number,
  bestBid: number,
  bestAsk: number,
  bidDepth: number,
  askDepth: number,
): MarketSnapshot {
  const spread = bestAsk - bestBid;
  const spreadBps = midPrice > 0 ? (spread / midPrice) * 10000 : 0;

  return {
    pool: poolId,
    baseAsset: 'SUI',
    quoteAsset: 'wUSDC',
    midPrice,
    bestBid,
    bestAsk,
    spread,
    spreadBps,
    bidDepth,
    askDepth,
    volume24h: 0, // DeepBook V2 SDK doesn't expose 24h volume
    timestamp: Date.now(),
  };
}
