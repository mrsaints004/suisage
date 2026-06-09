'use client';

import Link from 'next/link';
import { useCurrentAccount, useSuiClient } from '@mysten/dapp-kit';
import { useState, useEffect } from 'react';

const VAULT_PACKAGE_ID = process.env.NEXT_PUBLIC_VAULT_PACKAGE_ID || '';
const DEFAULT_VAULT_ID = process.env.NEXT_PUBLIC_DEFAULT_VAULT_ID || '';
const WALRUS_AGGREGATOR_URL = process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL || 'https://aggregator.walrus-testnet.walrus.space';

export default function HomePage() {
  const account = useCurrentAccount();
  const suiClient = useSuiClient();

  const [stats, setStats] = useState({
    tvl: '--',
    trades: '--',
    price: '--',
    logs: '--',
    profit: '--',
    navPerShare: '--',
  });

  // Fetch live stats from chain
  useEffect(() => {
    async function fetchStats() {
      try {
        const updates: Partial<typeof stats> = {};

        // Vault TVL
        if (DEFAULT_VAULT_ID) {
          const vaultObj = await suiClient.getObject({
            id: DEFAULT_VAULT_ID,
            options: { showContent: true },
          });
          if (vaultObj.data?.content && vaultObj.data.content.dataType === 'moveObject') {
            const fields = vaultObj.data.content.fields as Record<string, unknown>;
            const rawBalance = fields.balance;
            const balanceVal = typeof rawBalance === 'object' && rawBalance !== null && 'value' in (rawBalance as any)
              ? Number(String((rawBalance as any).value))
              : Number(String(rawBalance ?? '0'));
            const deployed = Number(String(fields.deployed_amount ?? '0'));
            const totalValue = (balanceVal + deployed) / 1e9;
            updates.tvl = totalValue.toFixed(2);

            const totalProfit = Number(String(fields.total_profit ?? '0'));
            const totalLoss = Number(String(fields.total_loss ?? '0'));
            const netPnl = (totalProfit - totalLoss) / 1e9;
            updates.profit = netPnl >= 0 ? `+${netPnl.toFixed(4)}` : netPnl.toFixed(4);

            const totalShares = BigInt(String(fields.total_shares ?? '0'));
            if (totalShares > BigInt(0)) {
              const nav = (BigInt(balanceVal + deployed) * BigInt(1_000_000_000)) / totalShares;
              updates.navPerShare = (Number(nav) / 1e9).toFixed(6);
            } else {
              updates.navPerShare = '1.000000';
            }
          }
        }

        // Trade count from events
        if (VAULT_PACKAGE_ID) {
          const events = await suiClient.queryEvents({
            query: {
              MoveEventType: `${VAULT_PACKAGE_ID}::agent_auth::TradeRecordEvent`,
            },
            limit: 50,
            order: 'descending',
          });
          updates.trades = String(events.data.length);
          updates.logs = String(events.data.length);

          // Extract latest price from most recent trade
          if (events.data.length > 0) {
            const latestFields = events.data[0].parsedJson as Record<string, unknown>;
            const priceRaw = Number(String(latestFields.price ?? '0'));
            if (priceRaw > 0) {
              updates.price = `$${(priceRaw / 1e9).toFixed(4)}`;
            }
          }
        }

        setStats((prev) => ({ ...prev, ...updates }));
      } catch (error) {
        console.error('Error fetching stats:', error);
      }
    }

    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [suiClient]);

  return (
    <div className="space-y-16">
      {/* Hero */}
      <section className="text-center py-20">
        <div className="inline-block px-3 py-1 rounded-full bg-sage-900/50 text-sage-400 text-xs font-medium mb-6 border border-sage-800/50">
          Sui Overflow 2026 &middot; Agentic Web Track
        </div>
        <h1 className="text-5xl font-bold mb-6">
          <span className="text-sage-400">SuiSage</span>
        </h1>
        <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-4">
          Autonomous DeFi Agent with Move-Enforced Guardrails &amp; Verifiable Reasoning
        </p>
        <p className="text-gray-500 max-w-xl mx-auto mb-8">
          An AI agent that trades on DeepBook with budget ceilings enforced by Move smart contracts,
          cooldown and position limits checked on-chain, and every decision stored immutably on Walrus
          with a SHA-256 hash committed to the blockchain for verification.
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/portfolio"
            className="px-6 py-3 bg-sage-600 hover:bg-sage-700 rounded-lg font-medium transition-colors"
          >
            {account ? 'Open Portfolio' : 'Connect & Deposit'}
          </Link>
          <Link
            href="/reasoning"
            className="px-6 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-medium transition-colors border border-gray-700"
          >
            View Reasoning
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section>
        <h2 className="text-2xl font-bold text-center mb-3">How It Works</h2>
        <p className="text-gray-500 text-center mb-10 max-w-lg mx-auto text-sm">
          Three simple steps. Your funds are managed by AI with on-chain safety rails.
        </p>
        <div className="grid md:grid-cols-3 gap-6">
          <Card
            step="1"
            title="Deposit SUI"
            description="Connect your wallet and deposit SUI into the shared vault. You receive shares representing your ownership. Performance fees are only charged on profits."
            learnMore="Share-based vault (ERC-4626 style) with 10% performance fee above high-water mark."
          />
          <Card
            step="2"
            title="Agent Trades with On-Chain Guards"
            description="Every 60 seconds, the AI analyzes the DeepBook orderbook and decides to trade. Move contracts enforce budget ceilings, cooldown periods, and position limits — the AI literally cannot exceed them."
            learnMore="Guardian checks: trade size, concentration, cooldown, deployment limit — all enforced in Move, not just TypeScript."
          />
          <Card
            step="3"
            title="Verify Every Decision"
            description="Every decision is stored on Walrus with full reasoning. A SHA-256 hash is committed on-chain so anyone can verify the Walrus blob hasn't been tampered with."
            learnMore="On-chain hash verification: hash(reasoning_json) stored in TradeRecordEvent. Compare against Walrus blob to prove integrity."
          />
        </div>
      </section>

      {/* What Makes This Different */}
      <section>
        <h2 className="text-2xl font-bold text-center mb-3">Why Sui Makes This Possible</h2>
        <p className="text-gray-500 text-center mb-10 max-w-lg mx-auto text-sm">
          Not a generic LLM wrapper — Sui primitives make the AI safer and more composable.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <PrimitiveBadge
            title="Move AgentCap"
            description="Budget ceiling enforced at the type level. The AI cannot exceed its max_trade_size — it's a Move assertion, not a suggestion."
            color="blue"
          />
          <PrimitiveBadge
            title="On-Chain Cooldown"
            description="Trade interval enforced using sui::clock::Clock. The contract checks elapsed time since last trade — no off-chain trust needed."
            color="purple"
          />
          <PrimitiveBadge
            title="Atomic PTBs"
            description="Withdraw + trade + record in a single Programmable Transaction Block. All succeed or all fail — no partial states."
            color="orange"
          />
          <PrimitiveBadge
            title="Walrus + Hash"
            description="Full reasoning stored on Walrus. SHA-256 hash committed on-chain. Anyone can verify the blob matches what the agent committed to."
            color="green"
          />
        </div>
      </section>

      {/* Live Stats */}
      <section className="bg-gray-900 rounded-xl p-8 border border-gray-800">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">Live Agent Stats</h2>
          <span className="flex items-center gap-2 text-xs text-gray-400">
            <span className="w-2 h-2 rounded-full bg-sage-500 animate-pulse" />
            Auto-refreshes every 30s
          </span>
        </div>
        <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-6">
          <StatCard label="Total Vault Value" value={stats.tvl} unit="SUI" hint="Total SUI managed by the agent" />
          <StatCard label="Trades Executed" value={stats.trades} unit="" hint="On-chain TradeRecordEvents" />
          <StatCard label="Last Trade Price" value={stats.price} unit="" hint="From most recent TradeRecordEvent" />
          <StatCard label="Reasoning Logs" value={stats.logs} unit="on Walrus" hint="Each with SHA-256 hash on-chain" />
          <StatCard label="Net P&L" value={stats.profit} unit="SUI" hint="Total profit minus total loss" />
          <StatCard label="NAV / Share" value={stats.navPerShare} unit="" hint="Net asset value per share (1.0 = par)" />
        </div>
      </section>

      {/* Track Coverage */}
      <section>
        <h2 className="text-2xl font-bold text-center mb-3">Hackathon Track: Agentic Web</h2>
        <p className="text-gray-500 text-center mb-10 max-w-lg mx-auto text-sm">
          Sub-track 2: Autonomous Agent Wallet — all &quot;must have&quot; requirements met.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <ChecklistItem
            title="Real DeepBook Orders"
            description="Limit orders on DeepBook V2 SUI/wUSDC pool via PTB"
            met={true}
          />
          <ChecklistItem
            title="Self-Enforced Budget Ceiling"
            description="AgentCap.max_trade_size checked in Move withdraw_for_trading()"
            met={true}
          />
          <ChecklistItem
            title="On-Chain Activity Log"
            description="TradeRecordEvent with blob ID + SHA-256 reasoning hash"
            met={true}
          />
          <ChecklistItem
            title="Owner Revocation Demo"
            description="AdminCap.revoke_agent() destroys AgentCap instantly"
            met={true}
          />
        </div>
      </section>

      {/* CTA */}
      <section className="text-center py-8">
        <p className="text-gray-400 mb-4">Ready to see the agent in action?</p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/reasoning"
            className="px-6 py-3 bg-sage-600 hover:bg-sage-700 rounded-lg font-medium transition-colors"
          >
            View AI Reasoning
          </Link>
          <Link
            href="/portfolio"
            className="px-6 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-medium transition-colors border border-gray-700"
          >
            Manage Portfolio
          </Link>
        </div>
      </section>
    </div>
  );
}

function Card({
  step,
  title,
  description,
  learnMore,
}: {
  step: string;
  title: string;
  description: string;
  learnMore: string;
}) {
  return (
    <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 group hover:border-gray-700 transition-colors">
      <div className="w-8 h-8 bg-sage-900 text-sage-400 rounded-full flex items-center justify-center text-sm font-bold mb-4">
        {step}
      </div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-gray-400 text-sm mb-3">{description}</p>
      <p className="text-gray-600 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
        {learnMore}
      </p>
    </div>
  );
}

function PrimitiveBadge({
  title,
  description,
  color,
}: {
  title: string;
  description: string;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    blue: 'border-blue-500/30 bg-blue-500/5',
    purple: 'border-purple-500/30 bg-purple-500/5',
    orange: 'border-orange-500/30 bg-orange-500/5',
    green: 'border-sage-500/30 bg-sage-500/5',
  };

  return (
    <div className={`rounded-xl p-4 border ${colorMap[color]}`}>
      <h3 className="font-semibold mb-1 text-sm">{title}</h3>
      <p className="text-gray-400 text-xs">{description}</p>
    </div>
  );
}

function ChecklistItem({
  title,
  description,
  met,
}: {
  title: string;
  description: string;
  met: boolean;
}) {
  return (
    <div className={`rounded-xl p-4 border ${met ? 'border-sage-500/30 bg-sage-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-sm ${met ? 'text-sage-400' : 'text-red-400'}`}>{met ? '\u2713' : '\u2717'}</span>
        <h3 className="font-semibold text-sm">{title}</h3>
      </div>
      <p className="text-gray-400 text-xs">{description}</p>
    </div>
  );
}

function StatCard({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: string;
  unit: string;
  hint: string;
}) {
  return (
    <div className="group relative">
      <p className="text-gray-400 text-sm">{label}</p>
      <p className="text-2xl font-bold">
        {value} <span className="text-sm text-gray-500">{unit}</span>
      </p>
      <p className="text-xs text-gray-600 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {hint}
      </p>
    </div>
  );
}
