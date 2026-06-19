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

  const [loading, setLoading] = useState(true);
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
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [suiClient]);

  return (
    <div className="space-y-16 sm:space-y-20">
      {/* Hero */}
      <section className="text-center py-16 sm:py-24">
        <div className="inline-block px-3 py-1 rounded-full bg-sage-900/50 text-sage-400 text-xs font-medium mb-6 border border-sage-800/50 animate-fade-in-up-d1">
          Autonomous Agent Wallet &middot; Built on Sui
        </div>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-4 leading-tight animate-fade-in-up-d2">
          <span className="text-sage-400 glow-text">SuiSage</span>
        </h1>
        <p className="text-base text-gray-400 mb-6 animate-fade-in-up-d3">Safe Autonomous Agent Wallet</p>
        <p className="text-lg sm:text-xl text-gray-300 max-w-2xl mx-auto mb-4 font-medium animate-fade-in-up-d4">
          The AI Agent That Can Trade But Can&apos;t Cheat
        </p>
        <p className="text-gray-500 max-w-xl mx-auto mb-8 text-sm sm:text-base leading-relaxed animate-fade-in-up-d5">
          An AI agent that trades on DeepBook with budget ceilings enforced by Move smart contracts,
          cooldown and position limits checked on-chain, and every decision stored immutably on Walrus
          with a SHA-256 hash committed to the blockchain for verification.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center px-4 sm:px-0 animate-fade-in-up-d6">
          <Link
            href="/portfolio"
            className="px-6 py-3 bg-sage-600 hover:bg-sage-700 rounded-lg font-medium transition-colors text-center"
          >
            {account ? 'Open Portfolio' : 'Connect & Deposit'}
          </Link>
          <Link
            href="/reasoning"
            className="px-6 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-medium transition-colors border border-gray-700 text-center"
          >
            View Reasoning
          </Link>
        </div>

        {/* Trust Signals */}
        <div className="flex flex-wrap justify-center gap-4 mt-10 animate-fade-in-up-d6">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-900/80 border border-gray-800 text-xs text-gray-400">
            <svg className="w-3.5 h-3.5 text-sage-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
            3 Move modules, 19 tests
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-900/80 border border-gray-800 text-xs text-gray-400">
            <svg className="w-3.5 h-3.5 text-sage-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
            Dual-layer guardian (15 checks)
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-900/80 border border-gray-800 text-xs text-gray-400">
            <svg className="w-3.5 h-3.5 text-sage-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
            SHA-256 verified reasoning
          </div>
        </div>
      </section>

      {/* How it Works - Step Cards */}
      <section>
        <h2 className="text-2xl font-bold text-center mb-3">How It Works</h2>
        <p className="text-gray-500 text-center mb-10 max-w-lg mx-auto text-sm">
          Three simple steps. Your funds are managed by AI with on-chain safety rails.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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

      {/* Animated Flow Diagram */}
      <section>
        <h2 className="text-2xl font-bold text-center mb-3">Data Flow</h2>
        <p className="text-gray-500 text-center mb-10 max-w-lg mx-auto text-sm">
          Every trade follows this verifiable pipeline, end to end.
        </p>
        <FlowDiagram />
      </section>

      {/* What Makes This Different */}
      <section>
        <h2 className="text-2xl font-bold text-center mb-3">Why Sui Makes This Possible</h2>
        <p className="text-gray-500 text-center mb-10 max-w-lg mx-auto text-sm">
          Not a generic LLM wrapper — Sui primitives make the AI safer and more composable.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { title: 'Move AgentCap', description: 'Budget ceiling enforced at the type level. The AI cannot exceed its max_trade_size — it\'s a Move assertion, not a suggestion.' },
            { title: 'On-Chain Cooldown', description: 'Trade interval enforced using sui::clock::Clock. The contract checks elapsed time since last trade — no off-chain trust needed.' },
            { title: 'Atomic PTBs', description: 'Withdraw + trade + record in a single Programmable Transaction Block. All succeed or all fail — no partial states.' },
            { title: 'Walrus + Hash', description: 'Full reasoning stored on Walrus. SHA-256 hash committed on-chain. Anyone can verify the blob matches what the agent committed to.' },
          ].map((item, i) => (
            <div key={item.title} className="animate-fade-in-up" style={{ animationDelay: `${i * 0.1}s`, animationFillMode: 'both' }}>
              <PrimitiveBadge title={item.title} description={item.description} />
            </div>
          ))}
        </div>
      </section>

      {/* Live Stats */}
      <section className="bg-gray-900 rounded-xl p-6 sm:p-8 border border-gray-800 card-hover animate-scale-in">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl sm:text-2xl font-bold">Live Agent Stats</h2>
          <span className="flex items-center gap-2 text-xs text-gray-400">
            <span className="w-2 h-2 rounded-full bg-sage-500 live-dot" />
            Auto-refreshes every 30s
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 sm:gap-6">
          <StatCard label="Total Vault Value" value={stats.tvl} unit="SUI" hint="Total SUI managed by the agent" loading={loading} />
          <StatCard label="Trades Executed" value={stats.trades} unit="" hint="On-chain TradeRecordEvents" loading={loading} />
          <StatCard label="Last Trade Price" value={stats.price} unit="" hint="From most recent TradeRecordEvent" loading={loading} />
          <StatCard label="Reasoning Logs" value={stats.logs} unit="on Walrus" hint="Each with SHA-256 hash on-chain" loading={loading} />
          <StatCard label="Net P&L" value={stats.profit} unit="SUI" hint="Total profit minus total loss" loading={loading} />
          <StatCard label="NAV / Share" value={stats.navPerShare} unit="" hint="Net asset value per share (1.0 = par)" loading={loading} />
        </div>
      </section>


      {/* CTA */}
      <section className="text-center py-8">
        <p className="text-gray-400 mb-4">Ready to see the agent in action?</p>
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center px-4 sm:px-0">
          <Link
            href="/reasoning"
            className="px-6 py-3 bg-sage-600 hover:bg-sage-700 rounded-lg font-medium transition-colors text-center"
          >
            View AI Reasoning
          </Link>
          <Link
            href="/portfolio"
            className="px-6 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-medium transition-colors border border-gray-700 text-center"
          >
            Manage Portfolio
          </Link>
        </div>
      </section>

      {/* Access Everywhere */}
      <section>
        <h2 className="text-2xl font-bold text-center mb-3">Access Everywhere</h2>
        <p className="text-gray-500 text-center mb-10 max-w-lg mx-auto text-sm">
          Not just a dashboard — interact with SuiSage from wherever you work.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 group hover:border-gray-700 transition-all duration-300">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-lg bg-sage-900/60 flex items-center justify-center">
                <svg className="w-5 h-5 text-sage-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25z" /></svg>
              </div>
              <h3 className="font-semibold text-sm">Web Dashboard</h3>
            </div>
            <p className="text-gray-400 text-xs">Full portfolio management, reasoning timeline with hash verification, and live stats. The page you&apos;re on now.</p>
          </div>
          <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 group hover:border-gray-700 transition-all duration-300">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-lg bg-blue-900/60 flex items-center justify-center">
                <svg className="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>
              </div>
              <h3 className="font-semibold text-sm">Telegram Bot</h3>
            </div>
            <p className="text-gray-400 text-xs">Ask questions in natural language, get market data, vault status, and trade history. Subscribe to real-time trade notifications.</p>
          </div>
          <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 group hover:border-gray-700 transition-all duration-300">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-lg bg-purple-900/60 flex items-center justify-center">
                <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" /></svg>
              </div>
              <h3 className="font-semibold text-sm">MCP Server</h3>
            </div>
            <p className="text-gray-400 text-xs">Query vault state, market data, reasoning logs, and guardian config from Claude Desktop or any MCP-compatible AI agent.</p>
          </div>
        </div>
      </section>

      {/* Powered By Footer */}
      <section className="border-t border-gray-800 pt-8 pb-4">
        <p className="text-center text-xs text-gray-600 mb-4 uppercase tracking-widest">Powered by</p>
        <div className="flex flex-wrap justify-center gap-3">
          {['Sui', 'DeepBook', 'Walrus', 'MemWal', 'Seal', 'Groq'].map((name) => (
            <span
              key={name}
              className="px-3 py-1.5 rounded-full text-xs font-medium bg-gray-800/80 text-gray-400 border border-gray-700/50 hover:border-sage-700/50 hover:text-sage-400 transition-colors"
            >
              {name}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ---------- Flow Diagram ---------- */

const flowSteps = [
  { label: 'Market Data', sub: 'DeepBook orderbook' },
  { label: 'AI Reasoner', sub: 'Groq LLM analysis' },
  { label: 'Guardian Checks', sub: 'Move-enforced limits' },
  { label: 'DeepBook Trade', sub: 'Atomic PTB execution' },
  { label: 'Walrus Storage', sub: 'Immutable reasoning log' },
  { label: 'On-Chain Hash', sub: 'SHA-256 verification' },
];

function FlowDiagram() {
  return (
    <div className="relative overflow-x-auto pb-4">
      <div className="flex items-center justify-start md:justify-center gap-0 min-w-[720px] px-4">
        {flowSteps.map((step, i) => (
          <div key={step.label} className="flex items-center animate-slide-in" style={{ animationDelay: `${i * 0.1}s` }}>
            {/* Step box */}
            <div className="flex flex-col items-center w-[110px]">
              <div className="w-10 h-10 rounded-full bg-sage-900/60 border border-sage-700/40 flex items-center justify-center text-sage-400 font-bold text-sm mb-2">
                {i + 1}
              </div>
              <span className="text-xs font-semibold text-gray-200 text-center leading-tight">{step.label}</span>
              <span className="text-[10px] text-gray-500 text-center mt-0.5 leading-tight">{step.sub}</span>
            </div>
            {/* Connecting arrow */}
            {i < flowSteps.length - 1 && (
              <div className="flex items-center mx-1">
                <svg width="36" height="12" viewBox="0 0 36 12" className="text-sage-600">
                  <line
                    x1="0" y1="6" x2="28" y2="6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeDasharray="4 4"
                    className="flow-arrow"
                  />
                  <polygon points="28,2 36,6 28,10" fill="currentColor" />
                </svg>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Sub-components ---------- */

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
    <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 group hover:border-gray-700 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-sage-900/10 animate-fade-in-up" style={{ animationDelay: `${parseInt(step) * 0.15}s`, animationFillMode: 'both' }}>
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
}: {
  title: string;
  description: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl p-4 border border-sage-500/30 bg-sage-500/5 transition-all duration-300 hover:-translate-y-0.5 hover:border-sage-500/50 hover:bg-sage-500/10">
      <h3 className="font-semibold mb-1 text-sm text-sage-300">{title}</h3>
      <p className="text-gray-400 text-xs">{description}</p>
    </div>
  );
}

function StatCard({
  label,
  value,
  unit,
  hint,
  loading,
}: {
  label: string;
  value: string;
  unit: string;
  hint: string;
  loading: boolean;
}) {
  return (
    <div className="group relative">
      <p className="text-gray-400 text-xs sm:text-sm mb-1">{label}</p>
      {loading ? (
        <div className="space-y-2">
          <div className="skeleton h-7 w-20" />
          <div className="skeleton h-3 w-14" />
        </div>
      ) : (
        <>
          <p className="text-xl sm:text-2xl font-bold">
            {value} <span className="text-xs sm:text-sm text-gray-500">{unit}</span>
          </p>
          <p className="text-xs text-gray-600 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {hint}
          </p>
        </>
      )}
    </div>
  );
}
