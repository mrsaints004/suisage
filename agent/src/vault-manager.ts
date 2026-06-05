import { suiClient } from './client.js';
import { config } from './config.js';
import type { VaultState, AgentCapState, StrategyConfigState } from '@suisage/shared';

/**
 * Read vault state. Accepts an optional vault ID; defaults to config.vaultObjectId.
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

    const balance = BigInt(String(fields.balance ?? '0'));
    const totalShares = BigInt(String(fields.total_shares ?? '0'));
    const deployedAmount = BigInt(String(fields.deployed_amount ?? '0'));
    const paused = Boolean(fields.paused);

    return {
      vaultId: id,
      balance,
      totalShares,
      deployedAmount,
      paused,
      totalValue: balance + deployedAmount,
    };
  } catch (error) {
    console.error('[VaultManager] Error reading vault state:', error);
    // Return empty state on error
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
