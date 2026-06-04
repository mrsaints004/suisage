'use client';

import { useState } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';

// These would come from env/config in production
const VAULT_PACKAGE_ID = process.env.NEXT_PUBLIC_VAULT_PACKAGE_ID || '';
const VAULT_OBJECT_ID = process.env.NEXT_PUBLIC_VAULT_OBJECT_ID || '';

export default function PortfolioPage() {
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutate: signAndExecute, isPending } = useSignAndExecuteTransaction();

  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawShares, setWithdrawShares] = useState('');
  const [txResult, setTxResult] = useState<string | null>(null);

  const handleDeposit = () => {
    if (!depositAmount || !account) return;

    const tx = new Transaction();
    const amountMist = BigInt(Math.floor(parseFloat(depositAmount) * 1_000_000_000));

    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)]);
    tx.moveCall({
      target: `${VAULT_PACKAGE_ID}::vault::deposit`,
      arguments: [tx.object(VAULT_OBJECT_ID), coin],
    });

    signAndExecute(
      { transaction: tx as any },
      {
        onSuccess: (result) => {
          setTxResult(`Deposit successful! TX: ${result.digest}`);
          setDepositAmount('');
        },
        onError: (error) => {
          setTxResult(`Deposit failed: ${error.message}`);
        },
      },
    );
  };

  const handleWithdraw = () => {
    if (!withdrawShares || !account) return;
    // Withdrawal requires a DepositReceipt object ID
    // In a full implementation, we'd query the user's receipts
    setTxResult('Withdraw: Please provide your DepositReceipt object ID');
  };

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Portfolio</h1>

      {!account ? (
        <div className="bg-gray-900 rounded-xl p-8 text-center">
          <p className="text-gray-400 mb-4">Connect your wallet to manage your portfolio</p>
        </div>
      ) : (
        <>
          {/* Wallet Info */}
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
            <p className="text-sm text-gray-400">Connected Wallet</p>
            <p className="font-mono text-sm">{account.address}</p>
          </div>

          {/* Vault Overview */}
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <p className="text-sm text-gray-400">Vault Balance</p>
              <p className="text-2xl font-bold">-- <span className="text-sm text-gray-500">SUI</span></p>
            </div>
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <p className="text-sm text-gray-400">Your Shares</p>
              <p className="text-2xl font-bold">--</p>
            </div>
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <p className="text-sm text-gray-400">Agent Status</p>
              <p className="text-2xl font-bold text-sage-400">Active</p>
            </div>
          </div>

          {/* Deposit / Withdraw */}
          <div className="grid sm:grid-cols-2 gap-6">
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <h3 className="text-lg font-semibold mb-4">Deposit SUI</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Amount (SUI)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    placeholder="0.0"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-sage-500"
                  />
                </div>
                <button
                  onClick={handleDeposit}
                  disabled={isPending || !depositAmount}
                  className="w-full px-4 py-2 bg-sage-600 hover:bg-sage-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors"
                >
                  {isPending ? 'Depositing...' : 'Deposit'}
                </button>
              </div>
            </div>

            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <h3 className="text-lg font-semibold mb-4">Withdraw SUI</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Shares to burn</label>
                  <input
                    type="number"
                    min="0"
                    value={withdrawShares}
                    onChange={(e) => setWithdrawShares(e.target.value)}
                    placeholder="0"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-sage-500"
                  />
                </div>
                <button
                  onClick={handleWithdraw}
                  disabled={isPending || !withdrawShares}
                  className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 rounded-lg font-medium transition-colors"
                >
                  Withdraw
                </button>
              </div>
            </div>
          </div>

          {/* Transaction Result */}
          {txResult && (
            <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
              <p className="text-sm font-mono break-all">{txResult}</p>
            </div>
          )}

          {/* Portfolio Chart Placeholder */}
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
            <h3 className="text-lg font-semibold mb-4">Vault Performance</h3>
            <div className="h-64 flex items-center justify-center text-gray-500">
              <p>Chart will populate once the agent begins trading</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
