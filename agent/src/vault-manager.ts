import { suiClient } from './client.js';
import { config } from './config.js';
import type { VaultState, AgentCapState, StrategyConfigState } from '@suisage/shared';

/**
 * Read vault state including performance tracking fields.
 * Accepts an optional vault ID; defaults to config.vaultObjectId.
 */
export async function readVaultState(vaultId?: string): Promise<VaultState> {
  const id = vaultId || config.vaultObjectId;

  try {
    const vaultObj = await suiClient.getObject({
      id,
      options: { showContent: true },
    });

    if (!vaultObj.data?.content || vaultObj.data.content.dataType !== 'moveObject') {
      throw new Error('Could not read vault object');
    }

    const fields = vaultObj.data.content.fields as Record<string, unknown>;

    // Handle nested Balance<SUI> object (Sui SDK may return {value: "..."} for Balance fields)
    const rawBalance = fields.balance;
    const balance = typeof rawBalance === 'object' && rawBalance !== null && 'value' in (rawBalance as any)
      ? BigInt(String((rawBalance as any).value))
      : BigInt(String(rawBalance ?? '0'));
    const totalShares = BigInt(String(fields.total_shares ?? '0'));
    const deployedAmount = BigInt(String(fields.deployed_amount ?? '0'));
    const paused = Boolean(fields.paused);

    // Performance tracking fields
    const performanceFeeBps = Number(String(fields.performance_fee_bps ?? '0'));
    const highWaterMark = BigInt(String(fields.high_water_mark ?? '1000000000'));

    const rawFees = fields.accrued_fees;
    const accruedFees = typeof rawFees === 'object' && rawFees !== null && 'value' in (rawFees as any)
      ? BigInt(String((rawFees as any).value))
      : BigInt(String(rawFees ?? '0'));

    const totalProfit = BigInt(String(fields.total_profit ?? '0'));
    const totalLoss = BigInt(String(fields.total_loss ?? '0'));
    const profitEvents = Number(String(fields.profit_events ?? '0'));

    const totalValue = balance + deployedAmount;
    const navPerShare = totalShares > 0n
      ? (totalValue * 1_000_000_000n) / totalShares
      : 1_000_000_000n;

    return {
      vaultId: id,
      balance,
      totalShares,
      deployedAmount,
      paused,
      totalValue,
      performanceFeeBps,
      highWaterMark,
      accruedFees,
      totalProfit,
      totalLoss,
      navPerShare,
      profitEvents,
    };
  } catch (error) {
    console.error('[VaultManager] Error reading vault state:', error);
    return {
      vaultId: id,
      balance: 0n,
      totalShares: 0n,
      deployedAmount: 0n,
      paused: false,
      totalValue: 0n,
    };
  }
}

export async function readAgentCapState(agentCapId: string): Promise<AgentCapState | null> {
  try {
    const obj = await suiClient.getObject({
      id: agentCapId,
      options: { showContent: true },
    });

    if (!obj.data?.content || obj.data.content.dataType !== 'moveObject') {
      console.warn('[VaultManager] Could not read AgentCap object');
      return null;
    }

    const fields = obj.data.content.fields as Record<string, unknown>;

    return {
      agentCapId,
      vaultId: String(fields.vault_id ?? ''),
      maxTradeSize: BigInt(String(fields.max_trade_size ?? '0')),
      maxDeploymentBps: Number(String(fields.max_deployment_bps ?? '0')),
      active: Boolean(fields.active),
      lastTradeTimestampMs: Number(String(fields.last_trade_timestamp_ms ?? '0')),
      totalTrades: Number(String(fields.total_trades ?? '0')),
      totalVolume: BigInt(String(fields.total_volume ?? '0')),
    };
  } catch (error) {
    console.warn('[VaultManager] Error reading AgentCap state:', error);
    return null;
  }
}

export async function readStrategyConfig(strategyConfigId: string): Promise<StrategyConfigState | null> {
  try {
    const obj = await suiClient.getObject({
      id: strategyConfigId,
      options: { showContent: true },
    });

    if (!obj.data?.content || obj.data.content.dataType !== 'moveObject') {
      console.warn('[VaultManager] Could not read StrategyConfig object');
      return null;
    }

    const fields = obj.data.content.fields as Record<string, unknown>;

    // Parse allowed_pools — on-chain it's vector<address> which comes as string[]
    const rawPools = fields.allowed_pools;
    const allowedPools: string[] = Array.isArray(rawPools)
      ? rawPools.map(String)
      : [];

    return {
      strategyConfigId,
      vaultId: String(fields.vault_id ?? ''),
      maxPositionBps: Number(String(fields.max_position_bps ?? '0')),
      stopLossBps: Number(String(fields.stop_loss_bps ?? '0')),
      minTradeIntervalSec: Number(String(fields.min_trade_interval_sec ?? '0')),
      maxOpenPositions: Number(String(fields.max_open_positions ?? '0')),
      allowedPools,
      active: Boolean(fields.active),
    };
  } catch (error) {
    console.warn('[VaultManager] Error reading StrategyConfig state:', error);
    return null;
  }
}

export async function getVaultEvents(limit: number = 20) {
  try {
    const events = await suiClient.queryEvents({
      query: {
        MoveModule: {
          package: config.vaultPackageId,
          module: 'vault',
        },
      },
      limit,
      order: 'descending',
    });
    return events.data;
  } catch (error) {
    console.error('[VaultManager] Error fetching vault events:', error);
    return [];
  }
}
