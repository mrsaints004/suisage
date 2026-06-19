'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { useVaultContext } from '../context/VaultContext';
import { useToast } from '../components/Toast';

const VAULT_PACKAGE_ID = process.env.NEXT_PUBLIC_VAULT_PACKAGE_ID || '';
const AGENT_ADDRESS = process.env.NEXT_PUBLIC_AGENT_ADDRESS || '';
const SUI_NETWORK = process.env.NEXT_PUBLIC_SUI_NETWORK || 'testnet';

interface AgentCapData {
  maxTradeSize: string;
  maxDeploymentBps: number;
  active: boolean;
}

interface StrategyConfigData {
  maxPositionBps: number;
  stopLossBps: number;
  minTradeIntervalSec: number;
  maxOpenPositions: number;
  active: boolean;
}

interface BlockedTrade {
  tradeType: number;
  amount: string;
  price: string;
  timestampMs: string;
  txDigest: string;
  confidence: number;
}

const TRADE_TYPE_MAP: Record<number, string> = {
  0: 'BUY',
  1: 'SELL',
  2: 'REBALANCE',
};

const TS_CHECKS = [
  { name: 'Trade Size', desc: 'Amount <= max_trade_size' },
  { name: 'Deployment %', desc: 'Total deployed <= max_deployment_bps' },
  { name: 'Cooldown', desc: 'Time since last trade >= min_interval' },
  { name: 'Position Concentration', desc: 'Single position <= max_position_bps' },
  { name: 'Stop-Loss', desc: 'Check unrealized loss vs stop_loss_bps' },
  { name: 'Max Open Positions', desc: 'Open positions < max_open_positions' },
  { name: 'Strategy Active', desc: 'Strategy config is active' },
  { name: 'Vault Not Paused', desc: 'Vault pause flag is false' },
];

const MOVE_CHECKS = [
  { name: 'validate_trade_size', module: 'agent_auth' },
  { name: 'validate_deployment', module: 'agent_auth' },
  { name: 'validate_cooldown', module: 'strategy' },
  { name: 'validate_position_size', module: 'strategy' },
  { name: 'validate_max_positions', module: 'strategy' },
  { name: 'check_agent_active', module: 'agent_auth' },
  { name: 'check_vault_not_paused', module: 'vault' },
];

export default function GuardianPage() {
  const suiClient = useSuiClient();
  const { selectedVault } = useVaultContext();
  const { showToast } = useToast();

  const [agentCap, setAgentCap] = useState<AgentCapData | null>(null);
  const [strategyConfig, setStrategyConfig] = useState<StrategyConfigData | null>(null);
  const [agentCapId, setAgentCapId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Simulation state
  const [simAmount, setSimAmount] = useState('');
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState<{
    status: 'idle' | 'success' | 'error';
    message: string;
    errorCode?: string;
  }>({ status: 'idle', message: '' });

  // Blocked trades
  const [blockedTrades, setBlockedTrades] = useState<BlockedTrade[]>([]);
  const [loadingBlocked, setLoadingBlocked] = useState(true);

  // Fetch on-chain data
  const fetchData = useCallback(async () => {
    if (!selectedVault || !VAULT_PACKAGE_ID) {
      setAgentCap(null);
      setStrategyConfig(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // Fetch StrategyConfig
      if (selectedVault.strategyConfigId) {
        const obj = await suiClient.getObject({
          id: selectedVault.strategyConfigId,
          options: { showContent: true },
        });
        if (obj.data?.content && obj.data.content.dataType === 'moveObject') {
          const fields = obj.data.content.fields as Record<string, unknown>;
          setStrategyConfig({
            maxPositionBps: Number(String(fields.max_position_bps ?? '0')),
            stopLossBps: Number(String(fields.stop_loss_bps ?? '0')),
            minTradeIntervalSec: Number(String(fields.min_trade_interval_sec ?? '0')),
            maxOpenPositions: Number(String(fields.max_open_positions ?? '0')),
            active: Boolean(fields.active),
          });
        }
      }

      // Fetch AgentCap
      try {
        const events = await suiClient.queryEvents({
          query: { MoveEventType: `${VAULT_PACKAGE_ID}::agent_auth::AgentAuthorizedEvent` },
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
          }
        } else {
          setAgentCapId(null);
          setAgentCap(null);
        }
      } catch {
        setAgentCapId(null);
        setAgentCap(null);
      }
    } catch (error) {
      console.error('Error fetching guardian data:', error);
    }
    setLoading(false);
  }, [suiClient, selectedVault]);

  // Fetch blocked trades
  const fetchBlockedTrades = useCallback(async () => {
    if (!VAULT_PACKAGE_ID) {
      setBlockedTrades([]);
      setLoadingBlocked(false);
      return;
    }

    try {
      const events = await suiClient.queryEvents({
        query: { MoveEventType: `${VAULT_PACKAGE_ID}::agent_auth::TradeRecordEvent` },
        limit: 50,
        order: 'descending',
      });

      const blocked: BlockedTrade[] = [];
      for (const ev of events.data) {
        const fields = ev.parsedJson as Record<string, unknown>;
        if (!Boolean(fields.guardian_approved)) {
          blocked.push({
            tradeType: Number(fields.trade_type),
            amount: String(fields.amount),
            price: String(fields.price),
            timestampMs: String(fields.timestamp_ms),
            txDigest: ev.id.txDigest,
            confidence: Number(fields.confidence ?? 0),
          });
        }
      }
      setBlockedTrades(blocked);
    } catch {
      setBlockedTrades([]);
    }
    setLoadingBlocked(false);
  }, [suiClient]);

  useEffect(() => {
    fetchData();
    fetchBlockedTrades();
    const interval = setInterval(() => {
      fetchData();
      fetchBlockedTrades();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchData, fetchBlockedTrades]);

  const maxTradeSui = agentCap ? Number(agentCap.maxTradeSize) / 1e9 : 0;

  // Simulate over-budget trade via devInspectTransactionBlock
  const handleSimulate = async (overBudget: boolean) => {
    if (!agentCapId || !VAULT_PACKAGE_ID) {
      showToast('No AgentCap found. Create a vault first.', 'error');
      return;
    }

    const amount = overBudget
      ? BigInt(Math.floor((maxTradeSui + 50) * 1e9))
      : BigInt(Math.floor((maxTradeSui * 0.5) * 1e9));

    setSimulating(true);
    setSimResult({ status: 'idle', message: '' });

    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${VAULT_PACKAGE_ID}::agent_auth::validate_trade_size`,
        arguments: [
          tx.object(agentCapId),
          tx.pure.u64(amount),
        ],
      });

      const result = await suiClient.devInspectTransactionBlock({
        transactionBlock: tx as any,
        sender: AGENT_ADDRESS || '0x0000000000000000000000000000000000000000000000000000000000000000',
      });

      if (result.effects.status.status === 'success') {
        setSimResult({
          status: 'success',
          message: `Trade of ${(Number(amount) / 1e9).toFixed(2)} SUI passed. Within the ${maxTradeSui.toFixed(2)} SUI limit.`,
        });
        showToast('Validation passed -- trade is within budget', 'success');
      } else {
        const errorMsg = result.effects.status.error || 'Transaction aborted';
        const abortMatch = errorMsg.match(/MoveAbort.*?(\d+)/);
        const errorCode = abortMatch ? abortMatch[1] : undefined;

        setSimResult({
          status: 'error',
          message: `Move contract rejected ${(Number(amount) / 1e9).toFixed(2)} SUI. On-chain limit is ${maxTradeSui.toFixed(2)} SUI.`,
          errorCode: errorCode ? `ETradeExceedsLimit (code ${errorCode})` : errorMsg,
        });
        showToast('Guardian blocked -- Move contract rejected the trade', 'info');
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      setSimResult({
        status: 'error',
        message: `Move contract rejected: ${errMsg}`,
        errorCode: errMsg.includes('MoveAbort') ? errMsg : undefined,
      });
      showToast('Guardian enforcement confirmed -- trade blocked', 'info');
    }

    setSimulating(false);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Guardian Enforcement</h1>
        <p className="text-gray-400 mt-2 max-w-2xl">
          Every trade must pass Move smart contract validations on-chain.
          These checks cannot be bypassed, even by the agent operator. Try it yourself below.
        </p>
      </div>

      {/* On-Chain Limits */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Current On-Chain Limits</h2>
        {loading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <div className="skeleton h-3 w-20 mb-3" />
                <div className="skeleton h-7 w-16" />
              </div>
            ))}
          </div>
        ) : !agentCap && !strategyConfig ? (
          <div className="bg-gray-900 rounded-xl p-8 text-center border border-gray-800">
            <p className="text-gray-400 text-sm">No vault selected or no agent authorized.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <LimitCard
              label="Max Trade Size"
              value={agentCap ? `${(Number(agentCap.maxTradeSize) / 1e9).toFixed(2)} SUI` : '--'}
              source="AgentCap.max_trade_size"
              active={!!agentCap?.active}
            />
            <LimitCard
              label="Max Deployment"
              value={agentCap ? `${(agentCap.maxDeploymentBps / 100).toFixed(1)}%` : '--'}
              source="AgentCap.max_deployment_bps"
              active={!!agentCap?.active}
            />
            <LimitCard
              label="Cooldown Period"
              value={strategyConfig ? `${strategyConfig.minTradeIntervalSec}s` : '--'}
              source="StrategyConfig.min_trade_interval_sec"
              active={!!strategyConfig?.active}
            />
            <LimitCard
              label="Max Position"
              value={strategyConfig ? `${(strategyConfig.maxPositionBps / 100).toFixed(1)}%` : '--'}
              source="StrategyConfig.max_position_bps"
              active={!!strategyConfig?.active}
            />
          </div>
        )}
      </div>

      {/* Simulator */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <h2 className="text-lg font-semibold mb-1">Try to Break the Guardian</h2>
        <p className="text-sm text-gray-400 mb-5">
          Simulate a trade using devInspectTransactionBlock to see the Move contract accept or reject it.
        </p>

        {!agentCapId ? (
          <p className="text-gray-500 text-sm py-4">
            No AgentCap found. Create a vault with an authorized agent in the Admin page first.
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-300 mb-1">Trade Amount (SUI)</label>
              <p className="text-xs text-gray-500 mb-2">
                On-chain limit: <span className="text-white font-mono">{maxTradeSui.toFixed(2)} SUI</span>
              </p>
              <div className="relative max-w-sm">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={simAmount}
                  onChange={(e) => setSimAmount(e.target.value)}
                  placeholder={`e.g. ${(maxTradeSui + 50).toFixed(0)}`}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 pr-12 text-white focus:outline-none focus:border-sage-500 transition-colors"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">SUI</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => handleSimulate(true)}
                disabled={simulating}
                className="px-5 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 rounded-lg font-medium text-sm transition-colors"
              >
                {simulating ? <Spinner /> : 'Simulate Over-Budget Trade'}
              </button>
              <button
                onClick={() => handleSimulate(false)}
                disabled={simulating}
                className="px-5 py-2.5 bg-sage-600 hover:bg-sage-700 disabled:bg-gray-800 disabled:text-gray-500 rounded-lg font-medium text-sm transition-colors"
              >
                {simulating ? <Spinner /> : 'Try Within Budget'}
              </button>
            </div>

            {/* Result */}
            {simResult.status !== 'idle' && (
              <div className={`rounded-lg border p-4 ${
                simResult.status === 'error'
                  ? 'bg-red-950/20 border-red-900/30'
                  : 'bg-sage-950/20 border-sage-900/30'
              }`}>
                <p className={`text-sm font-medium mb-1 ${
                  simResult.status === 'error' ? 'text-red-400' : 'text-sage-400'
                }`}>
                  {simResult.status === 'error' ? 'Blocked by Move Contract' : 'Passed Validation'}
                </p>
                <p className="text-sm text-gray-300">{simResult.message}</p>
                {simResult.errorCode && (
                  <code className="block text-xs text-red-400 font-mono mt-2 bg-gray-950/50 rounded p-2 border border-gray-800">
                    {simResult.errorCode}
                  </code>
                )}
                {simResult.status === 'error' && (
                  <p className="text-xs text-gray-500 mt-2">
                    This rejection comes from the Sui VM. The Move bytecode validates against AgentCap.max_trade_size
                    and aborts the transaction. No code change can override this.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Dual-Layer Comparison */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Dual-Layer Guardian</h2>
        <p className="text-sm text-gray-400 mb-4">
          TypeScript runs first as a fast pre-check. Move enforcement is the hard limit that cannot be bypassed.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          {/* TypeScript */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-gray-500 bg-gray-800 px-2 py-0.5 rounded">TS</span>
                <span className="font-medium text-sm">TypeScript Pre-Filter</span>
              </div>
              <span className="text-xs text-gray-500">8 checks</span>
            </div>
            <div className="space-y-1.5 mb-4">
              {TS_CHECKS.map((check, i) => (
                <div key={i} className="flex items-center justify-between text-sm py-0.5">
                  <span className="text-gray-300">{check.name}</span>
                  <span className="text-gray-600 text-xs">{check.desc}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-gray-800 pt-3 space-y-1.5">
              <p className="text-xs text-gray-500">Runs on agent server. Fast but bypassable if code is forked.</p>
            </div>
          </div>

          {/* Move */}
          <div className="bg-gray-900 rounded-xl border border-sage-800/40 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-sage-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <span className="font-medium text-sm">Move On-Chain Enforcement</span>
              </div>
              <span className="text-xs text-sage-500">7 checks</span>
            </div>
            <div className="space-y-1.5 mb-4">
              {MOVE_CHECKS.map((check, i) => (
                <div key={i} className="flex items-center justify-between text-sm py-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sage-600 text-xs font-mono">assert!</span>
                    <span className="text-gray-300">{check.name}</span>
                  </div>
                  <span className="text-gray-600 text-xs">{check.module}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-sage-800/30 pt-3 space-y-1.5">
              <p className="text-xs text-sage-400/80">Runs on Sui validators. Immutable bytecode. Cannot be bypassed.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Blocked Trades */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Blocked Trades</h2>
          <span className="text-xs text-gray-600">guardian_approved = false</span>
        </div>

        {loadingBlocked ? (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 text-center">
            <div className="w-6 h-6 border-2 border-sage-500/30 border-t-sage-500 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-gray-400">Loading blocked trades...</p>
          </div>
        ) : blockedTrades.length === 0 ? (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 text-center">
            <p className="text-gray-400 text-sm">
              No blocked trades found. All trades have passed guardian checks, or no trades attempted yet.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {blockedTrades.map((trade, index) => {
              const action = TRADE_TYPE_MAP[trade.tradeType] || 'UNKNOWN';
              const amountSui = (Number(trade.amount) / 1e9).toFixed(4);
              const time = new Date(Number(trade.timestampMs)).toLocaleString();

              return (
                <div key={index} className="bg-gray-900 rounded-lg border border-gray-800 p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400">
                      Blocked
                    </span>
                    <span className="text-sm text-gray-300">
                      {action} {amountSui} SUI
                    </span>
                    {maxTradeSui > 0 && Number(trade.amount) / 1e9 > maxTradeSui && (
                      <span className="text-xs text-gray-500">
                        {((Number(trade.amount) / 1e9 / maxTradeSui - 1) * 100).toFixed(0)}% over limit
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">{time}</span>
                    <a
                      href={`https://suiscan.xyz/${SUI_NETWORK}/tx/${trade.txDigest}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-sage-400 hover:text-sage-300 transition-colors"
                    >
                      TX &rarr;
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function LimitCard({
  label,
  value,
  source,
  active,
}: {
  label: string;
  value: string;
  source: string;
  active: boolean;
}) {
  return (
    <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm text-gray-400">{label}</p>
        <span className={`w-2 h-2 rounded-full ${active ? 'bg-sage-400' : 'bg-gray-600'}`} />
      </div>
      <p className="text-2xl font-bold mb-1">{value}</p>
      <p className="text-[10px] text-gray-600 font-mono">{source}</p>
    </div>
  );
}

function Spinner() {
  return <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />;
}
