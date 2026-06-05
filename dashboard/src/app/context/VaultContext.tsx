'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useUserVaults, type UserVault } from '../hooks/useUserVaults';

interface VaultContextType {
  selectedVaultId: string | null;
  setSelectedVaultId: (id: string | null) => void;
  userVaults: UserVault[];
  selectedVault: UserVault | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const VaultContext = createContext<VaultContextType>({
  selectedVaultId: null,
  setSelectedVaultId: () => {},
  userVaults: [],
  selectedVault: null,
  loading: false,
  refresh: async () => {},
});

export function VaultProvider({ children }: { children: ReactNode }) {
  const { vaults, loading, refresh } = useUserVaults();
  const [selectedVaultId, setSelectedVaultId] = useState<string | null>(null);

  // Auto-select first vault when vaults load
  useEffect(() => {
    if (vaults.length > 0 && !selectedVaultId) {
      setSelectedVaultId(vaults[0].vaultId);
    }
    // Clear selection if selected vault no longer exists
    if (selectedVaultId && vaults.length > 0 && !vaults.find(v => v.vaultId === selectedVaultId)) {
      setSelectedVaultId(vaults[0].vaultId);
    }
  }, [vaults, selectedVaultId]);

  const selectedVault = vaults.find(v => v.vaultId === selectedVaultId) ?? null;

  return (
    <VaultContext.Provider
      value={{
        selectedVaultId,
        setSelectedVaultId,
        userVaults: vaults,
        selectedVault,
        loading,
        refresh,
      }}
    >
      {children}
    </VaultContext.Provider>
  );
}

export function useVaultContext() {
  return useContext(VaultContext);
}
