import { Transaction } from '@mysten/sui/transactions';
import { executeTransaction, suiClient } from './client.js';
import { config } from './config.js';
import type { TradeDecision, ExecutionResult } from '@suisage/shared';
import { TRADE_TYPE, MIST_PER_SUI } from '@suisage/shared';

/**
 * Execute a trade decision on DeepBook.
 * For the hackathon demo, this uses programmable transactions
 * to interact with DeepBook V3 pools.
 */
export async function executeTrade(decision: TradeDecision): Promise<ExecutionResult> {
  if (decision.action === 'HOLD') {
    return { success: true, filledQuantity: 0, filledPrice: 0 };
  }

  try {
    const tx = new Transaction();
    const quantityMist = BigInt(Math.floor(decision.quantity * Number(MIST_PER_SUI)));

    // For demo purposes: simulate trade execution by recording it on-chain
    // In production, this would call DeepBook's place_market_order or place_limit_order
    // through the BalanceManager

    // Record the trade on-chain with Walrus blob reference (blob ID added later)
    const tradeType = decision.action === 'BUY' ? TRADE_TYPE.BUY
      : decision.action === 'SELL' ? TRADE_TYPE.SELL
      : TRADE_TYPE.REBALANCE;

    console.log(`[Executor] Executing ${decision.action} for ${decision.quantity} SUI @ $${decision.price}`);

    // For the hackathon, we simulate the DeepBook interaction
    // and focus on the verifiable reasoning chain
    return {
      success: true,
      filledQuantity: decision.quantity,
      filledPrice: decision.price,
    };
  } catch (error) {
    console.error('[Executor] Trade execution failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown execution error',
    };
  }
}

/**
 * Record a trade on-chain with the Walrus blob ID reference.
 */
export async function recordTradeOnChain(
  decision: TradeDecision,
  walrusBlobId: string,
  executionResult: ExecutionResult,
): Promise<string | null> {
  try {
    const tx = new Transaction();

    const tradeType = decision.action === 'BUY' ? TRADE_TYPE.BUY
      : decision.action === 'SELL' ? TRADE_TYPE.SELL
      : TRADE_TYPE.REBALANCE;

    const priceMist = BigInt(Math.floor(decision.price * Number(MIST_PER_SUI)));
    const quantityMist = BigInt(Math.floor(decision.quantity * Number(MIST_PER_SUI)));

    // Convert blob ID to bytes for on-chain storage
    const blobIdBytes = new TextEncoder().encode(walrusBlobId);

    tx.moveCall({
      target: `${config.vaultPackageId}::agent_auth::record_trade`,
      arguments: [
        tx.object(config.agentCapId),
        tx.object(config.vaultObjectId),
        tx.pure.u8(tradeType),
        tx.pure.u64(quantityMist),
        tx.pure.u64(priceMist),
        tx.pure.vector('u8', Array.from(blobIdBytes)),
        tx.pure.u64(BigInt(Date.now())),
      ],
    });

    const result = await executeTransaction(tx);
    const digest = result.digest;
    console.log(`[Executor] Trade recorded on-chain: ${digest}`);
    return digest;
  } catch (error) {
    console.error('[Executor] Failed to record trade on-chain:', error);
    return null;
  }
}
