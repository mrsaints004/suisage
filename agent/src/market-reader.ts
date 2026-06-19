import { deepbookClient, discoverPools } from './client.js';
import { config } from './config.js';
import type { MarketSnapshot } from '@suisage/shared';
import { FLOAT_SCALING_FACTOR } from '@suisage/shared';

/**
 * Read market state from DeepBook pool. Falls back to live SUI price feed
 * when the pool doesn't exist (e.g. testnet).
 */
export async function readMarketState(): Promise<MarketSnapshot> {
  const poolId = config.deepbookPoolId;

  try {
    // Try DeepBook first (works on mainnet)
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

    // Get orderbook depth in a +-10% range
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
      `[MarketReader] DeepBook | Mid: $${midPrice.toFixed(4)} | Bid: $${bestBid?.toFixed(4) ?? 'N/A'} | Ask: $${bestAsk?.toFixed(4) ?? 'N/A'} | Spread: ${(midPrice > 0 ? ((bestAsk! - bestBid!) / midPrice) * 10000 : 0).toFixed(1)}bps`,
    );

    return buildSnapshot(poolId, midPrice, bestBid ?? midPrice, bestAsk ?? midPrice, bidDepth, askDepth);
  } catch {
    // DeepBook pool not available
    if (config.suiNetwork === 'mainnet') {
      // On mainnet, never use CoinGecko — return zero snapshot so guardian blocks the trade
      console.error('[MarketReader] DeepBook unavailable on mainnet — returning zero snapshot (agent will HOLD)');
      return buildSnapshot(poolId, 0, 0, 0, 0, 0);
    }
    // Testnet only: fall back to live price feed for development
    console.log('[MarketReader] DeepBook pool not available (testnet), fetching live SUI price...');
    return await readFromPriceFeed(poolId);
  }
}

/**
 * Fallback: fetch live SUI/USD price from CoinGecko (free, no API key needed)
 * and simulate realistic orderbook data for the AI to reason about.
 */
async function readFromPriceFeed(poolId: string): Promise<MarketSnapshot> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd&include_24hr_vol=true',
      { signal: AbortSignal.timeout(10000) },
    );

    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);

    const data = await res.json() as { sui?: { usd?: number; usd_24h_vol?: number } };
    const price = data.sui?.usd ?? 0;
    const volume = data.sui?.usd_24h_vol ?? 0;

    if (price <= 0) throw new Error('Invalid price from CoinGecko');

    // Simulate realistic spread (~5-15 bps for a liquid pair)
    const spreadPct = 0.0008; // ~8 bps
    const bestBid = price * (1 - spreadPct / 2);
    const bestAsk = price * (1 + spreadPct / 2);

    // Simulate depth based on volume
    const depthEstimate = volume > 0 ? Math.min(volume / price / 100, 50000) : 5000;
    const bidDepth = depthEstimate * (0.9 + Math.random() * 0.2);
    const askDepth = depthEstimate * (0.9 + Math.random() * 0.2);

    console.log(
      `[MarketReader] Price feed | Mid: $${price.toFixed(4)} | Bid: $${bestBid.toFixed(4)} | Ask: $${bestAsk.toFixed(4)} | Vol: $${(volume / 1e6).toFixed(1)}M`,
    );

    return buildSnapshot(poolId, price, bestBid, bestAsk, bidDepth, askDepth);
  } catch (error) {
    console.error('[MarketReader] Price feed failed:', error);
    // Last resort: return zero snapshot so agent HOLDs
    return buildSnapshot(poolId, 0, 0, 0, 0, 0);
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
    volume24h: 0,
    timestamp: Date.now(),
  };
}
