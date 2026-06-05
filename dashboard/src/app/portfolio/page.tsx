'use client';

import { useState, useEffect, useCallback } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { Tooltip } from '../components/Tooltip';
import { useToast } from '../components/Toast';
import { PortfolioChart } from '../components/PortfolioChart';
import { useVaultContext } from '../context/VaultContext';
import Link from 'next/link';

const VAULT_PACKAGE_ID = process.env.NEXT_PUBLIC_VAULT_PACKAGE_ID || '';

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
  } | null>(null);
  const [loadingVault, setLoadingVault] = useState(false);
  const [txPending, setTxPending] = useState(false);
  const [lastTxDigest, setLastTxDigest] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<DepositReceiptInfo[]>([]);
  const [loadingReceipts, setLoadingReceipts] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<string>('');
  const [withdrawShares, setWithdrawShares] = useState('');

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
          setVaultData({
            balance: (Number(String(fields.balance ?? '0')) / 1e9).toFixed(4),
            totalShares: String(fields.total_shares ?? '0'),
            deployed: (Number(String(fields.deployed_amount ?? '0')) / 1e9).toFixed(4),
            paused: Boolean(fields.paused),
          });
        }
      } catch { setVaultData(null); }
      setLoadingVault(false);
    }
    fetchVault();
    const interval = setInterval(fetchVault, 30000);
    return () => clearInterval(interval);
  }, [suiClient, vaultObjectId]);

  // Fetch user's DepositReceipt NFTs (filtered by selected vault)
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
        // Filter to only receipts for the selected vault
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

  // Not connected state
  if (!account) {
    return (
      <div className="space-y-8">
        <h1 className="text-3xl font-bold">Portfolio</h1>
        <div className="bg-gray-900 rounded-xl p-12 text-center border border-gray-800">
          <span className="text-4xl mb-4 block">🔗</span>
          <h2 className="text-xl font-semibold mb-2">Connect Your Wallet</h2>
          <p className="text-gray-400 mb-6 max-w-md mx-auto text-sm">
            Connect your Sui wallet to deposit SUI, track your shares, and manage your portfolio.
          </p>
          <p className="text-gray-600 text-xs">
            Use the &quot;Connect Wallet&quot; button in the top right corner.
          </p>
        </div>
      </div>
    );
  }

  // No vaults state
  if (userVaults.length === 0) {
    return (
      <div className="space-y-8">
        <h1 className="text-3xl font-bold">Portfolio</h1>
        <div className="bg-gray-900 rounded-xl p-12 text-center border border-gray-800">
          <h2 className="text-xl font-semibold mb-2">No Vaults Yet</h2>
          <p className="text-gray-400 mb-4 max-w-md mx-auto text-sm">
            Create your first vault from the Admin page to start depositing and trading.
          </p>
          <Link
            href="/admin"
            className="inline-block px-6 py-2.5 bg-sage-600 hover:bg-sage-700 rounded-lg font-medium transition-colors"
          >
            Go to Admin
          </Link>
        </div>
      </div>
    );
  }

  const totalVaultSui = vaultData
    ? (parseFloat(vaultData.balance) + parseFloat(vaultData.deployed)).toFixed(4)
    : '--';

  const selectedReceiptData = receipts.find((r) => r.objectId === selectedReceipt);

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Portfolio</h1>

      {/* Wallet Info */}
      <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-400">Connected Wallet</p>
            <p className="font-mono text-sm">{account.address.slice(0, 10)}...{account.address.slice(-8)}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-400">Wallet Balance</p>
            <p className="text-xl font-bold">{walletBalance ?? '--'} <span className="text-sm text-gray-500">SUI</span></p>
          </div>
        </div>
      </div>

      {!vaultObjectId ? (
        <div className="bg-gray-900 rounded-xl p-8 text-center border border-gray-800">
          <p className="text-gray-400 text-sm">Select a vault from the dropdown in the navigation bar.</p>
        </div>
      ) : (
        <>
          {/* Vault Overview */}
          <div className="grid sm:grid-cols-4 gap-4">
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <p className="text-sm text-gray-400">
                <Tooltip term="Total Vault Value" explanation="Total SUI in the vault: idle balance + deployed to trading" />
              </p>
              <p className="text-2xl font-bold">{totalVaultSui} <span className="text-sm text-gray-500">SUI</span></p>
            </div>
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <p className="text-sm text-gray-400">
                <Tooltip term="Available Balance" explanation="SUI sitting idle in the vault, not currently being traded" />
              </p>
              <p className="text-2xl font-bold">{vaultData?.balance ?? '--'} <span className="text-sm text-gray-500">SUI</span></p>
            </div>
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <p className="text-sm text-gray-400">
                <Tooltip term="Your Shares" explanation="DepositReceipt NFTs you hold. Each represents your proportional ownership." />
              </p>
              <p className="text-2xl font-bold">{receipts.length > 0 ? receipts.reduce((s, r) => s + BigInt(r.shares), BigInt(0)).toString() : '--'}</p>
            </div>
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <p className="text-sm text-gray-400">Agent Status</p>
              <p className={`text-2xl font-bold ${vaultData?.paused ? 'text-yellow-400' : 'text-sage-400'}`}>
                {loadingVault ? '...' : vaultData?.paused ? 'Paused' : 'Active'}
              </p>
            </div>
          </div>

          {/* Deposit / Withdraw */}
          <div className="grid sm:grid-cols-2 gap-6">
            {/* Deposit */}
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <h3 className="text-lg font-semibold mb-1">Deposit SUI</h3>
              <p className="text-xs text-gray-500 mb-4">
                Deposit SUI into the vault to receive{' '}
                <Tooltip term="shares" explanation="Shares represent your proportional ownership. If you hold 10% of shares, you own 10% of the vault." />
              </p>
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm text-gray-400">Amount (SUI)</label>
                    {walletBalance && (
                      <button
                        onClick={() => setDepositAmount(String(Math.max(0, parseFloat(walletBalance) - 0.1).toFixed(4)))}
                        className="text-xs text-sage-400 hover:text-sage-300"
                      >
                        Max: {walletBalance}
                      </button>
                    )}
                  </div>
                  <input
                    type="number" min="0" step="0.1" value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)} placeholder="0.0"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-sage-500 transition-colors"
                  />
                </div>
                <button
                  onClick={handleDeposit} disabled={isPending || txPending || !depositAmount}
                  className="w-full px-4 py-2.5 bg-sage-600 hover:bg-sage-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors"
                >
                  {txPending ? <Spinner text="Confirming..." /> : 'Deposit'}
                </button>
              </div>
            </div>

            {/* Withdraw */}
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <h3 className="text-lg font-semibold mb-1">Withdraw SUI</h3>
              <p className="text-xs text-gray-500 mb-4">
                Select a{' '}
                <Tooltip term="DepositReceipt" explanation="The NFT you received when depositing. It proves your share ownership and is required to withdraw." />
                {' '}and burn shares to reclaim SUI
              </p>
              <div className="space-y-4">
                {/* Receipt selector */}
                {loadingReceipts ? (
                  <p className="text-xs text-gray-500">Loading your receipts...</p>
                ) : receipts.length === 0 ? (
                  <p className="text-xs text-gray-500">No DepositReceipt NFTs found. Deposit first to get one.</p>
                ) : (
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Select Receipt</label>
                    <select
                      value={selectedReceipt}
                      onChange={(e) => setSelectedReceipt(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-sage-500"
                    >
                      {receipts.map((r) => (
                        <option key={r.objectId} value={r.objectId}>
                          {r.objectId.slice(0, 10)}... ({r.shares} shares)
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm text-gray-400">Shares to burn</label>
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
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-sage-500 transition-colors"
                  />
                </div>
                <button
                  onClick={handleWithdraw}
                  disabled={isPending || txPending || !withdrawShares || receipts.length === 0}
                  className="w-full px-4 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 rounded-lg font-medium transition-colors"
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
                href={`https://suiscan.xyz/mainnet/tx/${lastTxDigest}`}
                target="_blank" rel="noopener noreferrer"
                className="px-3 py-1.5 bg-green-800/30 hover:bg-green-800/50 text-green-400 rounded-lg text-xs transition-colors"
              >
                View on Explorer
              </a>
            </div>
          )}

          {/* Portfolio Chart */}
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Vault Performance</h3>
              <Link
                href="/reasoning"
                className="text-xs text-sage-400 hover:text-sage-300 transition-colors"
              >
                View AI Reasoning →
              </Link>
            </div>
            <PortfolioChart />
          </div>

          {/* Agent Info */}
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
            <h3 className="text-lg font-semibold mb-4">Agent Architecture</h3>
            <div className="grid sm:grid-cols-3 gap-4 text-sm">
              <div className="bg-gray-800/50 rounded-lg p-4">
                <p className="text-sage-400 font-medium mb-1">Guardian Risk Layer</p>
                <p className="text-gray-400 text-xs">Every trade passes 8 automated risk checks before execution. Spread, depth, slippage, concentration, cooldown, budget ceiling, confidence floor, and vault health.</p>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-4">
                <p className="text-sage-400 font-medium mb-1">Walrus Memory</p>
                <p className="text-gray-400 text-xs">The agent reads its past decisions from Walrus and learns from outcomes. Win rate, patterns, and performance stats feed into each new decision.</p>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-4">
                <p className="text-sage-400 font-medium mb-1">On-Chain Enforcement</p>
                <p className="text-gray-400 text-xs">Budget ceiling enforced by Move AgentCap object. Admin can revoke agent access instantly. Trade + record happen atomically in a single PTB.</p>
              </div>
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
