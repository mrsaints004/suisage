'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { useToast } from '../components/Toast';
import { useVaultContext } from '../context/VaultContext';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  config?: {
    maxTradeSize: number;
    maxPositionBps: number;
    stopLossBps: number;
    maxDeploymentBps: number;
    minTradeInterval: number;
    maxOpenPositions: number;
  };
}

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
  performanceFeeBps: number;
  accruedFees: string;
  totalProfit: string;
  totalLoss: string;
  navPerShare: string;
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

  // Performance fee form state
  const [formPerformanceFeeBps, setFormPerformanceFeeBps] = useState('');

  // Vault creation form state
  const [createMaxPositionBps, setCreateMaxPositionBps] = useState('3000');
  const [createStopLossBps, setCreateStopLossBps] = useState('500');
  const [createMinTradeInterval, setCreateMinTradeInterval] = useState('30');
  const [createMaxOpenPositions, setCreateMaxOpenPositions] = useState('3');
  const [createMaxTradeSize, setCreateMaxTradeSize] = useState('10');
  const [createMaxDeploymentBps, setCreateMaxDeploymentBps] = useState('5000');
  const [creatingVault, setCreatingVault] = useState(false);
  const [showCreateConfirm, setShowCreateConfirm] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Smart Setup chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

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
        const rawBalance = fields.balance;
        const balanceVal = typeof rawBalance === 'object' && rawBalance !== null && 'value' in (rawBalance as any)
          ? Number(String((rawBalance as any).value))
          : Number(String(rawBalance ?? '0'));
        const rawDeployed = fields.deployed_amount;
        const deployedVal = typeof rawDeployed === 'object' && rawDeployed !== null && 'value' in (rawDeployed as any)
          ? Number(String((rawDeployed as any).value))
          : Number(String(rawDeployed ?? '0'));
        const totalShares = BigInt(String(fields.total_shares ?? '0'));
        const totalValue = balanceVal + deployedVal;
        const navPerShare = totalShares > BigInt(0)
          ? (BigInt(totalValue) * BigInt(1_000_000_000)) / totalShares
          : BigInt(1_000_000_000);
        const rawFees = fields.accrued_fees;
        const accruedFees = typeof rawFees === 'object' && rawFees !== null && 'value' in (rawFees as any)
          ? Number(String((rawFees as any).value))
          : Number(String(rawFees ?? '0'));
        const perfFeeBps = Number(String(fields.performance_fee_bps ?? '1000'));

        setVaultData({
          balance: (balanceVal / 1e9).toFixed(4),
          paused: Boolean(fields.paused),
          performanceFeeBps: perfFeeBps,
          accruedFees: (accruedFees / 1e9).toFixed(4),
          totalProfit: (Number(String(fields.total_profit ?? '0')) / 1e9).toFixed(4),
          totalLoss: (Number(String(fields.total_loss ?? '0')) / 1e9).toFixed(4),
          navPerShare: (Number(navPerShare) / 1e9).toFixed(6),
        });
        setFormPerformanceFeeBps(String(perfFeeBps));
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

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const sendChatMessage = async (message: string) => {
    if (!message.trim() || chatLoading) return;

    const userMsg: ChatMessage = { role: 'user', content: message };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput('');
    setChatLoading(true);

    try {
      const res = await fetch('/api/chat-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          history: chatMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setChatMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.error || 'Something went wrong.' },
        ]);
      } else {
        setChatMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.reply, config: data.config },
        ]);
      }
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Could not get a response. Please check your connection and try again.' },
      ]);
    }
    setChatLoading(false);
  };

  const applyConfig = (config: NonNullable<ChatMessage['config']>) => {
    setCreateMaxTradeSize(String(config.maxTradeSize));
    setCreateMaxPositionBps(String(config.maxPositionBps));
    setCreateStopLossBps(String(config.stopLossBps));
    setCreateMaxDeploymentBps(String(config.maxDeploymentBps));
    setCreateMinTradeInterval(String(config.minTradeInterval));
    setCreateMaxOpenPositions(String(config.maxOpenPositions));
    setShowAdvanced(true);
    showToast('Settings applied to form. Review and create your vault.', 'success');
  };

  const handleCreateVault = async () => {
    if (!account || !VAULT_PACKAGE_ID) {
      showToast('Connect wallet and set VAULT_PACKAGE_ID', 'error');
      return;
    }

    setCreatingVault(true);
    try {
      // TX1: create_vault (shares vault object)
      const tx1 = new Transaction();
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

      await suiClient.waitForTransaction({ digest: tx1Result.digest });

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

      // TX2: create_admin_cap_returning → create_strategy → authorize_agent → transfer AdminCap
      // All in one PTB using the returned AdminCap
      const tx2 = new Transaction();

      const maxPosBps = parseInt(createMaxPositionBps) || 3000;
      const stopLoss = parseInt(createStopLossBps) || 500;
      const interval = parseInt(createMinTradeInterval) || 30;
      const maxPos = parseInt(createMaxOpenPositions) || 3;

      // create_admin_cap_returning returns AdminCap (not transferred yet)
      const [adminCap] = tx2.moveCall({
        target: `${VAULT_PACKAGE_ID}::agent_auth::create_admin_cap_returning`,
        arguments: [tx2.object(newVaultId)],
      });

      // Create strategy (authorized by tx sender, not AdminCap)
      tx2.moveCall({
        target: `${VAULT_PACKAGE_ID}::strategy::create_strategy`,
        arguments: [
          tx2.pure.id(newVaultId),
          tx2.pure.u64(maxPosBps),
          tx2.pure.u64(stopLoss),
          tx2.pure.u64(interval),
          tx2.pure.u64(maxPos),
        ],
      });

      // Authorize the agent (if agent address is configured)
      if (AGENT_ADDRESS) {
        const maxTradeSize = BigInt(Math.floor((parseInt(createMaxTradeSize) || 10) * 1e9));
        const maxDeployBps = parseInt(createMaxDeploymentBps) || 5000;

        tx2.moveCall({
          target: `${VAULT_PACKAGE_ID}::agent_auth::authorize_agent`,
          arguments: [
            adminCap,
            tx2.object(newVaultId),
            tx2.pure.address(AGENT_ADDRESS),
            tx2.pure.u64(maxTradeSize),
            tx2.pure.u64(maxDeployBps),
          ],
        });
      }

      // Transfer AdminCap to sender
      tx2.transferObjects([adminCap], tx2.pure.address(account.address));

      showToast('Sign transaction 2/2: Create admin cap + strategy + authorize agent...', 'info');

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

      showToast('Vault created with strategy and agent authorization!', 'success');
      await refreshVaults();
    } catch (error) {
      console.error('Vault creation error:', error);
      showToast(`Vault creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
    setCreatingVault(false);
  };

  const handleUpdateParams = () => {
    if (!account || !VAULT_PACKAGE_ID || !selectedVault?.strategyConfigId) {
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
    if (!account || !VAULT_PACKAGE_ID || !selectedVault?.strategyConfigId) return;

    setTxPending(true);
    const tx = new Transaction();
    tx.moveCall({
      target: `${VAULT_PACKAGE_ID}::strategy::set_active`,
      arguments: [
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

  const handleSetPerformanceFee = () => {
    if (!account || !VAULT_PACKAGE_ID || !selectedVault?.adminCapId || !selectedVault?.vaultId) return;

    const feeBps = parseInt(formPerformanceFeeBps);
    if (isNaN(feeBps) || feeBps < 0 || feeBps > 5000) {
      showToast('Fee must be between 0 and 5000 bps (0-50%)', 'error');
      return;
    }

    setTxPending(true);
    const tx = new Transaction();
    tx.moveCall({
      target: `${VAULT_PACKAGE_ID}::agent_auth::set_performance_fee`,
      arguments: [
        tx.object(selectedVault.adminCapId),
        tx.object(selectedVault.vaultId),
        tx.pure.u64(feeBps),
      ],
    });

    signAndExecute(
      { transaction: tx as any },
      {
        onSuccess: () => {
          setTxPending(false);
          showToast(`Performance fee set to ${(feeBps / 100).toFixed(1)}%`, 'success');
          fetchOnChainData();
        },
        onError: (error) => {
          setTxPending(false);
          showToast(`Set fee failed: ${error.message}`, 'error');
        },
      },
    );
  };

  const handleWithdrawFees = () => {
    if (!account || !VAULT_PACKAGE_ID || !selectedVault?.adminCapId || !selectedVault?.vaultId) return;

    setTxPending(true);
    const tx = new Transaction();
    tx.moveCall({
      target: `${VAULT_PACKAGE_ID}::agent_auth::withdraw_fees`,
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
          showToast('Fees withdrawn successfully', 'success');
          fetchOnChainData();
        },
        onError: (error) => {
          setTxPending(false);
          showToast(`Withdraw fees failed: ${error.message}`, 'error');
        },
      },
    );
  };

  if (!account) {
    return (
      <div className="space-y-8">
        <h1 className="text-3xl font-bold">Admin Settings</h1>
        <div className="bg-gray-900 rounded-xl p-12 text-center border border-gray-800">
          <svg className="w-12 h-12 mx-auto mb-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
          <h2 className="text-xl font-semibold mb-2">Connect Your Wallet</h2>
          <p className="text-gray-400 mb-2 max-w-md mx-auto text-sm">
            Connect the wallet holding the AdminCap to manage vault settings.
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

      {/* Smart Setup Assistant */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <button
          onClick={() => setChatOpen(!chatOpen)}
          className="w-full flex items-center justify-between p-5 hover:bg-gray-800/30 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-sage-900/60 flex items-center justify-center">
              <svg className="w-5 h-5 text-sage-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
              </svg>
            </div>
            <div className="text-left">
              <h3 className="text-base font-semibold">Smart Setup</h3>
              <p className="text-xs text-gray-500">Describe your goals and get recommended vault settings</p>
            </div>
          </div>
          <svg className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${chatOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        {chatOpen && (
          <div className="border-t border-gray-800">
            {/* Quick presets */}
            <div className="px-5 pt-4 pb-2">
              <p className="text-xs text-gray-500 mb-3">Choose a preset or describe what you want:</p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => sendChatMessage('I want conservative trading with small trades and tight risk controls. Safety is my priority.')}
                  disabled={chatLoading}
                  className="px-3.5 py-2 bg-gray-800 border border-gray-700 text-gray-300 rounded-lg text-xs font-medium hover:border-sage-600/50 hover:text-sage-400 transition-all disabled:opacity-50"
                >
                  <span className="flex items-center gap-1.5">
                    <svg className="w-3 h-3 text-green-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm-1-11H7v2h4v4h2v-4h4v-2h-4V7h-2v4z"/></svg>
                    Conservative
                  </span>
                </button>
                <button
                  onClick={() => sendChatMessage('I want a balanced moderate approach. Not too risky, not too cautious.')}
                  disabled={chatLoading}
                  className="px-3.5 py-2 bg-gray-800 border border-gray-700 text-gray-300 rounded-lg text-xs font-medium hover:border-sage-600/50 hover:text-sage-400 transition-all disabled:opacity-50"
                >
                  <span className="flex items-center gap-1.5">
                    <svg className="w-3 h-3 text-blue-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm-1-11H7v2h4v4h2v-4h4v-2h-4V7h-2v4z"/></svg>
                    Moderate
                  </span>
                </button>
                <button
                  onClick={() => sendChatMessage('I want aggressive trading. Maximize opportunities, larger positions, more trades.')}
                  disabled={chatLoading}
                  className="px-3.5 py-2 bg-gray-800 border border-gray-700 text-gray-300 rounded-lg text-xs font-medium hover:border-sage-600/50 hover:text-sage-400 transition-all disabled:opacity-50"
                >
                  <span className="flex items-center gap-1.5">
                    <svg className="w-3 h-3 text-orange-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm-1-11H7v2h4v4h2v-4h4v-2h-4V7h-2v4z"/></svg>
                    Aggressive
                  </span>
                </button>
              </div>
            </div>

            {/* Conversation */}
            {chatMessages.length > 0 && (
              <div className="max-h-96 overflow-y-auto px-5 py-3 space-y-3 scroll-smooth">
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className="max-w-[85%] space-y-2">
                      <div
                        className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
                          msg.role === 'user'
                            ? 'bg-sage-600/15 text-gray-200 rounded-br-md'
                            : 'bg-gray-800/80 text-gray-300 rounded-bl-md'
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      </div>
                      {msg.config && (
                        <div className="bg-gray-800/60 border border-gray-700/60 rounded-xl p-4">
                          <div className="flex items-center justify-between mb-3">
                            <p className="text-xs font-medium text-gray-300">Suggested Settings</p>
                            <button
                              onClick={() => applyConfig(msg.config!)}
                              className="px-3 py-1 bg-sage-600 hover:bg-sage-700 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                              </svg>
                              Apply to Form
                            </button>
                          </div>
                          <div className="grid grid-cols-3 gap-x-4 gap-y-2">
                            <ConfigValue label="Max Trade" value={`${msg.config.maxTradeSize} SUI`} />
                            <ConfigValue label="Position" value={`${(msg.config.maxPositionBps / 100).toFixed(0)}%`} />
                            <ConfigValue label="Stop-Loss" value={`${(msg.config.stopLossBps / 100).toFixed(0)}%`} />
                            <ConfigValue label="Deployed" value={`${(msg.config.maxDeploymentBps / 100).toFixed(0)}%`} />
                            <ConfigValue label="Cooldown" value={`${msg.config.minTradeInterval}s`} />
                            <ConfigValue label="Max Trades" value={`${msg.config.maxOpenPositions}`} />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-gray-800/80 rounded-xl rounded-bl-md px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            )}

            {/* Input */}
            <div className="px-5 pb-4 pt-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendChatMessage(chatInput)}
                  placeholder="Describe your trading preferences..."
                  className="flex-1 bg-gray-800/60 border border-gray-700/80 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-sage-600/60 focus:ring-1 focus:ring-sage-600/20 transition-all"
                  disabled={chatLoading}
                />
                <button
                  onClick={() => sendChatMessage(chatInput)}
                  disabled={chatLoading || !chatInput.trim()}
                  className="px-4 py-2.5 bg-sage-600 hover:bg-sage-700 disabled:bg-gray-800 disabled:text-gray-600 rounded-xl text-sm font-medium transition-all"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Create Vault Section */}
      <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <h3 className="text-lg font-semibold mb-1">Create New Vault</h3>
        <p className="text-sm text-gray-400 mb-4">
          Set up your trading vault with on-chain safety limits. All limits are enforced by smart contracts and cannot be exceeded.
        </p>

        {/* Defaults summary */}
        <div className="bg-gray-800/50 rounded-lg p-4 mb-4 border border-gray-700/50">
          <p className="text-xs text-gray-400 mb-2 font-medium">Default safety limits (recommended for getting started)</p>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-center">
            <div>
              <p className="text-sm font-bold text-white">10 SUI</p>
              <p className="text-[10px] text-gray-500">Max trade</p>
            </div>
            <div>
              <p className="text-sm font-bold text-white">30%</p>
              <p className="text-[10px] text-gray-500">Position</p>
            </div>
            <div>
              <p className="text-sm font-bold text-white">5%</p>
              <p className="text-[10px] text-gray-500">Stop-loss</p>
            </div>
            <div>
              <p className="text-sm font-bold text-white">50%</p>
              <p className="text-[10px] text-gray-500">Deployed</p>
            </div>
            <div>
              <p className="text-sm font-bold text-white">30s</p>
              <p className="text-[10px] text-gray-500">Cooldown</p>
            </div>
            <div>
              <p className="text-sm font-bold text-white">3</p>
              <p className="text-[10px] text-gray-500">Max trades</p>
            </div>
          </div>
        </div>

        {/* Toggle for advanced settings */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-xs text-sage-400 hover:text-sage-300 transition-colors mb-4 flex items-center gap-1"
        >
          <span className={`transition-transform inline-block ${showAdvanced ? 'rotate-90' : ''}`}>&#x25B6;</span>
          {showAdvanced ? 'Hide advanced settings' : 'Customize safety limits'}
        </button>

        {/* Advanced Settings (collapsible) */}
        {showAdvanced && (
          <>
            <div className="mb-6">
              <h4 className="text-sm font-medium text-gray-300 mb-3">Safety Limits</h4>
              <div className="grid sm:grid-cols-2 gap-4">
                <FormField
                  label="Max Trade Size"
                  hint="The most SUI the agent can trade in a single order."
                  suffix="SUI"
                  value={createMaxTradeSize}
                  onChange={setCreateMaxTradeSize}
                  min={1} max={1000} step={1}
                  placeholder="10"
                />
                <FormField
                  label="Max Position Size"
                  hint="Largest portion of your vault the agent can put into one trade."
                  suffix="%"
                  value={String(parseInt(createMaxPositionBps) / 100 || 30)}
                  onChange={(v) => setCreateMaxPositionBps(String(Math.round(parseFloat(v) * 100)))}
                  min={1} max={100} step={1}
                  placeholder="30"
                />
                <FormField
                  label="Stop-Loss Trigger"
                  hint="If a position drops by this much, the agent will cut losses."
                  suffix="%"
                  value={String(parseInt(createStopLossBps) / 100 || 5)}
                  onChange={(v) => setCreateStopLossBps(String(Math.round(parseFloat(v) * 100)))}
                  min={1} max={50} step={1}
                  placeholder="5"
                />
                <FormField
                  label="Max Vault Deployed"
                  hint="Maximum portion of your vault the agent can have actively trading at once."
                  suffix="%"
                  value={String(parseInt(createMaxDeploymentBps) / 100 || 50)}
                  onChange={(v) => setCreateMaxDeploymentBps(String(Math.round(parseFloat(v) * 100)))}
                  min={1} max={100} step={1}
                  placeholder="50"
                />
              </div>
            </div>

            <div className="mb-6">
              <h4 className="text-sm font-medium text-gray-300 mb-3">Trading Behavior</h4>
              <div className="grid sm:grid-cols-2 gap-4">
                <FormField
                  label="Cooldown Between Trades"
                  hint="Minimum wait time between trades. Prevents overtrading."
                  suffix="seconds"
                  value={createMinTradeInterval}
                  onChange={setCreateMinTradeInterval}
                  min={10} step={10}
                  placeholder="30"
                />
                <FormField
                  label="Max Simultaneous Trades"
                  hint="How many open positions the agent can hold at the same time."
                  suffix="trades"
                  value={createMaxOpenPositions}
                  onChange={setCreateMaxOpenPositions}
                  min={1} max={10} step={1}
                  placeholder="3"
                />
              </div>
            </div>
          </>
        )}

        <button
          onClick={() => setShowCreateConfirm(true)}
          disabled={creatingVault || isPending || !VAULT_PACKAGE_ID || hasVaults}
          className="px-6 py-3 bg-sage-600 hover:bg-sage-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors text-sm"
        >
          {creatingVault ? <Spinner text="Creating Vault..." /> : hasVaults ? 'Vault Already Created' : 'Create Vault'}
        </button>
        {hasVaults && (
          <p className="text-xs text-gray-500 mt-2">
            You already have a vault. Deposit SUI into your existing vault from the Portfolio page.
          </p>
        )}

        {AGENT_ADDRESS && (
          <p className="text-xs text-gray-500 mt-3">
            The SuiSage agent will be automatically authorized to trade for this vault.
          </p>
        )}
        {!AGENT_ADDRESS && (
          <p className="text-xs text-yellow-500 mt-3">
            Set NEXT_PUBLIC_AGENT_ADDRESS to auto-authorize the agent during vault creation.
          </p>
        )}

        {/* Confirmation Modal */}
        {showCreateConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
              <h3 className="text-lg font-semibold mb-2">Confirm Vault Creation</h3>
              <p className="text-sm text-gray-400 mb-4">
                This will require <span className="text-white font-medium">2 wallet signatures</span>:
              </p>
              <ol className="text-sm text-gray-400 space-y-2 mb-6 list-decimal list-inside">
                <li>Create the vault on-chain</li>
                <li>Create admin cap, strategy config, and authorize the agent</li>
              </ol>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowCreateConfirm(false)}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { setShowCreateConfirm(false); handleCreateVault(); }}
                  className="px-4 py-2 bg-sage-600 hover:bg-sage-700 rounded-lg text-sm font-medium transition-colors"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {!hasVaults && (
        <div className="bg-gray-900 rounded-xl p-8 text-center border border-gray-800">
          <svg className="w-10 h-10 mx-auto mb-3 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" /></svg>
          <h3 className="text-lg font-semibold mb-1">No Vaults Yet</h3>
          <p className="text-gray-400 text-sm mb-1">Create your first vault above to get started.</p>
          <p className="text-gray-600 text-xs">The agent will be automatically authorized with the safety limits you configure.</p>
        </div>
      )}

      {hasVaults && !hasSelectedVault && (
        <div className="bg-gray-900 rounded-xl p-8 text-center border border-gray-800">
          <svg className="w-10 h-10 mx-auto mb-3 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" /></svg>
          <h3 className="text-lg font-semibold mb-1">Select a Vault</h3>
          <p className="text-gray-400 text-sm">Use the vault selector in the navigation bar to choose which vault to manage.</p>
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

          {/* Performance Fee & Vault Economics */}
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
            <h3 className="text-lg font-semibold mb-1">Vault Performance</h3>
            <p className="text-sm text-gray-400 mb-6">
              Track your vault's profits and manage the performance fee. The fee is only charged on new profits — never on your principal.
            </p>

            <div className="grid sm:grid-cols-4 gap-4 mb-6">
              <div className="bg-gray-800/50 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1">Share Value</p>
                <p className="text-lg font-bold">{vaultData?.navPerShare ?? '--'}</p>
                <p className="text-xs text-gray-600">1.0 = starting value</p>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1">Total Profit</p>
                <p className="text-lg font-bold text-green-400">{vaultData?.totalProfit ?? '--'} SUI</p>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1">Total Loss</p>
                <p className="text-lg font-bold text-red-400">{vaultData?.totalLoss ?? '--'} SUI</p>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1">Fees Earned</p>
                <p className="text-lg font-bold">{vaultData?.accruedFees ?? '--'} SUI</p>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Performance Fee</label>
                <p className="text-xs text-gray-500 mb-2">
                  Percentage of profits taken as a fee. Only charged on gains above the previous high.
                </p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="number" min="0" max="50" step="1"
                      value={String(parseInt(formPerformanceFeeBps) / 100 || '')}
                      onChange={(e) => setFormPerformanceFeeBps(String(Math.round(parseFloat(e.target.value) * 100)))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 pr-8 text-white focus:outline-none focus:border-sage-500 transition-colors"
                      placeholder="10"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">%</span>
                  </div>
                  <button
                    onClick={handleSetPerformanceFee}
                    disabled={txPending || isPending}
                    className="px-4 py-2.5 bg-sage-600 hover:bg-sage-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium text-sm transition-colors"
                  >
                    Update
                  </button>
                </div>
                {vaultData && (
                  <p className="text-xs text-gray-500 mt-1">
                    Currently: {(vaultData.performanceFeeBps / 100).toFixed(1)}%
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Collect Fees</label>
                <p className="text-xs text-gray-500 mb-2">
                  Transfer earned performance fees to your wallet.
                </p>
                <button
                  onClick={handleWithdrawFees}
                  disabled={txPending || isPending || !vaultData || vaultData.accruedFees === '0.0000'}
                  className="px-6 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 rounded-lg font-medium text-sm transition-colors"
                >
                  {txPending ? <Spinner text="Collecting..." /> : `Collect ${vaultData?.accruedFees ?? '0'} SUI`}
                </button>
              </div>
            </div>
          </div>

          {/* Strategy Parameters Form */}
          {selectedVault?.strategyConfigId && (
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <h3 className="text-lg font-semibold mb-1">Strategy Settings</h3>
              <p className="text-sm text-gray-400 mb-6">
                Adjust the agent's trading rules. Changes take effect on the next trading cycle. All limits are enforced by the smart contract.
              </p>

              <div className="grid sm:grid-cols-2 gap-4">
                <FormField
                  label="Max Position Size"
                  hint="Largest portion of your vault the agent can put into one trade."
                  suffix="%"
                  value={String(parseInt(formMaxPositionBps) / 100 || '')}
                  onChange={(v) => setFormMaxPositionBps(String(Math.round(parseFloat(v) * 100)))}
                  min={1} max={100} step={1}
                  placeholder="30"
                />
                <FormField
                  label="Stop-Loss Trigger"
                  hint="If a position drops by this much, the agent will cut losses."
                  suffix="%"
                  value={String(parseInt(formStopLossBps) / 100 || '')}
                  onChange={(v) => setFormStopLossBps(String(Math.round(parseFloat(v) * 100)))}
                  min={1} max={50} step={1}
                  placeholder="5"
                />
                <FormField
                  label="Cooldown Between Trades"
                  hint="Minimum wait time between trades. Prevents the agent from overtrading."
                  suffix="seconds"
                  value={formMinTradeInterval}
                  onChange={setFormMinTradeInterval}
                  min={10} step={10}
                  placeholder="30"
                />
                <FormField
                  label="Max Simultaneous Trades"
                  hint="How many open positions the agent can hold at the same time."
                  suffix="trades"
                  value={formMaxOpenPositions}
                  onChange={setFormMaxOpenPositions}
                  min={1} max={10} step={1}
                  placeholder="3"
                />
              </div>

              <div className="mt-6 flex items-center gap-4">
                <button
                  onClick={handleUpdateParams}
                  disabled={txPending || isPending}
                  className="px-6 py-2.5 bg-sage-600 hover:bg-sage-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors text-sm"
                >
                  {txPending ? <Spinner text="Updating..." /> : 'Save Changes'}
                </button>
                {strategyConfig && (
                  <span className="text-xs text-gray-500">
                    Current: {(strategyConfig.maxPositionBps / 100).toFixed(0)}% position / {(strategyConfig.stopLossBps / 100).toFixed(0)}% stop-loss / {strategyConfig.minTradeIntervalSec}s cooldown / {strategyConfig.maxOpenPositions} max trades
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

function FormField({
  label,
  hint,
  suffix,
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
}: {
  label: string;
  hint: string;
  suffix: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder: string;
}) {
  return (
    <div>
      <label className="block text-sm text-gray-300 mb-1">{label}</label>
      <p className="text-xs text-gray-500 mb-2">{hint}</p>
      <div className="relative">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 pr-16 text-sm text-white focus:outline-none focus:border-sage-500 transition-colors"
          placeholder={placeholder}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">{suffix}</span>
      </div>
    </div>
  );
}

function ConfigValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
      <span className="text-sm text-white font-medium">{value}</span>
    </div>
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
