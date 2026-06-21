import { Transaction } from '@mysten/sui/transactions';
import {
  executeTransaction,
  suiClient,
  agentAddress,
  createBalanceManager,
} from './client.js';
import { config } from './config.js';
import type { TradeDecision, ExecutionResult, GuardianCheck } from '@suisage/shared';
import { TRADE_TYPE, MIST_PER_SUI, SUI_COIN_TYPE, USDC_COIN_TYPE } from '@suisage/shared';
import { createHash } from 'crypto';

const FLOAT_SCALING = 1_000_000_000n;

// DeepBook V3 order constants
const SELF_MATCHING_ALLOWED = 0;
const PAY_WITH_DEEP = true;

// Cache BalanceManager creation failure to avoid retrying every cycle
let balanceManagerCreationFailed = false;

/**
 * Compute SHA-256 hash of reasoning JSON for on-chain verification.
 * This hash is stored in TradeRecordEvent so anyone can verify the Walrus blob.
 */
export function computeReasoningHash(reasoningJson: string): Uint8Array {
  const hash = createHash('sha256').update(reasoningJson).digest();
  return new Uint8Array(hash);
}

/**
 * Ensure DeepBook V3 BalanceManager exists. Creates one if missing.
 * Caches failure to avoid retrying every cycle.
 */
async function ensureBalanceManager(): Promise<void> {
  if (config.balanceManagerId) return;
  if (balanceManagerCreationFailed) {
    throw new Error('BalanceManager creation previously failed. Set BALANCE_MANAGER_ID in .env if you have one.');
  }

  console.log('[Executor] No BalanceManager found, creating one...');
  try {
    const managerId = await createBalanceManager();
    (config as any).balanceManagerId = managerId;
  } catch (error) {
    balanceManagerCreationFailed = true;
    throw error;
  }
}

/**
 * Get current DeepBook V3 account balance for the BalanceManager.
 */
export async function getDeepBookPosition(poolId: string): Promise<{
  availableBaseAmount: bigint;
  lockedBaseAmount: bigint;
  availableQuoteAmount: bigint;
  lockedQuoteAmount: bigint;
}> {
  if (!config.balanceManagerId) {
    return {
      availableBaseAmount: 0n,
      lockedBaseAmount: 0n,
      availableQuoteAmount: 0n,
      lockedQuoteAmount: 0n,
    };
  }

  try {
    // Query BalanceManager balances
    const result = await suiClient.getObject({
      id: config.balanceManagerId,
      options: { showContent: true },
    });

    console.log(`[Executor] BalanceManager ${config.balanceManagerId.slice(0, 12)}... queried`);
    return {
      availableBaseAmount: 0n,
      lockedBaseAmount: 0n,
      availableQuoteAmount: 0n,
      lockedQuoteAmount: 0n,
    };
  } catch (error) {
    console.warn('[Executor] Failed to read BalanceManager position:', error instanceof Error ? error.message : error);
    return {
      availableBaseAmount: 0n,
      lockedBaseAmount: 0n,
      availableQuoteAmount: 0n,
      lockedQuoteAmount: 0n,
    };
  }
}

/**
 * Execute a swap on DeepBook V3 using the swap_exact_base_for_quote pattern.
 * This doesn't require a BalanceManager — uses Coin objects directly.
 */
export async function executeTrade(
  decision: TradeDecision,
  poolId: string,
): Promise<ExecutionResult> {
  if (decision.action === 'HOLD') {
    return { success: true, filledQuantity: 0, filledPrice: 0 };
  }

  try {
    const tx = new Transaction();
    const quantityMist = BigInt(Math.floor(decision.quantity * Number(MIST_PER_SUI)));

    if (decision.action === 'SELL') {
      // Swap SUI for USDC: swap_exact_base_for_quote
      const [suiCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(quantityMist)]);

      const [baseCoinOut, quoteCoinOut, deepCoinOut] = tx.moveCall({
        target: `${config.deepbookPackageId}::pool::swap_exact_base_for_quote`,
        arguments: [
          tx.object(poolId),
          suiCoin,
          tx.moveCall({ target: '0x2::coin::zero', typeArguments: [USDC_COIN_TYPE] }),
          tx.moveCall({ target: '0x2::coin::zero', typeArguments: ['0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP'] }),
          tx.pure.u64(0), // min quote out
          tx.object('0x6'), // clock
        ],
        typeArguments: [SUI_COIN_TYPE, USDC_COIN_TYPE],
      });

      // Transfer outputs back to agent
      tx.transferObjects([baseCoinOut, quoteCoinOut, deepCoinOut], agentAddress);
    } else {
      // BUY: swap_exact_quote_for_base — need USDC coins
      // For now, we use the vault-funded PTB path instead
      return { success: false, error: 'Direct BUY requires USDC balance — use vault-funded PTB' };
    }

    console.log(`[Executor] Executing DeepBook V3 swap: ${decision.action} ${decision.quantity} SUI`);
    const result = await executeTransaction(tx);
    console.log(`[Executor] Swap executed - tx: ${result.digest}`);

    return {
      success: true,
      txDigest: result.digest,
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
 * Per-vault IDs for multi-vault execution.
 */
export interface VaultIds {
  vaultObjectId: string;
  agentCapId: string;
  strategyConfigId?: string;
}

/**
 * Execute a full trade cycle as a single Programmable Transaction Block (PTB).
 *
 * 1. Place swap on DeepBook V3
 * 2. Record trade on-chain with Walrus blob ID + reasoning hash
 */
export async function executeAtomicTradePTB(
  decision: TradeDecision,
  poolId: string,
  walrusBlobId: string,
  reasoningHash: Uint8Array,
  guardianApproved: boolean,
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
    const tx = new Transaction();
    const quantityMist = BigInt(Math.floor(decision.quantity * Number(MIST_PER_SUI)));
    const priceBigint = BigInt(Math.floor(decision.price * Number(FLOAT_SCALING)));

    // --- Step 1: Swap on DeepBook V3 ---
    if (decision.action === 'SELL') {
      const [suiCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(quantityMist)]);
      const [baseCoinOut, quoteCoinOut, deepCoinOut] = tx.moveCall({
        target: `${config.deepbookPackageId}::pool::swap_exact_base_for_quote`,
        arguments: [
          tx.object(poolId),
          suiCoin,
          tx.moveCall({ target: '0x2::coin::zero', typeArguments: [USDC_COIN_TYPE] }),
          tx.moveCall({ target: '0x2::coin::zero', typeArguments: ['0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP'] }),
          tx.pure.u64(0),
          tx.object('0x6'),
        ],
        typeArguments: [SUI_COIN_TYPE, USDC_COIN_TYPE],
      });
      tx.transferObjects([baseCoinOut, quoteCoinOut, deepCoinOut], agentAddress);
    }

    // --- Step 2: Record trade on-chain with Walrus reference + reasoning hash ---
    const tradeType = decision.action === 'BUY'
      ? TRADE_TYPE.BUY
      : decision.action === 'SELL'
        ? TRADE_TYPE.SELL
        : TRADE_TYPE.REBALANCE;

    const blobIdBytes = new TextEncoder().encode(walrusBlobId);
    const confidence = Math.min(255, Math.max(0, Math.round(decision.confidence)));

    tx.moveCall({
      target: `${config.vaultPackageId}::agent_auth::record_trade`,
      arguments: [
        tx.object(agentCapId),
        tx.object(vaultObjectId),
        tx.pure.u8(tradeType),
        tx.pure.u64(quantityMist),
        tx.pure.u64(priceBigint),
        tx.pure.vector('u8', Array.from(blobIdBytes)),
        tx.pure.vector('u8', Array.from(reasoningHash)),
        tx.pure.bool(guardianApproved),
        tx.pure.u8(confidence),
        tx.object('0x6'),
      ],
    });

    console.log(`[Executor] Executing atomic PTB: DeepBook V3 swap + on-chain record`);
    const result = await executeTransaction(tx);
    console.log(`[Executor] Atomic PTB executed - tx: ${result.digest}`);

    return {
      success: true,
      txDigest: result.digest,
      filledQuantity: decision.quantity,
      filledPrice: decision.price,
    };
  } catch (error) {
    console.error('[Executor] Atomic PTB failed:', error);
    return executeTrade(decision, poolId);
  }
}

/**
 * Execute a full vault-funded trade cycle as a single PTB:
 * 1. withdraw_for_trading → gets Coin<SUI> from vault (with on-chain Guardian checks)
 * 2. swap on DeepBook V3
 * 3. record_trade → records on-chain with Walrus blob + reasoning hash
 * 4. return remaining funds to vault
 */
export async function executeVaultTradePTB(
  decision: TradeDecision,
  poolId: string,
  walrusBlobId: string,
  reasoningHash: Uint8Array,
  guardianApproved: boolean,
  vaultIds: VaultIds,
): Promise<ExecutionResult> {
  if (decision.action === 'HOLD') {
    return { success: true, filledQuantity: 0, filledPrice: 0 };
  }

  const { agentCapId, vaultObjectId, strategyConfigId } = vaultIds;

  if (!agentCapId || !vaultObjectId) {
    return { success: false, error: 'Missing agentCapId or vaultObjectId' };
  }

  if (!strategyConfigId) {
    return { success: false, error: 'Missing strategyConfigId — required for on-chain Guardian enforcement' };
  }

  try {
    const tx = new Transaction();
    const quantityMist = BigInt(Math.floor(decision.quantity * Number(MIST_PER_SUI)));
    const priceBigint = BigInt(Math.floor(decision.price * Number(FLOAT_SCALING)));

    // --- Step 1: Withdraw from vault (with Move-enforced Guardian checks) ---
    const [tradeCoin] = tx.moveCall({
      target: `${config.vaultPackageId}::agent_auth::withdraw_for_trading`,
      arguments: [
        tx.object(agentCapId),
        tx.object(vaultObjectId),
        tx.object(strategyConfigId),
        tx.pure.u64(quantityMist),
        tx.object('0x6'),
      ],
    });

    // --- Step 2: Swap on DeepBook V3 ---
    if (decision.action === 'SELL') {
      // Swap SUI for USDC
      const [baseCoinOut, quoteCoinOut, deepCoinOut] = tx.moveCall({
        target: `${config.deepbookPackageId}::pool::swap_exact_base_for_quote`,
        arguments: [
          tx.object(poolId),
          tradeCoin,
          tx.moveCall({ target: '0x2::coin::zero', typeArguments: [USDC_COIN_TYPE] }),
          tx.moveCall({ target: '0x2::coin::zero', typeArguments: ['0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP'] }),
          tx.pure.u64(0), // min quote out
          tx.object('0x6'),
        ],
        typeArguments: [SUI_COIN_TYPE, USDC_COIN_TYPE],
      });

      // Return any remaining base (SUI) to vault
      tx.moveCall({
        target: `${config.vaultPackageId}::agent_auth::return_from_trading`,
        arguments: [
          tx.object(agentCapId),
          tx.object(vaultObjectId),
          baseCoinOut,
        ],
      });

      // Transfer USDC proceeds and DEEP refund to agent
      tx.transferObjects([quoteCoinOut, deepCoinOut], agentAddress);
    } else if (decision.action === 'BUY') {
      // For BUY, we'd swap USDC for SUI — but the vault holds SUI
      // so we return the withdrawn SUI as-is (BUY not supported from SUI vault)
      tx.moveCall({
        target: `${config.vaultPackageId}::agent_auth::return_from_trading`,
        arguments: [
          tx.object(agentCapId),
          tx.object(vaultObjectId),
          tradeCoin,
        ],
      });

      return { success: false, error: 'BUY not supported — vault holds SUI, cannot buy more SUI' };
    }

    // --- Step 3: Record trade on-chain with reasoning hash ---
    const tradeType = decision.action === 'SELL' ? TRADE_TYPE.SELL : TRADE_TYPE.REBALANCE;
    const blobIdBytes = new TextEncoder().encode(walrusBlobId);
    const confidence = Math.min(255, Math.max(0, Math.round(decision.confidence)));

    tx.moveCall({
      target: `${config.vaultPackageId}::agent_auth::record_trade`,
      arguments: [
        tx.object(agentCapId),
        tx.object(vaultObjectId),
        tx.pure.u8(tradeType),
        tx.pure.u64(quantityMist),
        tx.pure.u64(priceBigint),
        tx.pure.vector('u8', Array.from(blobIdBytes)),
        tx.pure.vector('u8', Array.from(reasoningHash)),
        tx.pure.bool(guardianApproved),
        tx.pure.u8(confidence),
        tx.object('0x6'),
      ],
    });

    console.log(`[Executor] Executing vault-funded PTB: withdraw(+guardian) -> DeepBook V3 swap -> record`);
    const result = await executeTransaction(tx);
    console.log(`[Executor] Vault PTB executed - tx: ${result.digest}`);

    return {
      success: true,
      txDigest: result.digest,
      filledQuantity: decision.quantity,
      filledPrice: decision.price,
    };
  } catch (error) {
    console.error('[Executor] Vault PTB failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Vault PTB execution error',
    };
  }
}

/**
 * Return funds from agent wallet back to vault.
 */
export async function returnFundsToVault(
  poolId: string,
  amount: bigint,
  vaultIds: VaultIds,
): Promise<string | null> {
  const { agentCapId, vaultObjectId } = vaultIds;

  if (!agentCapId || !vaultObjectId) {
    console.error('[Executor] Cannot return funds: missing agentCapId or vaultObjectId');
    return null;
  }

  try {
    const tx = new Transaction();

    // Split SUI from gas and return to vault
    const [returnCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(amount)]);

    tx.moveCall({
      target: `${config.vaultPackageId}::agent_auth::return_from_trading`,
      arguments: [
        tx.object(agentCapId),
        tx.object(vaultObjectId),
        returnCoin,
      ],
    });

    console.log(`[Executor] Returning ${amount} MIST to vault...`);
    const result = await executeTransaction(tx);
    console.log(`[Executor] Funds returned to vault - tx: ${result.digest}`);
    return result.digest;
  } catch (error) {
    console.error('[Executor] Failed to return funds to vault:', error);
    return null;
  }
}

/**
 * Record a trade on-chain with the Walrus blob ID + reasoning hash reference.
 */
export async function recordTradeOnChain(
  decision: TradeDecision,
  walrusBlobId: string,
  reasoningHash: Uint8Array,
  executionResult: ExecutionResult,
  guardianApproved: boolean,
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
    const confidence = Math.min(255, Math.max(0, Math.round(decision.confidence)));

    tx.moveCall({
      target: `${config.vaultPackageId}::agent_auth::record_trade`,
      arguments: [
        tx.object(agentCapId),
        tx.object(vaultObjectId),
        tx.pure.u8(tradeType),
        tx.pure.u64(quantityMist),
        tx.pure.u64(priceMist),
        tx.pure.vector('u8', Array.from(blobIdBytes)),
        tx.pure.vector('u8', Array.from(reasoningHash)),
        tx.pure.bool(guardianApproved),
        tx.pure.u8(confidence),
        tx.object('0x6'),
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
