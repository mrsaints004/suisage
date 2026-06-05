'use client';

import { useVaultContext } from '../context/VaultContext';
import { useCurrentAccount } from '@mysten/dapp-kit';

export function VaultSelector() {
  const account = useCurrentAccount();
  const { userVaults, selectedVaultId, setSelectedVaultId, loading } = useVaultContext();

  if (!account) return null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 rounded-lg text-xs text-gray-400">
        <span className="w-3 h-3 border-2 border-gray-600 border-t-gray-300 rounded-full animate-spin" />
        Loading vaults...
      </div>
    );
  }

  if (userVaults.length === 0) {
    return (
      <div className="px-3 py-1.5 bg-gray-800/50 rounded-lg text-xs text-gray-500 border border-gray-700/50">
        No vaults
      </div>
    );
  }

  return (
    <select
      value={selectedVaultId ?? ''}
      onChange={(e) => setSelectedVaultId(e.target.value || null)}
      className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-sage-500 transition-colors max-w-[200px]"
    >
      {userVaults.map((vault) => (
        <option key={vault.vaultId} value={vault.vaultId}>
          Vault {vault.vaultId.slice(0, 8)}... ({vault.balance} SUI)
        </option>
      ))}
    </select>
  );
}
