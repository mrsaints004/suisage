import { Transaction } from '@mysten/sui/transactions';
import {
  executeTransaction,
  suiClient,
  deepbookClient,
  agentAddress,
  createAccountCap,
} from './client.js';
import { config } from './config.js';
import type { TradeDecision, ExecutionResult, GuardianCheck } from '@suisage/shared';
import { TRADE_TYPE, MIST_PER_SUI } from '@suisage/shared';

const FLOAT_SCALING = 1_000_000_000n;
const ORDER_EXPIRATION_MS = 5 * 60 * 1000; // 5 minute expiry for limit orders

// DeepBook LimitOrderType values (enum not re-exported from package index)
const LIMIT_ORDER_NO_RESTRICTION = 0;
const LIMIT_ORDER_IOC = 1; // Immediate-Or-Cancel

/**
 * Ensure DeepBook AccountCap exists. Creates one if missing.
 */
async function ensureAccountCap(): Promise<void> {
  if (config.accountCapId) return;

  console.log('[Executor] No AccountCap found, creating one...');
  const capId = await createAccountCap();
  // Update config in memory (user still needs to add to .env for persistence)
  (config as any).accountCapId = capId;
}

/**
 * Deposit SUI into DeepBook account for trading.
 */
export async function depositToDeepBook(
  poolId: string,
  amountMist: bigint,
): Promise<string> {
  await ensureAccountCap();

  console.log(`[Executor] Depositing ${amountMist} MIST into DeepBook pool ${poolId}...`);
  const tx = await deepbookClient.deposit(poolId, undefined, amountMist);
  const result = await executeTransaction(tx);
  console.log(`[Executor] Deposit tx: ${result.digest}`);
  return result.digest;
}

/**
 * Get current DeepBook account balance for a pool.
 */
export async function getDeepBookPosition(poolId: string): Promise<{
  availableBaseAmount: bigint;
  lockedBaseAmount: bigint;
  availableQuoteAmount: bigint;
  lockedQuoteAmount: bigint;
}> {
  await ensureAccountCap();

  const position = await deepbookClient.getUserPosition(poolId);
  console.log(
    `[Executor] DeepBook position - Base: ${position.availableBaseAmount} (locked: ${position.lockedBaseAmount}) | Quote: ${position.availableQuoteAmount} (locked: ${position.lockedQuoteAmount})`,
  );
  return position;
}

/**
 * Execute a trade decision on DeepBook using real limit orders.
 * Uses IOC (Immediate-Or-Cancel) for market-like execution,
 * or standard limit orders for limit-type execution.
 */
export async function executeTrade(
  decision: TradeDecision,
  poolId: string,
): Promise<ExecutionResult> {
  if (decision.action === 'HOLD') {
    return { success: true, filledQuantity: 0, filledPrice: 0 };
  }

  try {
    await ensureAccountCap();

    const quantityMist = BigInt(Math.floor(decision.quantity * Number(MIST_PER_SUI)));
    const priceBigint = BigInt(Math.floor(decision.price * Number(FLOAT_SCALING)));

    // Determine order side: BUY = bid, SELL = ask
    const orderSide: 'bid' | 'ask' = decision.action === 'SELL' ? 'ask' : 'bid';

    // Use IOC for market orders (fill what you can, cancel rest)
    // Use NO_RESTRICTION for limit orders (rest stays on book)
    const restriction = decision.orderType === 'MARKET'
      ? LIMIT_ORDER_IOC
      : LIMIT_ORDER_NO_RESTRICTION;

    const expirationMs = decision.orderType === 'MARKET'
      ? Date.now() + 30_000 // 30 second expiry for IOC
      : Date.now() + ORDER_EXPIRATION_MS;

    console.log(
      `[Executor] Placing ${decision.orderType} ${orderSide} order: ${decision.quantity} SUI @ $${decision.price} (${restriction === LIMIT_ORDER_IOC ? 'IOC' : 'LIMIT'})`,
    );

    // Place order via DeepBook SDK
    const tx = await deepbookClient.placeLimitOrder(
      poolId,
      priceBigint,
      quantityMist,
      orderSide,
      expirationMs,
      restriction,
    );

    const result = await executeTransaction(tx);
    console.log(`[Executor] Order placed - tx: ${result.digest}`);

    // Check events for fill info
    let filledQuantity = decision.quantity;
    let filledPrice = decision.price;

    // Parse order fill events if available
    if (result.events) {
      for (const event of result.events) {
        if (event.type.includes('OrderFilled')) {
          const fields = event.parsedJson as Record<string, unknown>;
          if (fields.base_asset_quantity_filled) {
            filledQuantity = Number(BigInt(String(fields.base_asset_quantity_filled))) / Number(MIST_PER_SUI);
          }
          if (fields.price) {
            filledPrice = Number(BigInt(String(fields.price))) / Number(FLOAT_SCALING);
          }
        }
      }
    }

    return {
      success: true,
      txDigest: result.digest,
      filledQuantity,
      filledPrice,
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
 * Per-vault IDs for multi-vault execution.
 * When provided, these override the global config values.
 */
export interface VaultIds {
  vaultObjectId: string;
  agentCapId: string;
}

/**
 * Execute a full trade cycle as a single Programmable Transaction Block (PTB).
 *
 * This demonstrates Sui's composability: multiple actions in one atomic transaction:
 * 1. Place order on DeepBook
 * 2. Record trade on-chain with Walrus blob ID reference
 *
 * If any step fails, the entire transaction rolls back.
 *
 * @param vaultIds - optional per-vault IDs; if omitted, uses global config
 */
export async function executeAtomicTradePTB(
  decision: TradeDecision,
  poolId: string,
  walrusBlobId: string,
  vaultIds?: VaultIds,
): Promise<ExecutionResult> {
  if (decision.action === 'HOLD') {
    return { success: true, filledQuantity: 0, filledPrice: 0 };
  }

  const agentCapId = vaultIds?.agentCapId || config.agentCapId;
  const vaultObjectId = vaultIds?.vaultObjectId || config.vaultObjectId;

  if (!agentCapId || !vaultObjectId) {
    return { success: false, error: 'Missing agentCapId or vaultObjectId' };
  }

  try {
    await ensureAccountCap();

    const tx = new Transaction();
    const quantityMist = BigInt(Math.floor(decision.quantity * Number(MIST_PER_SUI)));
    const priceBigint = BigInt(Math.floor(decision.price * Number(FLOAT_SCALING)));

    // --- Step 1: Place DeepBook order ---
    const orderSide: 'bid' | 'ask' = decision.action === 'SELL' ? 'ask' : 'bid';
    const restriction = decision.orderType === 'MARKET' ? LIMIT_ORDER_IOC : LIMIT_ORDER_NO_RESTRICTION;
    const expirationMs = decision.orderType === 'MARKET' ? Date.now() + 30_000 : Date.now() + ORDER_EXPIRATION_MS;

    // Build DeepBook place_limit_order call directly in our PTB
    tx.moveCall({
      target: `0xdee9::clob_v2::place_limit_order`,
      arguments: [
        tx.object(poolId),
        tx.pure.u64(0), // client_order_id
        tx.pure.u64(priceBigint),
        tx.pure.u64(quantityMist),
        tx.pure.u8(0), // self_matching_prevention
        tx.pure.bool(orderSide === 'bid'),
        tx.pure.u64(expirationMs),
        tx.pure.u8(restriction),
        tx.object('0x6'), // clock
        tx.object(config.accountCapId),
      ],
      typeArguments: [
        '0x2::sui::SUI',
        '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN',
      ],
    });

    // --- Step 2: Record trade on-chain with Walrus reference (same PTB) ---
    const tradeType = decision.action === 'BUY'
      ? TRADE_TYPE.BUY
      : decision.action === 'SELL'
        ? TRADE_TYPE.SELL
        : TRADE_TYPE.REBALANCE;

    const blobIdBytes = new TextEncoder().encode(walrusBlobId);

    tx.moveCall({
      target: `${config.vaultPackageId}::agent_auth::record_trade`,
      arguments: [
        tx.object(agentCapId),
        tx.object(vaultObjectId),
        tx.pure.u8(tradeType),
        tx.pure.u64(quantityMist),
        tx.pure.u64(priceBigint),
        tx.pure.vector('u8', Array.from(blobIdBytes)),
        tx.pure.u64(BigInt(Date.now())),
      ],
    });

    console.log(
      `[Executor] Executing atomic PTB: DeepBook ${orderSide} + on-chain record in single tx`,
    );

    const result = await executeTransaction(tx);
    console.log(`[Executor] Atomic PTB executed - tx: ${result.digest}`);

    // Parse fill info
    let filledQuantity = decision.quantity;
    let filledPrice = decision.price;

    if (result.events) {
      for (const event of result.events) {
        if (event.type.includes('OrderFilled')) {
          const fields = event.parsedJson as Record<string, unknown>;
          if (fields.base_asset_quantity_filled) {
            filledQuantity = Number(BigInt(String(fields.base_asset_quantity_filled))) / Number(MIST_PER_SUI);
          }
          if (fields.price) {
            filledPrice = Number(BigInt(String(fields.price))) / Number(FLOAT_SCALING);
          }
        }
      }
    }

    return {
      success: true,
      txDigest: result.digest,
      filledQuantity,
      filledPrice,
    };
  } catch (error) {
    console.error('[Executor] Atomic PTB failed:', error);
    // Fallback to separate transactions
    console.log('[Executor] Falling back to separate transactions...');
    return executeTrade(decision, poolId);
  }
}

/**
 * Withdraw funds from DeepBook back to wallet.
 */
export async function withdrawFromDeepBook(
  poolId: string,
  amount: bigint,
  assetType: 'base' | 'quote',
): Promise<string> {
  await ensureAccountCap();

  console.log(`[Executor] Withdrawing ${amount} ${assetType} from DeepBook...`);
  const tx = await deepbookClient.withdraw(poolId, amount, assetType, agentAddress);
  const result = await executeTransaction(tx);
  console.log(`[Executor] Withdraw tx: ${result.digest}`);
  return result.digest;
}

/**
 * Cancel all open orders on a pool.
 */
export async function cancelAllOrders(poolId: string): Promise<string> {
  await ensureAccountCap();

  console.log(`[Executor] Cancelling all orders on pool ${poolId}...`);
  const tx = await deepbookClient.cancelAllOrders(poolId);
  const result = await executeTransaction(tx);
  console.log(`[Executor] Cancel all tx: ${result.digest}`);
  return result.digest;
}

/**
 * List open orders on a pool.
 */
export async function listOpenOrders(poolId: string): Promise<Array<{
  orderId: string;
  clientOrderId: string;
  price: string;
  originalQuantity: string;
  quantity: string;
  isBid: boolean;
  owner: string;
  expireTimestamp: string;
}>> {
  await ensureAccountCap();

  const orders = await deepbookClient.listOpenOrders(poolId);
  console.log(`[Executor] Open orders: ${orders.length}`);
  for (const order of orders) {
    console.log(
      `  #${order.orderId}: ${order.isBid ? 'BUY' : 'SELL'} ${order.quantity} @ ${order.price}`,
    );
  }
  return orders;
}

/**
 * Record a trade on-chain with the Walrus blob ID reference.
 * (Used as fallback when atomic PTB is not used)
 *
 * @param vaultIds - optional per-vault IDs; if omitted, uses global config
 */
export async function recordTradeOnChain(
  decision: TradeDecision,
  walrusBlobId: string,
  executionResult: ExecutionResult,
  vaultIds?: VaultIds,
): Promise<string | null> {
  const agentCapId = vaultIds?.agentCapId || config.agentCapId;
  const vaultObjectId = vaultIds?.vaultObjectId || config.vaultObjectId;

  if (!agentCapId || !vaultObjectId) {
    console.error('[Executor] Cannot record trade: missing agentCapId or vaultObjectId');
    return null;
  }

  try {
    const tx = new Transaction();

    const tradeType = decision.action === 'BUY'
      ? TRADE_TYPE.BUY
      : decision.action === 'SELL'
        ? TRADE_TYPE.SELL
        : TRADE_TYPE.REBALANCE;

    const priceMist = BigInt(Math.floor(decision.price * Number(MIST_PER_SUI)));
    const quantityMist = BigInt(Math.floor(decision.quantity * Number(MIST_PER_SUI)));

    const blobIdBytes = new TextEncoder().encode(walrusBlobId);

    tx.moveCall({
      target: `${config.vaultPackageId}::agent_auth::record_trade`,
      arguments: [
        tx.object(agentCapId),
        tx.object(vaultObjectId),
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
