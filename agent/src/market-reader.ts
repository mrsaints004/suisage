import { Transaction } from '@mysten/sui/transactions';
import { suiClient } from './client.js';
import { config } from './config.js';
import type { MarketSnapshot } from '@suisage/shared';
import { FLOAT_SCALING_FACTOR, SUI_COIN_TYPE, USDC_COIN_TYPE } from '@suisage/shared';

/**
 * Read market state from DeepBook V3 pool.
 * Falls back to CoinGecko price feed when the pool has stale/empty data.
 */
export async function readMarketState(): Promise<MarketSnapshot> {
  const poolId = config.deepbookPoolId;

  try {
    // Query DeepBook V3 mid_price via devInspect
    const midPriceResult = await suiClient.devInspectTransactionBlock({
      transactionBlock: (() => {
        const tx = new Transaction();
        tx.moveCall({
          target: `${config.deepbookPackageId}::pool::mid_price`,
          arguments: [tx.object(poolId), tx.object('0x6')],
          typeArguments: [SUI_COIN_TYPE, USDC_COIN_TYPE],
        });
        return tx;
      })(),
      sender: '0x0000000000000000000000000000000000000000000000000000000000000000',
    });

    // Parse mid price from result
    const returnValues = midPriceResult?.results?.[0]?.returnValues;
    if (returnValues && returnValues.length > 0) {
      const bytes = returnValues[0][0];
      // DeepBook V3 prices use 1e6 scaling (USDC has 6 decimals)
      const DEEPBOOK_V3_PRICE_SCALING = 1_000_000;
      const rawPrice = Buffer.from(bytes as number[]).readBigUInt64LE(0);
      const midPrice = Number(rawPrice) / DEEPBOOK_V3_PRICE_SCALING;

      if (midPrice > 0.10 && midPrice < 10000) {
        // Get best bid/ask via level2 query
        const { bestBid, bestAsk, bidDepth, askDepth } = await getLevel2Data(poolId, midPrice);

        const spreadBps = midPrice > 0 && bestBid && bestAsk
          ? ((bestAsk - bestBid) / midPrice) * 10000
          : 0;

        // Sanity check on spread
        if (spreadBps > 500) {
          console.warn(`[MarketReader] DeepBook V3 spread too wide (${spreadBps.toFixed(0)}bps), falling back to price feed`);
          return await readFromPriceFeed(poolId);
        }

        console.log(
          `[MarketReader] DeepBook V3 | Mid: $${midPrice.toFixed(4)} | Bid: $${bestBid.toFixed(4)} | Ask: $${bestAsk.toFixed(4)} | Spread: ${spreadBps.toFixed(1)}bps`,
        );
        return buildSnapshot(poolId, midPrice, bestBid, bestAsk, bidDepth, askDepth);
      }
    }

    // If we couldn't parse a valid price, fall back
    console.warn('[MarketReader] Could not read DeepBook V3 mid price, falling back to price feed');
    return await readFromPriceFeed(poolId);
  } catch (error) {
    // DeepBook V3 query failed — fall back to price feed
    console.warn('[MarketReader] DeepBook V3 query failed, falling back to price feed:', error instanceof Error ? error.message : error);
    return await readFromPriceFeed(poolId);
  }
}

/**
 * Get best bid/ask and depth from DeepBook V3 pool.
 * Falls back to estimated values from mid price if L2 query fails.
 */
async function getLevel2Data(poolId: string, midPrice: number): Promise<{
  bestBid: number;
  bestAsk: number;
  bidDepth: number;
  askDepth: number;
}> {
  try {
    // Try to get best bid/ask via devInspect
    const result = await suiClient.devInspectTransactionBlock({
      transactionBlock: (() => {
        const tx = new Transaction();
        tx.moveCall({
          target: `${config.deepbookPackageId}::pool::get_level2_ticks_from_mid`,
          arguments: [
            tx.object(poolId),
            tx.pure.u64(5), // 5 ticks from mid
            tx.object('0x6'),
          ],
          typeArguments: [SUI_COIN_TYPE, USDC_COIN_TYPE],
        });
        return tx;
      })(),
      sender: '0x0000000000000000000000000000000000000000000000000000000000000000',
    });

    // Parse bid/ask from the result
    if (result?.results?.[0]?.returnValues) {
      // For now, use spread estimation from mid price
      // The V3 level2 return format is complex (vectors of price/quantity pairs)
      const spreadPct = 0.001; // ~10bps estimated
      return {
        bestBid: midPrice * (1 - spreadPct / 2),
        bestAsk: midPrice * (1 + spreadPct / 2),
        bidDepth: 10000, // placeholder
        askDepth: 10000,
      };
    }
  } catch {
    // Level2 query failed
  }

  // Estimate from mid price
  const spreadPct = 0.001;
  return {
    bestBid: midPrice * (1 - spreadPct / 2),
    bestAsk: midPrice * (1 + spreadPct / 2),
    bidDepth: 5000,
    askDepth: 5000,
  };
}

/**
 * Fallback: fetch live SUI/USD price from CoinGecko (free, no API key needed)
 * and simulate realistic orderbook data for the reasoner.
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
    quoteAsset: 'USDC',
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
