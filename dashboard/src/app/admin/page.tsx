'use client';

import { useState, useEffect, useCallback } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { useToast } from '../components/Toast';
import { useVaultContext } from '../context/VaultContext';

const VAULT_PACKAGE_ID = process.env.NEXT_PUBLIC_VAULT_PACKAGE_ID || '';
const AGENT_ADDRESS = process.env.NEXT_PUBLIC_AGENT_ADDRESS || '';

interface StrategyConfigData {
  maxPositionBps: number;
  stopLossBps: number;
  minTradeIntervalSec: number;
  maxOpenPositions: number;
  allowedPools: string[];
  active: boolean;
}

interface AgentCapData {
  maxTradeSize: string; // MIST as string
  maxDeploymentBps: number;
  active: boolean;
}

interface VaultData {
  balance: string;
  paused: boolean;
}

export default function AdminPage() {
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutate: signAndExecute, isPending } = useSignAndExecuteTransaction();
  const { showToast } = useToast();
  const { selectedVault, userVaults, refresh: refreshVaults } = useVaultContext();

  const [strategyConfig, setStrategyConfig] = useState<StrategyConfigData | null>(null);
  const [agentCap, setAgentCap] = useState<AgentCapData | null>(null);
  const [vaultData, setVaultData] = useState<VaultData | null>(null);
  const [loading, setLoading] = useState(true);
  const [txPending, setTxPending] = useState(false);

  // Form state for strategy params
  const [formMaxPositionBps, setFormMaxPositionBps] = useState('');
  const [formStopLossBps, setFormStopLossBps] = useState('');
  const [formMinTradeInterval, setFormMinTradeInterval] = useState('');
  const [formMaxOpenPositions, setFormMaxOpenPositions] = useState('');

  // Vault creation form state
  const [createMaxPositionBps, setCreateMaxPositionBps] = useState('3000');
  const [createStopLossBps, setCreateStopLossBps] = useState('500');
  const [createMinTradeInterval, setCreateMinTradeInterval] = useState('30');
  const [createMaxOpenPositions, setCreateMaxOpenPositions] = useState('3');
  const [createMaxTradeSize, setCreateMaxTradeSize] = useState('10');
  const [createMaxDeploymentBps, setCreateMaxDeploymentBps] = useState('5000');
  const [creatingVault, setCreatingVault] = useState(false);

  // Find AgentCap for the selected vault (query by vault's agent caps)
  const [agentCapId, setAgentCapId] = useState<string | null>(null);

  const fetchOnChainData = useCallback(async () => {
    if (!selectedVault) {
      setStrategyConfig(null);
      setAgentCap(null);
      setVaultData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // Fetch StrategyConfig
      if (selectedVault.strategyConfigId) {
        const obj = await suiClient.getObject({ id: selectedVault.strategyConfigId, options: { showContent: true } });
        if (obj.data?.content && obj.data.content.dataType === 'moveObject') {
          const fields = obj.data.content.fields as Record<string, unknown>;
          const config: StrategyConfigData = {
            maxPositionBps: Number(String(fields.max_position_bps ?? '0')),
            stopLossBps: Number(String(fields.stop_loss_bps ?? '0')),
            minTradeIntervalSec: Number(String(fields.min_trade_interval_sec ?? '0')),
            maxOpenPositions: Number(String(fields.max_open_positions ?? '0')),
            allowedPools: Array.isArray(fields.allowed_pools) ? (fields.allowed_pools as string[]) : [],
            active: Boolean(fields.active),
          };
          setStrategyConfig(config);
          setFormMaxPositionBps(String(config.maxPositionBps));
          setFormStopLossBps(String(config.stopLossBps));
          setFormMinTradeInterval(String(config.minTradeIntervalSec));
          setFormMaxOpenPositions(String(config.maxOpenPositions));
        }
      } else {
        setStrategyConfig(null);
      }

      // Fetch AgentCap for this vault (search by querying agent authorized events)
      try {
        const events = await suiClient.queryEvents({
          query: {
            MoveEventType: `${VAULT_PACKAGE_ID}::agent_auth::AgentAuthorizedEvent`,
          },
          limit: 50,
          order: 'descending',
        });

        let foundCapId: string | null = null;
        for (const event of events.data) {
          const parsed = event.parsedJson as Record<string, unknown>;
          if (String(parsed.vault_id ?? '') === selectedVault.vaultId) {
            foundCapId = String(parsed.agent_cap_id ?? '');
            break;
          }
        }

        if (foundCapId) {
          setAgentCapId(foundCapId);
          const obj = await suiClient.getObject({ id: foundCapId, options: { showContent: true } });
          if (obj.data?.content && obj.data.content.dataType === 'moveObject') {
            const fields = obj.data.content.fields as Record<string, unknown>;
            setAgentCap({
              maxTradeSize: String(fields.max_trade_size ?? '0'),
              maxDeploymentBps: Number(String(fields.max_deployment_bps ?? '0')),
              active: Boolean(fields.active),
            });
          } else {
            setAgentCap(null);
          }
        } else {
          setAgentCapId(null);
          setAgentCap(null);
        }
      } catch {
        setAgentCapId(null);
        setAgentCap(null);
      }

      // Fetch Vault data
      const vaultObj = await suiClient.getObject({ id: selectedVault.vaultId, options: { showContent: true } });
      if (vaultObj.data?.content && vaultObj.data.content.dataType === 'moveObject') {
        const fields = vaultObj.data.content.fields as Record<string, unknown>;
        setVaultData({
          balance: (Number(String(fields.balance ?? '0')) / 1e9).toFixed(4),
          paused: Boolean(fields.paused),
        });
      }
    } catch (error) {
      console.error('Error fetching on-chain data:', error);
    }
    setLoading(false);
  }, [suiClient, selectedVault]);

  useEffect(() => {
    fetchOnChainData();
    const interval = setInterval(fetchOnChainData, 30000);
    return () => clearInterval(interval);
  }, [fetchOnChainData]);

  const handleCreateVault = async () => {
    if (!account || !VAULT_PACKAGE_ID) {
      showToast('Connect wallet and set VAULT_PACKAGE_ID', 'error');
      return;
    }

    setCreatingVault(true);
    try {
      // TX1: create_vault + create_admin_cap
      const tx1 = new Transaction();

      // Create vault (returns shared object)
      tx1.moveCall({
        target: `${VAULT_PACKAGE_ID}::vault::create_vault`,
        arguments: [],
      });

      showToast('Sign transaction 1/2: Create vault...', 'info');

      const tx1Result = await new Promise<{ digest: string; objectChanges?: any[] }>((resolve, reject) => {
        signAndExecute(
          { transaction: tx1 as any },
          {
            onSuccess: (result) => resolve(result),
            onError: (error) => reject(error),
          },
        );
      });

      // Wait for tx1 to be indexed
      await suiClient.waitForTransaction({ digest: tx1Result.digest });

      // Find the created vault object ID
      const txDetails = await suiClient.getTransactionBlock({
        digest: tx1Result.digest,
        options: { showObjectChanges: true },
      });

      const createdVault = txDetails.objectChanges?.find(
        (change) => change.type === 'created' && change.objectType?.includes('::vault::Vault'),
      );

      if (!createdVault || createdVault.type !== 'created') {
        throw new Error('Could not find created Vault object');
      }

      const newVaultId = createdVault.objectId;
      showToast(`Vault created: ${newVaultId.slice(0, 16)}...`, 'success');

      // TX2: create_admin_cap for the new vault
      const tx2 = new Transaction();
      tx2.moveCall({
        target: `${VAULT_PACKAGE_ID}::agent_auth::create_admin_cap`,
        arguments: [tx2.object(newVaultId)],
      });

      showToast('Sign transaction 2/2: Create admin cap + strategy + authorize agent...', 'info');

      // Also create strategy config
      const maxPosBps = parseInt(createMaxPositionBps) || 3000;
      const stopLoss = parseInt(createStopLossBps) || 500;
      const interval = parseInt(createMinTradeInterval) || 30;
      const maxPos = parseInt(createMaxOpenPositions) || 3;

      // We need the AdminCap from tx2 to create strategy — but we can't use it in the same PTB
      // since create_admin_cap transfers it to sender. So we split into tx2 (admin_cap) and tx3 (strategy + auth).

      const tx2Result = await new Promise<{ digest: string }>((resolve, reject) => {
        signAndExecute(
          { transaction: tx2 as any },
          {
            onSuccess: (result) => resolve(result),
            onError: (error) => reject(error),
          },
        );
      });

      await suiClient.waitForTransaction({ digest: tx2Result.digest });

      // Find the created AdminCap
      const tx2Details = await suiClient.getTransactionBlock({
        digest: tx2Result.digest,
        options: { showObjectChanges: true },
      });

      const createdAdminCap = tx2Details.objectChanges?.find(
        (change) => change.type === 'created' && change.objectType?.includes('::agent_auth::AdminCap'),
      );

      if (!createdAdminCap || createdAdminCap.type !== 'created') {
        throw new Error('Could not find created AdminCap');
      }

      const newAdminCapId = createdAdminCap.objectId;

      // TX3: create_strategy + authorize_agent (both need AdminCap)
      const tx3 = new Transaction();

      // Create strategy
      tx3.moveCall({
        target: `${VAULT_PACKAGE_ID}::strategy::create_strategy`,
        arguments: [
          tx3.object(newAdminCapId),
          tx3.pure.id(newVaultId),
          tx3.pure.u64(maxPosBps),
          tx3.pure.u64(stopLoss),
          tx3.pure.u64(interval),
          tx3.pure.u64(maxPos),
        ],
      });

      // Authorize the agent (if agent address is configured)
      if (AGENT_ADDRESS) {
        const maxTradeSize = BigInt(Math.floor((parseInt(createMaxTradeSize) || 10) * 1e9));
        const maxDeployBps = parseInt(createMaxDeploymentBps) || 5000;

        tx3.moveCall({
          target: `${VAULT_PACKAGE_ID}::agent_auth::authorize_agent`,
          arguments: [
            tx3.object(newAdminCapId),
            tx3.object(newVaultId),
            tx3.pure.address(AGENT_ADDRESS),
            tx3.pure.u64(maxTradeSize),
            tx3.pure.u64(maxDeployBps),
          ],
        });
      }

      const tx3Result = await new Promise<{ digest: string }>((resolve, reject) => {
        signAndExecute(
          { transaction: tx3 as any },
          {
            onSuccess: (result) => resolve(result),
            onError: (error) => reject(error),
          },
        );
      });

      await suiClient.waitForTransaction({ digest: tx3Result.digest });

      showToast('Vault created with strategy and agent authorization!', 'success');
      await refreshVaults();
    } catch (error) {
      console.error('Vault creation error:', error);
      showToast(`Vault creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
    setCreatingVault(false);
  };

  const handleUpdateParams = () => {
    if (!account || !VAULT_PACKAGE_ID || !selectedVault?.adminCapId || !selectedVault?.strategyConfigId) {
      showToast('Missing configuration or no vault selected.', 'error');
      return;
    }

    const maxPosBps = parseInt(formMaxPositionBps);
    const stopLoss = parseInt(formStopLossBps);
    const interval = parseInt(formMinTradeInterval);
    const maxPos = parseInt(formMaxOpenPositions);

    if ([maxPosBps, stopLoss, interval, maxPos].some(isNaN)) {
      showToast('All fields must be valid numbers', 'error');
      return;
    }
    if (maxPosBps > 10000 || stopLoss > 10000) {
      showToast('BPS values cannot exceed 10000', 'error');
      return;
    }

    setTxPending(true);
    const tx = new Transaction();
    tx.moveCall({
      target: `${VAULT_PACKAGE_ID}::strategy::update_params`,
      arguments: [
        tx.object(selectedVault.adminCapId),
        tx.object(selectedVault.strategyConfigId),
        tx.pure.u64(maxPosBps),
        tx.pure.u64(stopLoss),
        tx.pure.u64(interval),
        tx.pure.u64(maxPos),
      ],
    });

    signAndExecute(
      { transaction: tx as any },
      {
        onSuccess: () => {
          setTxPending(false);
          showToast('Strategy parameters updated on-chain', 'success');
          fetchOnChainData();
        },
        onError: (error) => {
          setTxPending(false);
          showToast(`Update failed: ${error.message}`, 'error');
        },
      },
    );
  };

  const handleToggleStrategy = (active: boolean) => {
    if (!account || !VAULT_PACKAGE_ID || !selectedVault?.adminCapId || !selectedVault?.strategyConfigId) return;

    setTxPending(true);
    const tx = new Transaction();
    tx.moveCall({
      target: `${VAULT_PACKAGE_ID}::strategy::set_active`,
      arguments: [
        tx.object(selectedVault.adminCapId),
        tx.object(selectedVault.strategyConfigId),
        tx.pure.bool(active),
      ],
    });

    signAndExecute(
      { transaction: tx as any },
      {
        onSuccess: () => {
          setTxPending(false);
          showToast(`Strategy ${active ? 'activated' : 'deactivated'}`, 'success');
          fetchOnChainData();
        },
        onError: (error) => {
          setTxPending(false);
          showToast(`Toggle failed: ${error.message}`, 'error');
        },
      },
    );
  };

  const handleTogglePause = (pause: boolean) => {
    if (!account || !VAULT_PACKAGE_ID || !selectedVault?.adminCapId || !selectedVault?.vaultId) return;

    setTxPending(true);
    const tx = new Transaction();
    tx.moveCall({
      target: `${VAULT_PACKAGE_ID}::agent_auth::${pause ? 'pause_vault' : 'unpause_vault'}`,
      arguments: [
        tx.object(selectedVault.adminCapId),
        tx.object(selectedVault.vaultId),
      ],
    });

    signAndExecute(
      { transaction: tx as any },
      {
        onSuccess: () => {
          setTxPending(false);
          showToast(`Vault ${pause ? 'paused' : 'unpaused'}`, 'success');
          fetchOnChainData();
        },
        onError: (error) => {
          setTxPending(false);
          showToast(`${pause ? 'Pause' : 'Unpause'} failed: ${error.message}`, 'error');
        },
      },
    );
  };

  if (!account) {
    return (
      <div className="space-y-8">
        <h1 className="text-3xl font-bold">Admin Settings</h1>
        <div className="bg-gray-900 rounded-xl p-12 text-center border border-gray-800">
          <span className="text-4xl mb-4 block">&#x1F512;</span>
          <h2 className="text-xl font-semibold mb-2">Connect Your Wallet</h2>
          <p className="text-gray-400 mb-2 max-w-md mx-auto text-sm">
            Connect the wallet holding the AdminCap to manage agent settings.
          </p>
          <p className="text-gray-600 text-xs">
            Only the vault owner (AdminCap holder) can modify these settings.
          </p>
        </div>
      </div>
    );
  }

  const hasVaults = userVaults.length > 0;
  const hasSelectedVault = !!selectedVault;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Admin Settings</h1>
        <span className="text-xs text-gray-500 font-mono">
          {account.address.slice(0, 10)}...{account.address.slice(-6)}
        </span>
      </div>

      {/* Create Vault Section */}
      <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <h3 className="text-lg font-semibold mb-1">Create New Vault</h3>
        <p className="text-xs text-gray-500 mb-4">
          Create a new vault, configure strategy parameters, and authorize the agent to trade on your behalf.
          {AGENT_ADDRESS && (
            <span className="block mt-1">
              Agent address: <span className="font-mono text-gray-400">{AGENT_ADDRESS.slice(0, 16)}...{AGENT_ADDRESS.slice(-8)}</span>
            </span>
          )}
        </p>

        <div className="grid sm:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Max Position (bps)</label>
            <input
              type="number" min="0" max="10000" step="100"
              value={createMaxPositionBps}
              onChange={(e) => setCreateMaxPositionBps(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sage-500"
              placeholder="3000"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Stop-Loss (bps)</label>
            <input
              type="number" min="0" max="10000" step="50"
              value={createStopLossBps}
              onChange={(e) => setCreateStopLossBps(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sage-500"
              placeholder="500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Trade Interval (sec)</label>
            <input
              type="number" min="0" step="10"
              value={createMinTradeInterval}
              onChange={(e) => setCreateMinTradeInterval(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sage-500"
              placeholder="30"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Max Open Positions</label>
            <input
              type="number" min="1" step="1"
              value={createMaxOpenPositions}
              onChange={(e) => setCreateMaxOpenPositions(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sage-500"
              placeholder="3"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Max Trade Size (SUI)</label>
            <input
              type="number" min="0" step="1"
              value={createMaxTradeSize}
              onChange={(e) => setCreateMaxTradeSize(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sage-500"
              placeholder="10"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Max Deployment (bps)</label>
            <input
              type="number" min="0" max="10000" step="100"
              value={createMaxDeploymentBps}
              onChange={(e) => setCreateMaxDeploymentBps(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sage-500"
              placeholder="5000"
            />
          </div>
        </div>

        <button
          onClick={handleCreateVault}
          disabled={creatingVault || isPending || !VAULT_PACKAGE_ID}
          className="px-6 py-2.5 bg-sage-600 hover:bg-sage-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors"
        >
          {creatingVault ? <Spinner text="Creating Vault..." /> : 'Create Vault'}
        </button>

        {!AGENT_ADDRESS && (
          <p className="text-xs text-yellow-500 mt-2">
            Set NEXT_PUBLIC_AGENT_ADDRESS to auto-authorize the agent during vault creation.
          </p>
        )}
      </div>

      {!hasVaults && (
        <div className="bg-gray-900 rounded-xl p-8 text-center border border-gray-800">
          <p className="text-gray-400 text-sm">No vaults found. Create your first vault above.</p>
        </div>
      )}

      {hasSelectedVault && (
        <>
          {/* Status Cards */}
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <p className="text-sm text-gray-400 mb-1">Vault Status</p>
              {loading ? (
                <p className="text-xl font-bold text-gray-500">Loading...</p>
              ) : (
                <div className="flex items-center justify-between">
                  <p className={`text-xl font-bold ${vaultData?.paused ? 'text-yellow-400' : 'text-sage-400'}`}>
                    {vaultData?.paused ? 'Paused' : 'Active'}
                  </p>
                  <button
                    onClick={() => handleTogglePause(!vaultData?.paused)}
                    disabled={txPending || isPending}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      vaultData?.paused
                        ? 'bg-sage-600 hover:bg-sage-700 text-white'
                        : 'bg-yellow-600 hover:bg-yellow-700 text-white'
                    } disabled:bg-gray-700 disabled:text-gray-500`}
                  >
                    {vaultData?.paused ? 'Unpause' : 'Pause'}
                  </button>
                </div>
              )}
              {vaultData && (
                <p className="text-xs text-gray-500 mt-2">Balance: {vaultData.balance} SUI</p>
              )}
            </div>

            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <p className="text-sm text-gray-400 mb-1">Strategy Status</p>
              {loading ? (
                <p className="text-xl font-bold text-gray-500">Loading...</p>
              ) : strategyConfig ? (
                <div className="flex items-center justify-between">
                  <p className={`text-xl font-bold ${strategyConfig?.active ? 'text-sage-400' : 'text-red-400'}`}>
                    {strategyConfig?.active ? 'Active' : 'Inactive'}
                  </p>
                  <button
                    onClick={() => handleToggleStrategy(!strategyConfig?.active)}
                    disabled={txPending || isPending}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      strategyConfig?.active
                        ? 'bg-red-600 hover:bg-red-700 text-white'
                        : 'bg-sage-600 hover:bg-sage-700 text-white'
                    } disabled:bg-gray-700 disabled:text-gray-500`}
                  >
                    {strategyConfig?.active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              ) : (
                <p className="text-sm text-gray-500">No strategy config</p>
              )}
            </div>

            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <p className="text-sm text-gray-400 mb-1">Agent Cap</p>
              {loading ? (
                <p className="text-xl font-bold text-gray-500">Loading...</p>
              ) : agentCap ? (
                <div>
                  <p className={`text-xl font-bold ${agentCap.active ? 'text-sage-400' : 'text-red-400'}`}>
                    {agentCap.active ? 'Active' : 'Revoked'}
                  </p>
                  <p className="text-xs text-gray-500 mt-2">
                    Max trade: {(Number(agentCap.maxTradeSize) / 1e9).toFixed(2)} SUI
                  </p>
                  <p className="text-xs text-gray-500">
                    Max deploy: {(agentCap.maxDeploymentBps / 100).toFixed(1)}%
                  </p>
                </div>
              ) : (
                <p className="text-sm text-gray-500">Not authorized</p>
              )}
            </div>
          </div>

          {/* Strategy Parameters Form */}
          {selectedVault?.strategyConfigId && (
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <h3 className="text-lg font-semibold mb-1">Strategy Parameters</h3>
              <p className="text-xs text-gray-500 mb-6">
                These values are enforced on-chain. The agent reads them each cycle and the guardian validates trades against them.
              </p>

              <div className="grid sm:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Max Position Size (basis points)
                  </label>
                  <p className="text-xs text-gray-600 mb-2">
                    Maximum % of vault for one trade. 3000 = 30%.
                  </p>
                  <input
                    type="number" min="0" max="10000" step="100"
                    value={formMaxPositionBps}
                    onChange={(e) => setFormMaxPositionBps(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-sage-500 transition-colors"
                    placeholder="3000"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Stop-Loss Threshold (basis points)
                  </label>
                  <p className="text-xs text-gray-600 mb-2">
                    Loss threshold to trigger stop. 500 = 5%.
                  </p>
                  <input
                    type="number" min="0" max="10000" step="50"
                    value={formStopLossBps}
                    onChange={(e) => setFormStopLossBps(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-sage-500 transition-colors"
                    placeholder="500"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Min Trade Interval (seconds)
                  </label>
                  <p className="text-xs text-gray-600 mb-2">
                    Cooldown between trades. Prevents overtrading.
                  </p>
                  <input
                    type="number" min="0" step="10"
                    value={formMinTradeInterval}
                    onChange={(e) => setFormMinTradeInterval(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-sage-500 transition-colors"
                    placeholder="30"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Max Open Positions
                  </label>
                  <p className="text-xs text-gray-600 mb-2">
                    Maximum concurrent open positions allowed.
                  </p>
                  <input
                    type="number" min="1" step="1"
                    value={formMaxOpenPositions}
                    onChange={(e) => setFormMaxOpenPositions(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-sage-500 transition-colors"
                    placeholder="3"
                  />
                </div>
              </div>

              <div className="mt-6 flex items-center gap-4">
                <button
                  onClick={handleUpdateParams}
                  disabled={txPending || isPending}
                  className="px-6 py-2.5 bg-sage-600 hover:bg-sage-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors"
                >
                  {txPending ? <Spinner text="Updating..." /> : 'Update Parameters'}
                </button>
                {strategyConfig && (
                  <span className="text-xs text-gray-500">
                    Current: {strategyConfig.maxPositionBps}bps / {strategyConfig.stopLossBps}bps / {strategyConfig.minTradeIntervalSec}s / {strategyConfig.maxOpenPositions} pos
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Allowed Pools */}
          {strategyConfig && strategyConfig.allowedPools.length > 0 && (
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <h3 className="text-lg font-semibold mb-4">Allowed Pools</h3>
              <div className="space-y-2">
                {strategyConfig.allowedPools.map((pool, i) => (
                  <div key={i} className="flex items-center gap-2 bg-gray-800/50 rounded-lg px-4 py-2">
                    <span className="text-xs font-mono text-gray-300">{pool}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Object IDs Reference */}
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
            <h3 className="text-lg font-semibold mb-4">On-Chain Object IDs</h3>
            <div className="space-y-3 text-sm">
              <IdRow label="Vault" id={selectedVault.vaultId} />
              <IdRow label="Strategy Config" id={selectedVault.strategyConfigId ?? ''} />
              <IdRow label="Agent Cap" id={agentCapId ?? ''} />
              <IdRow label="Admin Cap" id={selectedVault.adminCapId} />
              <IdRow label="Package" id={VAULT_PACKAGE_ID} />
              {AGENT_ADDRESS && <IdRow label="Agent Address" id={AGENT_ADDRESS} />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Spinner({ text }: { text: string }) {
  return (
    <span className="flex items-center justify-center gap-2">
      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      {text}
    </span>
  );
}

function IdRow({ label, id }: { label: string; id: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-400">{label}</span>
      <span className="text-xs font-mono text-gray-500">
        {id ? `${id.slice(0, 16)}...${id.slice(-8)}` : 'Not set'}
      </span>
    </div>
  );
}
