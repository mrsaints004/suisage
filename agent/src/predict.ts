/**
 * DeepBook Predict Integration (Testnet)
 *
 * Integrates with DeepBook's Predict protocol — a programmable,
 * vol-surface-priced prediction market on Sui testnet.
 *
 * The agent can:
 * 1. Read prediction market state (oracle price, strikes, implied probabilities)
 * 2. Place binary predictions (BTC up/down) using dUSDC
 * 3. Redeem settled predictions
 * 4. Track prediction performance in Walrus memory
 *
 * This module targets the DeepBook Predict testnet deployment.
 * On mainnet day-one, the same code redeploys.
 */

import { Transaction } from '@mysten/sui/transactions';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { config } from './config.js';
import { keypair, agentAddress } from './client.js';
import type { PredictPosition, PredictMarket } from '@suisage/shared';

// DeepBook Predict testnet constants
// These should be updated with actual deployed addresses from predict-testnet-4-16 branch
const PREDICT_PACKAGE_ID = process.env.PREDICT_PACKAGE_ID || '';
const PREDICT_REGISTRY_ID = process.env.PREDICT_REGISTRY_ID || '';
const PREDICT_MANAGER_ID = process.env.PREDICT_MANAGER_ID || '';
const DUSDC_TYPE = process.env.DUSDC_COIN_TYPE || '';

// Testnet client (Predict is only on testnet)
const predictClient = new SuiClient({
  url: process.env.PREDICT_RPC_URL || getFullnodeUrl('testnet'),
});

/**
 * Check if Predict integration is configured.
 */
export function isPredictEnabled(): boolean {
  return !!(PREDICT_PACKAGE_ID && PREDICT_REGISTRY_ID);
}

/**
 * Create a PredictManager account on first use.
 * The manager holds all prediction positions for the agent.
 */
export async function createPredictManager(): Promise<string> {
  if (!PREDICT_PACKAGE_ID) throw new Error('PREDICT_PACKAGE_ID not configured');

  const tx = new Transaction();

  tx.moveCall({
    target: `${PREDICT_PACKAGE_ID}::predict::create_manager`,
    arguments: [],
  });

  const result = await predictClient.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showObjectChanges: true },
  });

  const created = result.objectChanges?.find(
    (c) => c.type === 'created' && c.objectType?.includes('PredictManager'),
  );

  if (!created || created.type !== 'created') {
    throw new Error('Failed to create PredictManager');
  }

  console.log(`[Predict] Manager created: ${created.objectId}`);
  return created.objectId;
}

/**
 * Read available prediction markets from the registry.
 */
export async function getAvailableMarkets(): Promise<PredictMarket[]> {
  if (!PREDICT_PACKAGE_ID || !PREDICT_REGISTRY_ID) {
    console.log('[Predict] Not configured — skipping market read');
    return [];
  }

  try {
    // Query oracle events to find active markets
    const events = await predictClient.queryEvents({
      query: {
        MoveEventType: `${PREDICT_PACKAGE_ID}::oracle::OracleSVIUpdated`,
      },
      limit: 10,
      order: 'descending',
    });

    const markets: PredictMarket[] = events.data.map((ev) => {
      const fields = ev.parsedJson as Record<string, unknown>;
      return {
        marketId: String(fields.oracle_id || ''),
        oraclePrice: Number(fields.price || 0) / 1e9,
        strikePrice: Number(fields.strike_price || 0) / 1e9,
        expiryMs: Number(fields.expiry_timestamp_ms || 0),
        totalYes: Number(fields.total_yes || 0) / 1e9,
        totalNo: Number(fields.total_no || 0) / 1e9,
        impliedProb: Number(fields.implied_probability || 0.5),
      };
    });

    console.log(`[Predict] Found ${markets.length} active markets`);
    return markets;
  } catch (error) {
    console.error('[Predict] Error reading markets:', error);
    return [];
  }
}

/**
 * Place a binary prediction: mint YES or NO tokens.
 *
 * @param marketId - The oracle/market ID
 * @param direction - 'UP' (YES) or 'DOWN' (NO)
 * @param amountDusdc - Amount in dUSDC to bet
 * @param strikePrice - The strike price for the prediction
 */
export async function placePrediction(
  marketId: string,
  direction: 'UP' | 'DOWN',
  amountDusdc: bigint,
  strikePrice: bigint,
): Promise<PredictPosition | null> {
  if (!PREDICT_PACKAGE_ID || !PREDICT_MANAGER_ID) {
    console.log('[Predict] Not configured — cannot place prediction');
    return null;
  }

  try {
    const tx = new Transaction();
    const isYes = direction === 'UP';

    // Split dUSDC coins for the bet
    // In real usage, agent would have dUSDC balance
    tx.moveCall({
      target: `${PREDICT_PACKAGE_ID}::predict::mint`,
      arguments: [
        tx.object(PREDICT_MANAGER_ID),
        tx.object(marketId),
        tx.pure.bool(isYes),
        tx.pure.u64(amountDusdc),
        tx.pure.u64(strikePrice),
      ],
    });

    const result = await predictClient.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEvents: true, showEffects: true },
    });

    console.log(`[Predict] Prediction placed: ${direction} @ strike ${strikePrice} — tx: ${result.digest}`);

    return {
      marketId,
      direction,
      amount: Number(amountDusdc) / 1e9,
      entryPrice: Number(strikePrice) / 1e9,
      expiryMs: Date.now() + 3600000, // 1hr default
      settled: false,
    };
  } catch (error) {
    console.error('[Predict] Error placing prediction:', error);
    return null;
  }
}

/**
 * Redeem settled predictions using permissionless redemption.
 */
export async function redeemSettled(marketId: string): Promise<string | null> {
  if (!PREDICT_PACKAGE_ID || !PREDICT_MANAGER_ID) return null;

  try {
    const tx = new Transaction();

    tx.moveCall({
      target: `${PREDICT_PACKAGE_ID}::predict::redeem_permissionless`,
      arguments: [
        tx.object(PREDICT_MANAGER_ID),
        tx.object(marketId),
      ],
    });

    const result = await predictClient.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true },
    });

    console.log(`[Predict] Redeemed settled position: ${result.digest}`);
    return result.digest;
  } catch (error) {
    console.error('[Predict] Error redeeming:', error);
    return null;
  }
}

/**
 * Get agent's current prediction positions.
 */
export async function getPredictPositions(): Promise<PredictPosition[]> {
  if (!PREDICT_MANAGER_ID) return [];

  try {
    const obj = await predictClient.getObject({
      id: PREDICT_MANAGER_ID,
      options: { showContent: true },
    });

    if (!obj.data?.content || obj.data.content.dataType !== 'moveObject') {
      return [];
    }

    // Parse manager fields for active positions
    // Actual field structure depends on predict contract
    const fields = obj.data.content.fields as Record<string, unknown>;
    console.log(`[Predict] Manager state loaded`);

    return [];
  } catch (error) {
    console.error('[Predict] Error reading positions:', error);
    return [];
  }
}

/**
 * Format Predict status for logging and display.
 */
export function formatPredictStatus(markets: PredictMarket[], positions: PredictPosition[]): string {
  if (!isPredictEnabled()) {
    return '[Predict] Not configured (set PREDICT_PACKAGE_ID for testnet)';
  }

  const lines = [
    `[Predict] Markets: ${markets.length} | Positions: ${positions.length}`,
  ];

  for (const m of markets.slice(0, 3)) {
    lines.push(
      `  Market ${m.marketId.slice(0, 10)}: Oracle $${m.oraclePrice.toFixed(2)} | ` +
      `Strike $${m.strikePrice.toFixed(2)} | Implied: ${(m.impliedProb * 100).toFixed(1)}%`,
    );
  }

  for (const p of positions) {
    lines.push(
      `  Position: ${p.direction} ${p.amount} dUSDC @ $${p.entryPrice.toFixed(2)} | ` +
      `${p.settled ? 'SETTLED' : 'ACTIVE'}`,
    );
  }

  return lines.join('\n');
}
