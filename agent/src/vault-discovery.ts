import { suiClient } from './client.js';
import { config } from './config.js';
import { agentAddress } from './client.js';
import type { ManagedVault } from '@suisage/shared';

/**
 * Discover all vaults the agent is authorized to manage.
 *
 * 1. Find all AgentCap objects owned by this agent address
 * 2. Query StrategyCreatedEvent events to build vault_id -> strategy_config_id mapping
 * 3. Return array of ManagedVault objects
 */
export async function discoverManagedVaults(): Promise<ManagedVault[]> {
  const packageId = config.vaultPackageId;

  // Step 1: Find all AgentCap objects owned by the agent
  const agentCaps = await suiClient.getOwnedObjects({
    owner: agentAddress,
    filter: {
      StructType: `${packageId}::agent_auth::AgentCap`,
    },
    options: { showContent: true },
  });

  if (agentCaps.data.length === 0) {
    console.log('[Discovery] No AgentCap objects found for this agent');
    return [];
  }

  // Parse AgentCap objects to extract vault IDs
  const vaultMap = new Map<string, { agentCapId: string }>();

  for (const obj of agentCaps.data) {
    if (!obj.data?.content || obj.data.content.dataType !== 'moveObject') continue;
    const fields = obj.data.content.fields as Record<string, unknown>;
    const active = Boolean(fields.active);
    if (!active) continue;

    const vaultId = String(fields.vault_id ?? '');
    const agentCapId = obj.data.objectId;

    if (vaultId) {
      vaultMap.set(vaultId, { agentCapId });
    }
  }

  // Step 2: Query StrategyCreatedEvent to find strategy_config_id for each vault
  const strategyMap = new Map<string, string>();

  try {
    let cursor: { txDigest: string; eventSeq: string } | null | undefined = undefined;
    let hasMore = true;

    while (hasMore) {
      const events = await suiClient.queryEvents({
        query: {
          MoveEventType: `${packageId}::strategy::StrategyCreatedEvent`,
        },
        limit: 50,
        cursor: cursor ?? undefined,
        order: 'descending',
      });

      for (const event of events.data) {
        const parsed = event.parsedJson as Record<string, unknown>;
        const vaultId = String(parsed.vault_id ?? '');
        const strategyConfigId = String(parsed.strategy_config_id ?? '');

        if (vaultId && strategyConfigId && !strategyMap.has(vaultId)) {
          strategyMap.set(vaultId, strategyConfigId);
        }
      }

      hasMore = events.hasNextPage;
      cursor = events.nextCursor ?? null;
    }
  } catch (error) {
    console.warn('[Discovery] Could not query StrategyCreatedEvent events:', error);
  }

  // Step 3: Build ManagedVault array
  const managedVaults: ManagedVault[] = [];

  for (const [vaultId, { agentCapId }] of vaultMap) {
    managedVaults.push({
      vaultId,
      agentCapId,
      strategyConfigId: strategyMap.get(vaultId) ?? null,
    });
  }

  console.log(`[Discovery] Found ${managedVaults.length} managed vault(s)`);
  for (const mv of managedVaults) {
    console.log(`  Vault: ${mv.vaultId.slice(0, 16)}... | AgentCap: ${mv.agentCapId.slice(0, 16)}... | Strategy: ${mv.strategyConfigId?.slice(0, 16) ?? 'none'}...`);
  }

  return managedVaults;
}
