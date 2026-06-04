'use client';

import { useState, useEffect } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { Tooltip } from '../components/Tooltip';
import { useToast } from '../components/Toast';
import Link from 'next/link';

const VAULT_PACKAGE_ID = process.env.NEXT_PUBLIC_VAULT_PACKAGE_ID || '';
const VAULT_OBJECT_ID = process.env.NEXT_PUBLIC_VAULT_OBJECT_ID || '';

export default function PortfolioPage() {
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutate: signAndExecute, isPending } = useSignAndExecuteTransaction();
  const { showToast } = useToast();

  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawShares, setWithdrawShares] = useState('');
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

  // Fetch wallet balance
  useEffect(() => {
    if (!account) {
      setWalletBalance(null);
      return;
    }
    async function fetchBalance() {
      try {
        const balance = await suiClient.getBalance({ owner: account!.address });
        const sui = (Number(balance.totalBalance) / 1e9).toFixed(4);
        setWalletBalance(sui);
      } catch {
        setWalletBalance(null);
      }
    }
    fetchBalance();
    const interval = setInterval(fetchBalance, 15000);
    return () => clearInterval(interval);
  }, [account, suiClient]);

  // Fetch vault data
  useEffect(() => {
    if (!VAULT_OBJECT_ID) return;
    async function fetchVault() {
      setLoadingVault(true);
      try {
        const obj = await suiClient.getObject({
          id: VAULT_OBJECT_ID,
          options: { showContent: true },
        });
        if (obj.data?.content && obj.data.content.dataType === 'moveObject') {
          const fields = obj.data.content.fields as Record<string, unknown>;
          setVaultData({
            balance: ((Number(String(fields.balance ?? '0'))) / 1e9).toFixed(4),
            totalShares: String(fields.total_shares ?? '0'),
            deployed: ((Number(String(fields.deployed_amount ?? '0'))) / 1e9).toFixed(4),
            paused: Boolean(fields.paused),
          });
        }
      } catch {
        setVaultData(null);
      }
      setLoadingVault(false);
    }
    fetchVault();
    const interval = setInterval(fetchVault, 30000);
    return () => clearInterval(interval);
  }, [suiClient]);

  const handleDeposit = () => {
    if (!depositAmount || !account) return;
    const parsed = parseFloat(depositAmount);
    if (isNaN(parsed) || parsed <= 0) {
      showToast('Please enter a valid amount', 'error');
      return;
    }
    if (!VAULT_PACKAGE_ID || !VAULT_OBJECT_ID) {
      showToast('Vault not configured. Check NEXT_PUBLIC_VAULT_PACKAGE_ID in env.', 'error');
      return;
    }

    setTxPending(true);
    const tx = new Transaction();
    const amountMist = BigInt(Math.floor(parsed * 1_000_000_000));

    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)]);
    tx.moveCall({
      target: `${VAULT_PACKAGE_ID}::vault::deposit`,
      arguments: [tx.object(VAULT_OBJECT_ID), coin],
    });

    signAndExecute(
      { transaction: tx as any },
      {
        onSuccess: (result) => {
          setTxPending(false);
          setLastTxDigest(result.digest);
          setDepositAmount('');
          showToast(`Deposited ${parsed} SUI successfully!`, 'success');
        },
        onError: (error) => {
          setTxPending(false);
          showToast(`Deposit failed: ${error.message}`, 'error');
        },
      },
    );
  };

  const handleWithdraw = () => {
    if (!withdrawShares || !account) return;
    if (!VAULT_PACKAGE_ID || !VAULT_OBJECT_ID) {
      showToast('Vault not configured', 'error');
      return;
    }
    showToast('Withdraw requires your DepositReceipt object. Check your wallet for NFTs.', 'info');
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
            The AI agent will trade with pooled vault funds.
          </p>
          <p className="text-gray-600 text-xs">
            Use the &quot;Connect Wallet&quot; button in the top right corner.
          </p>
        </div>

        {/* Still show vault info even without wallet */}
        {vaultData && (
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
            <h3 className="text-lg font-semibold mb-4">Vault Overview (Read-Only)</h3>
            <div className="grid sm:grid-cols-3 gap-4">
              <VaultStat
                label="Vault Balance"
                value={vaultData.balance}
                unit="SUI"
              />
              <VaultStat
                label="Deployed to Trading"
                value={vaultData.deployed}
                unit="SUI"
              />
              <VaultStat
                label="Status"
                value={vaultData.paused ? 'Paused' : 'Active'}
                unit=""
                highlight={!vaultData.paused}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  const totalVaultSui = vaultData
    ? (parseFloat(vaultData.balance) + parseFloat(vaultData.deployed)).toFixed(4)
    : '--';

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
            <p className="text-xl font-bold">
              {walletBalance ?? '--'} <span className="text-sm text-gray-500">SUI</span>
            </p>
          </div>
        </div>
      </div>

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
            <Tooltip term="Total Shares" explanation="Total share tokens issued. Your share count determines your % of the vault." />
          </p>
          <p className="text-2xl font-bold">{vaultData?.totalShares ?? '--'}</p>
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
        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
          <h3 className="text-lg font-semibold mb-1">Deposit SUI</h3>
          <p className="text-xs text-gray-500 mb-4">
            Deposit SUI into the vault to receive{' '}
            <Tooltip term="shares" explanation="Shares represent your proportional ownership of the vault. If you hold 10% of shares, you can withdraw 10% of total value." />
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
                type="number"
                min="0"
                step="0.1"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="0.0"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-sage-500 transition-colors"
              />
            </div>
            <button
              onClick={handleDeposit}
              disabled={isPending || txPending || !depositAmount}
              className="w-full px-4 py-2.5 bg-sage-600 hover:bg-sage-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors"
            >
              {txPending ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Confirming...
                </span>
              ) : (
                'Deposit'
              )}
            </button>
          </div>
        </div>

        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
          <h3 className="text-lg font-semibold mb-1">Withdraw SUI</h3>
          <p className="text-xs text-gray-500 mb-4">
            Burn your{' '}
            <Tooltip term="DepositReceipt NFT" explanation="When you deposited, you received an NFT that proves your share ownership. You need it to withdraw." />
            {' '}to reclaim SUI
          </p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Shares to burn</label>
              <input
                type="number"
                min="0"
                value={withdrawShares}
                onChange={(e) => setWithdrawShares(e.target.value)}
                placeholder="0"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-sage-500 transition-colors"
              />
            </div>
            <button
              onClick={handleWithdraw}
              disabled={isPending || txPending || !withdrawShares}
              className="w-full px-4 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 rounded-lg font-medium transition-colors"
            >
              Withdraw
            </button>
          </div>
        </div>
      </div>

      {/* Last Transaction */}
      {lastTxDigest && (
        <div className="bg-green-900/20 border border-green-800/50 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-sm text-green-400 font-medium">Transaction Confirmed</p>
            <p className="text-xs text-gray-400 font-mono mt-1">{lastTxDigest}</p>
          </div>
          <a
            href={`https://suiscan.xyz/mainnet/tx/${lastTxDigest}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 bg-green-800/30 hover:bg-green-800/50 text-green-400 rounded-lg text-xs transition-colors"
          >
            View on Explorer
          </a>
        </div>
      )}

      {/* Vault Performance / CTA */}
      <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">Vault Performance</h3>
        <div className="h-48 flex flex-col items-center justify-center text-gray-500">
          <p className="mb-4">Performance chart populates as the agent trades</p>
          <Link
            href="/reasoning"
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm transition-colors text-gray-300"
          >
            View Agent Reasoning →
          </Link>
        </div>
      </div>
    </div>
  );
}

function VaultStat({
  label,
  value,
  unit,
  highlight,
}: {
  label: string;
  value: string;
  unit: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-sm text-gray-400">{label}</p>
      <p className={`text-xl font-bold ${highlight ? 'text-sage-400' : ''}`}>
        {value} {unit && <span className="text-sm text-gray-500">{unit}</span>}
      </p>
    </div>
  );
}
