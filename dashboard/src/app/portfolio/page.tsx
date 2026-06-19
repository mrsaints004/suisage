'use client';

import { useState, useEffect, useCallback } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { useToast } from '../components/Toast';
import { useVaultContext } from '../context/VaultContext';
import { PerformanceChart } from '../components/PerformanceChart';
import Link from 'next/link';

const VAULT_PACKAGE_ID = process.env.NEXT_PUBLIC_VAULT_PACKAGE_ID || '';
const SUI_NETWORK = process.env.NEXT_PUBLIC_SUI_NETWORK || 'testnet';

function getExplorerUrl(txDigest: string): string {
  return `https://suiscan.xyz/${SUI_NETWORK}/tx/${txDigest}`;
}

interface DepositReceiptInfo {
  objectId: string;
  shares: string;
  depositedAmount: string;
}

export default function PortfolioPage() {
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutate: signAndExecute, isPending } = useSignAndExecuteTransaction();
  const { showToast } = useToast();
  const { selectedVault, userVaults } = useVaultContext();

  const [depositAmount, setDepositAmount] = useState('');
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [vaultData, setVaultData] = useState<{
    balance: string;
    totalShares: string;
    deployed: string;
    paused: boolean;
    navPerShare: string;
    totalProfit: string;
    totalLoss: string;
  } | null>(null);
  const [loadingVault, setLoadingVault] = useState(false);
  const [txPending, setTxPending] = useState(false);
  const [lastTxDigest, setLastTxDigest] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<DepositReceiptInfo[]>([]);
  const [loadingReceipts, setLoadingReceipts] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<string>('');
  const [withdrawShares, setWithdrawShares] = useState('');
  const [recentActivity, setRecentActivity] = useState<{ type: 'deposit' | 'withdraw'; amount: string; timestamp: number; txDigest: string }[]>([]);

  const vaultObjectId = selectedVault?.vaultId ?? '';

  // Fetch wallet balance
  useEffect(() => {
    if (!account) { setWalletBalance(null); return; }
    async function fetchBalance() {
      try {
        const balance = await suiClient.getBalance({ owner: account!.address });
        setWalletBalance((Number(balance.totalBalance) / 1e9).toFixed(4));
      } catch { setWalletBalance(null); }
    }
    fetchBalance();
    const interval = setInterval(fetchBalance, 15000);
    return () => clearInterval(interval);
  }, [account, suiClient]);

  // Fetch vault data
  useEffect(() => {
    if (!vaultObjectId) { setVaultData(null); return; }
    async function fetchVault() {
      setLoadingVault(true);
      try {
        const obj = await suiClient.getObject({ id: vaultObjectId, options: { showContent: true } });
        if (obj.data?.content && obj.data.content.dataType === 'moveObject') {
          const fields = obj.data.content.fields as Record<string, unknown>;
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

          setVaultData({
            balance: (balanceVal / 1e9).toFixed(4),
            totalShares: String(fields.total_shares ?? '0'),
            deployed: (deployedVal / 1e9).toFixed(4),
            paused: Boolean(fields.paused),
            navPerShare: (Number(navPerShare) / 1e9).toFixed(6),
            totalProfit: (Number(String(fields.total_profit ?? '0')) / 1e9).toFixed(4),
            totalLoss: (Number(String(fields.total_loss ?? '0')) / 1e9).toFixed(4),
          });
        }
      } catch { setVaultData(null); }
      setLoadingVault(false);
    }
    fetchVault();
    const interval = setInterval(fetchVault, 30000);
    return () => clearInterval(interval);
  }, [suiClient, vaultObjectId]);

  // Fetch user's DepositReceipt NFTs
  const fetchReceipts = useCallback(async () => {
    if (!account || !VAULT_PACKAGE_ID) return;
    setLoadingReceipts(true);
    try {
      const objects = await suiClient.getOwnedObjects({
        owner: account.address,
        filter: { StructType: `${VAULT_PACKAGE_ID}::vault::DepositReceipt` },
        options: { showContent: true },
      });

      const parsed: DepositReceiptInfo[] = objects.data
        .filter((o) => o.data?.content && o.data.content.dataType === 'moveObject')
        .map((o) => {
          const fields = (o.data!.content as any).fields as Record<string, unknown>;
          return {
            objectId: o.data!.objectId,
            shares: String(fields.shares ?? '0'),
            depositedAmount: String(fields.deposited_amount ?? '0'),
            vaultId: String(fields.vault_id ?? ''),
          };
        })
        .filter((r: any) => !vaultObjectId || r.vaultId === vaultObjectId)
        .map(({ objectId, shares, depositedAmount }) => ({ objectId, shares, depositedAmount }));

      setReceipts(parsed);
      if (parsed.length > 0 && !selectedReceipt) {
        setSelectedReceipt(parsed[0].objectId);
      }
    } catch { setReceipts([]); }
    setLoadingReceipts(false);
  }, [account, suiClient, selectedReceipt, vaultObjectId]);

  useEffect(() => { fetchReceipts(); }, [fetchReceipts]);

  // Fetch deposit/withdraw events for recent activity
  useEffect(() => {
    if (!VAULT_PACKAGE_ID) return;
    async function fetchActivity() {
      try {
        const [depositEvents, withdrawEvents] = await Promise.all([
          suiClient.queryEvents({
            query: { MoveEventType: `${VAULT_PACKAGE_ID}::vault::DepositEvent` },
            limit: 10,
            order: 'descending',
          }),
          suiClient.queryEvents({
            query: { MoveEventType: `${VAULT_PACKAGE_ID}::vault::WithdrawEvent` },
            limit: 10,
            order: 'descending',
          }),
        ]);

        const deposits = depositEvents.data.map((ev) => {
          const fields = ev.parsedJson as Record<string, unknown>;
          return {
            type: 'deposit' as const,
            amount: (Number(String(fields.amount ?? '0')) / 1e9).toFixed(4),
            timestamp: Number(String(fields.timestamp_ms ?? ev.timestampMs ?? '0')),
            txDigest: ev.id.txDigest,
          };
        });

        const withdrawals = withdrawEvents.data.map((ev) => {
          const fields = ev.parsedJson as Record<string, unknown>;
          return {
            type: 'withdraw' as const,
            amount: (Number(String(fields.amount ?? '0')) / 1e9).toFixed(4),
            timestamp: Number(String(fields.timestamp_ms ?? ev.timestampMs ?? '0')),
            txDigest: ev.id.txDigest,
          };
        });

        const combined = [...deposits, ...withdrawals]
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, 10);

        setRecentActivity(combined);
      } catch {
        setRecentActivity([]);
      }
    }
    fetchActivity();
  }, [suiClient]);

  const handleDeposit = () => {
    if (!depositAmount || !account) return;
    const parsed = parseFloat(depositAmount);
    if (isNaN(parsed) || parsed <= 0) { showToast('Enter a valid amount', 'error'); return; }
    if (!VAULT_PACKAGE_ID || !vaultObjectId) { showToast('No vault selected', 'error'); return; }

    setTxPending(true);
    const tx = new Transaction();
    const amountMist = BigInt(Math.floor(parsed * 1_000_000_000));
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)]);
    tx.moveCall({
      target: `${VAULT_PACKAGE_ID}::vault::deposit`,
      arguments: [tx.object(vaultObjectId), coin],
    });

    signAndExecute(
      { transaction: tx as any },
      {
        onSuccess: (result) => {
          setTxPending(false);
          setLastTxDigest(result.digest);
          setDepositAmount('');
          showToast(`Deposited ${parsed} SUI successfully!`, 'success');
          fetchReceipts();
        },
        onError: (error) => {
          setTxPending(false);
          showToast(`Deposit failed: ${error.message}`, 'error');
        },
      },
    );
  };

  const handleWithdraw = () => {
    if (!selectedReceipt || !withdrawShares || !account) return;
    if (!VAULT_PACKAGE_ID || !vaultObjectId) { showToast('No vault selected', 'error'); return; }

    const sharesToBurn = BigInt(withdrawShares);
    if (sharesToBurn <= BigInt(0)) { showToast('Enter shares to burn', 'error'); return; }

    setTxPending(true);
    const tx = new Transaction();
    tx.moveCall({
      target: `${VAULT_PACKAGE_ID}::vault::withdraw`,
      arguments: [
        tx.object(vaultObjectId),
        tx.object(selectedReceipt),
        tx.pure.u64(sharesToBurn),
      ],
    });

    signAndExecute(
      { transaction: tx as any },
      {
        onSuccess: (result) => {
          setTxPending(false);
          setLastTxDigest(result.digest);
          setWithdrawShares('');
          showToast('Withdrawal successful!', 'success');
          fetchReceipts();
        },
        onError: (error) => {
          setTxPending(false);
          showToast(`Withdraw failed: ${error.message}`, 'error');
        },
      },
    );
  };

  // Not connected
  if (!account) {
    return (
      <div className="space-y-8">
        <h1 className="text-3xl font-bold">Portfolio</h1>
        <div className="bg-gray-900 rounded-xl p-12 text-center border border-gray-800">
          <h2 className="text-xl font-semibold mb-2">Connect Your Wallet</h2>
          <p className="text-gray-400 text-sm max-w-md mx-auto">
            Connect your Sui wallet to deposit SUI and start earning.
            Use the &quot;Connect Wallet&quot; button in the top right.
          </p>
        </div>
      </div>
    );
  }

  // No vaults
  if (userVaults.length === 0) {
    return (
      <div className="space-y-8">
        <h1 className="text-3xl font-bold">Portfolio</h1>
        <div className="bg-gray-900 rounded-xl p-12 text-center border border-gray-800">
          <h2 className="text-xl font-semibold mb-2">No Vaults Yet</h2>
          <p className="text-gray-400 mb-4 text-sm max-w-md mx-auto">
            Create your first vault to start AI-managed trading.
          </p>
          <Link
            href="/admin"
            className="inline-block px-6 py-2.5 bg-sage-600 hover:bg-sage-700 rounded-lg font-medium transition-colors"
          >
            Create Vault
          </Link>
        </div>
      </div>
    );
  }

  const totalVaultSui = vaultData
    ? (parseFloat(vaultData.balance) + parseFloat(vaultData.deployed)).toFixed(4)
    : '--';

  const netPnl = vaultData
    ? parseFloat(vaultData.totalProfit) - parseFloat(vaultData.totalLoss)
    : 0;

  const selectedReceiptData = receipts.find((r) => r.objectId === selectedReceipt);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Portfolio</h1>

      {/* Overview Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Wallet Balance" value={`${walletBalance ?? '--'} SUI`} loading={!walletBalance} />
        <StatCard label="Vault Balance" value={`${totalVaultSui} SUI`} loading={loadingVault} />
        <StatCard
          label="Profit / Loss"
          value={`${netPnl >= 0 ? '+' : ''}${netPnl.toFixed(4)} SUI`}
          color={netPnl > 0 ? 'text-green-400' : netPnl < 0 ? 'text-red-400' : undefined}
          loading={loadingVault}
        />
        <StatCard
          label="Agent Status"
          value={vaultData?.paused ? 'Paused' : 'Active'}
          color={vaultData?.paused ? 'text-yellow-400' : 'text-sage-400'}
          loading={loadingVault}
        />
      </div>

      {/* Performance Chart */}
      {vaultObjectId && (
        <PerformanceChart vaultId={vaultObjectId} packageId={VAULT_PACKAGE_ID} />
      )}

      {!vaultObjectId ? (
        <div className="bg-gray-900 rounded-xl p-8 text-center border border-gray-800">
          <p className="text-gray-400 text-sm">Select a vault from the dropdown above.</p>
        </div>
      ) : (
        <>
          {/* Deposit & Withdraw */}
          <div className="grid sm:grid-cols-2 gap-6">
            {/* Deposit */}
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <h3 className="text-lg font-semibold mb-1">Deposit</h3>
              <p className="text-xs text-gray-500 mb-4">
                Add SUI to your vault. You&apos;ll receive shares representing your ownership.
              </p>
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm text-gray-400">Amount</label>
                    {walletBalance && (
                      <button
                        onClick={() => setDepositAmount(String(Math.max(0, parseFloat(walletBalance) - 0.1).toFixed(4)))}
                        className="text-xs text-sage-400 hover:text-sage-300"
                      >
                        Max: {walletBalance} SUI
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type="number" min="0" step="0.1" value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)} placeholder="0.0"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 pr-12 text-white focus:outline-none focus:border-sage-500 transition-colors"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">SUI</span>
                  </div>
                </div>
                <button
                  onClick={handleDeposit} disabled={isPending || txPending || !depositAmount}
                  className="w-full px-4 py-2.5 bg-sage-600 hover:bg-sage-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors text-sm"
                >
                  {txPending ? <Spinner text="Confirming..." /> : 'Deposit'}
                </button>
              </div>
            </div>

            {/* Withdraw */}
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <h3 className="text-lg font-semibold mb-1">Withdraw</h3>
              <p className="text-xs text-gray-500 mb-4">
                Burn shares to get your SUI back. You&apos;ll receive SUI proportional to your ownership.
              </p>
              <div className="space-y-3">
                {loadingReceipts ? (
                  <p className="text-xs text-gray-500">Loading your deposits...</p>
                ) : receipts.length === 0 ? (
                  <p className="text-xs text-gray-500">No deposits found. Deposit SUI first.</p>
                ) : (
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Select Deposit</label>
                    <select
                      value={selectedReceipt}
                      onChange={(e) => setSelectedReceipt(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-sage-500"
                    >
                      {receipts.map((r) => (
                        <option key={r.objectId} value={r.objectId}>
                          {(Number(r.depositedAmount) / 1e9).toFixed(4)} SUI ({r.shares} shares)
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm text-gray-400">Shares to withdraw</label>
                    {selectedReceiptData && (
                      <button
                        onClick={() => setWithdrawShares(selectedReceiptData.shares)}
                        className="text-xs text-sage-400 hover:text-sage-300"
                      >
                        Max: {selectedReceiptData.shares}
                      </button>
                    )}
                  </div>
                  <input
                    type="number" min="0" value={withdrawShares}
                    onChange={(e) => setWithdrawShares(e.target.value)} placeholder="0"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-sage-500 transition-colors"
                  />
                </div>
                <button
                  onClick={handleWithdraw}
                  disabled={isPending || txPending || !withdrawShares || receipts.length === 0}
                  className="w-full px-4 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 rounded-lg font-medium transition-colors text-sm"
                >
                  {txPending ? <Spinner text="Withdrawing..." /> : 'Withdraw'}
                </button>
              </div>
            </div>
          </div>

          {/* Transaction Result */}
          {lastTxDigest && (
            <div className="bg-green-900/20 border border-green-800/50 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-sm text-green-400 font-medium">Transaction Confirmed</p>
                <p className="text-xs text-gray-400 font-mono mt-1">{lastTxDigest}</p>
              </div>
              <a
                href={getExplorerUrl(lastTxDigest)}
                target="_blank" rel="noopener noreferrer"
                className="px-3 py-1.5 bg-green-800/30 hover:bg-green-800/50 text-green-400 rounded-lg text-xs transition-colors"
              >
                View on Explorer
              </a>
            </div>
          )}

          {/* Recent Activity */}
          {recentActivity.length > 0 && (
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <h3 className="text-lg font-semibold mb-4">Recent Activity</h3>
              <div className="space-y-2">
                {recentActivity.map((entry, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        entry.type === 'deposit'
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}>
                        {entry.type === 'deposit' ? 'Deposit' : 'Withdraw'}
                      </span>
                      <span className="text-sm">{entry.amount} SUI</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-500">
                        {entry.timestamp > 0 ? new Date(entry.timestamp).toLocaleDateString() : '--'}
                      </span>
                      <a
                        href={getExplorerUrl(entry.txDigest)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-sage-400 hover:text-sage-300 transition-colors"
                      >
                        TX &rarr;
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick Links */}
          <div className="flex gap-3">
            <Link
              href="/reasoning"
              className="text-sm text-sage-400 hover:text-sage-300 transition-colors"
            >
              View AI Reasoning &rarr;
            </Link>
            <Link
              href="/admin"
              className="text-sm text-gray-400 hover:text-gray-300 transition-colors"
            >
              Manage Settings &rarr;
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, color, loading }: { label: string; value: string; color?: string; loading?: boolean }) {
  return (
    <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
      <p className="text-sm text-gray-400 mb-1">{label}</p>
      {loading ? (
        <div className="skeleton h-7 w-24" />
      ) : (
        <p className={`text-xl font-bold ${color ?? 'text-white'}`}>{value}</p>
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
