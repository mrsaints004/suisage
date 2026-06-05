'use client';

import { useState, useEffect, useCallback } from 'react';
import { useCurrentAccount, useSuiClient } from '@mysten/dapp-kit';

const VAULT_PACKAGE_ID = process.env.NEXT_PUBLIC_VAULT_PACKAGE_ID || '';

export interface UserVault {
  vaultId: string;
  adminCapId: string;
  strategyConfigId: string | null;
  balance: string;
  totalShares: string;
  deployed: string;
  paused: boolean;
}

/**
 * Discovers all vaults the connected user owns (via AdminCap).
 * Also resolves StrategyConfig for each vault via StrategyCreatedEvent queries.
 */
export function useUserVaults() {
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const [vaults, setVaults] = useState<UserVault[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!account || !VAULT_PACKAGE_ID) {
      setVaults([]);
      return;
    }

    setLoading(true);
    try {
      // Step 1: Find all AdminCap objects owned by this user
      const adminCaps = await suiClient.getOwnedObjects({
        owner: account.address,
        filter: {
          StructType: `${VAULT_PACKAGE_ID}::agent_auth::AdminCap`,
        },
        options: { showContent: true },
      });

      if (adminCaps.data.length === 0) {
        setVaults([]);
        setLoading(false);
        return;
      }

      // Parse AdminCap objects to get vault IDs
      const adminCapEntries: Array<{ adminCapId: string; vaultId: string }> = [];
      for (const obj of adminCaps.data) {
        if (!obj.data?.content || obj.data.content.dataType !== 'moveObject') continue;
        const fields = obj.data.content.fields as Record<string, unknown>;
        const vaultId = String(fields.vault_id ?? '');
        if (vaultId) {
          adminCapEntries.push({
            adminCapId: obj.data.objectId,
            vaultId,
          });
        }
      }

      // Step 2: Query StrategyCreatedEvent to find strategy_config_id for each vault
      const strategyMap = new Map<string, string>();
      try {
        let cursor: string | null | undefined = undefined;
        let hasMore = true;

        while (hasMore) {
          const events = await suiClient.queryEvents({
            query: {
              MoveEventType: `${VAULT_PACKAGE_ID}::strategy::StrategyCreatedEvent`,
            },
            limit: 50,
            cursor: cursor ?? undefined,
            order: 'descending',
          });

          for (const event of events.data) {
            const parsed = event.parsedJson as Record<string, unknown>;
            const vid = String(parsed.vault_id ?? '');
            const sid = String(parsed.strategy_config_id ?? '');
            if (vid && sid && !strategyMap.has(vid)) {
              strategyMap.set(vid, sid);
            }
          }

          hasMore = events.hasNextPage;
          cursor = events.nextCursor;
        }
      } catch {
        // Strategy events may not exist yet
      }

      // Step 3: Read vault state for each
      const results: UserVault[] = [];
      for (const entry of adminCapEntries) {
        try {
          const vaultObj = await suiClient.getObject({
            id: entry.vaultId,
            options: { showContent: true },
          });

          if (vaultObj.data?.content && vaultObj.data.content.dataType === 'moveObject') {
            const fields = vaultObj.data.content.fields as Record<string, unknown>;
            results.push({
              vaultId: entry.vaultId,
              adminCapId: entry.adminCapId,
              strategyConfigId: strategyMap.get(entry.vaultId) ?? null,
              balance: (Number(String(fields.balance ?? '0')) / 1e9).toFixed(4),
              totalShares: String(fields.total_shares ?? '0'),
              deployed: (Number(String(fields.deployed_amount ?? '0')) / 1e9).toFixed(4),
              paused: Boolean(fields.paused),
            });
          }
        } catch {
          // Skip vaults we can't read
          results.push({
            vaultId: entry.vaultId,
            adminCapId: entry.adminCapId,
            strategyConfigId: strategyMap.get(entry.vaultId) ?? null,
            balance: '0',
            totalShares: '0',
            deployed: '0',
            paused: false,
          });
        }
      }

      setVaults(results);
    } catch (error) {
      console.error('Error discovering user vaults:', error);
      setVaults([]);
    }
    setLoading(false);
  }, [account, suiClient]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { vaults, loading, refresh };
}
