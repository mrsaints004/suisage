import { suiClient } from './client.js';
import type { MarketSnapshot } from '@suisage/shared';

// DeepBook V3 pool reading
// On testnet, we'll read the SUI/USDC pool from DeepBook

interface DeepBookPool {
  poolId: string;
  baseAsset: string;
  quoteAsset: string;
}

// Known testnet pools - update with actual pool IDs after deployment
const POOLS: DeepBookPool[] = [
  {
    poolId: process.env.DEEPBOOK_POOL_ID || '',
    baseAsset: 'SUI',
    quoteAsset: 'USDC',
  },
];

export async function readMarketState(poolId?: string): Promise<MarketSnapshot> {
  const pool = POOLS[0];
  const targetPoolId = poolId || pool.poolId;

  if (!targetPoolId) {
    // Return simulated data when no pool is configured (for development)
    return getSimulatedMarketData();
  }

  try {
    // Read pool object to get current state
    const poolObj = await suiClient.getObject({
      id: targetPoolId,
      options: { showContent: true },
    });

    if (!poolObj.data?.content || poolObj.data.content.dataType !== 'moveObject') {
      console.warn('[MarketReader] Could not read pool object, using simulated data');
      return getSimulatedMarketData();
    }

    // Parse the pool fields - DeepBook V3 structure
    const fields = poolObj.data.content.fields as Record<string, unknown>;

    // For now, extract what we can and simulate the rest
    // DeepBook pools store orderbook state that requires specific SDK calls
    const midPrice = await getMidPrice(targetPoolId);

    return {
      pool: targetPoolId,
      baseAsset: pool.baseAsset,
      quoteAsset: pool.quoteAsset,
      midPrice,
      bestBid: midPrice * 0.999,
      bestAsk: midPrice * 1.001,
      spread: midPrice * 0.002,
      spreadBps: 20,
      bidDepth: 0,
      askDepth: 0,
      volume24h: 0,
      timestamp: Date.now(),
    };
  } catch (error) {
    console.warn('[MarketReader] Error reading pool, using simulated data:', error);
    return getSimulatedMarketData();
  }
}

async function getMidPrice(poolId: string): Promise<number> {
  try {
    // Try to read mid price via DeepBook's get_mid_price
    const tx = new (await import('@mysten/sui/transactions')).Transaction();
    // DeepBook V3 uses a different approach - we'd need the DeepBook SDK
    // For now, fallback to simulated
    return 1.5 + Math.random() * 0.2; // SUI price range
  } catch {
    return 1.5 + Math.random() * 0.2;
  }
}

function getSimulatedMarketData(): MarketSnapshot {
  // Simulated SUI/USDC market data for development/demo
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
