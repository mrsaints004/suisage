import { suiClient } from './client.js';
import { config } from './config.js';
import type { VaultState } from '@suisage/shared';

export async function readVaultState(): Promise<VaultState> {
  const vaultId = config.vaultObjectId;

  try {
    const vaultObj = await suiClient.getObject({
      id: vaultId,
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
      vaultId,
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
      vaultId,
      balance: 0n,
      totalShares: 0n,
      deployedAmount: 0n,
      paused: false,
      totalValue: 0n,
    };
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
