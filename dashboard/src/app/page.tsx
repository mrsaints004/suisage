'use client';

import Link from 'next/link';
import { useCurrentAccount } from '@mysten/dapp-kit';

export default function HomePage() {
  const account = useCurrentAccount();

  return (
    <div className="space-y-16">
      {/* Hero */}
      <section className="text-center py-20">
        <div className="inline-block px-3 py-1 rounded-full bg-sage-900/50 text-sage-400 text-xs font-medium mb-6 border border-sage-800/50">
          Sui Overflow 2026
        </div>
        <h1 className="text-5xl font-bold mb-6">
          <span className="text-sage-400">SuiSage</span>
        </h1>
        <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-4">
          Autonomous DeFi Agent with Verifiable Reasoning
        </p>
        <p className="text-gray-500 max-w-xl mx-auto mb-8">
          An AI agent that trades on DeepBook, manages your vault on Sui,
          and stores every decision with full reasoning on Walrus for public audit.
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
          Three simple steps. Your funds are managed by AI, and every decision is publicly verifiable.
        </p>
        <div className="grid md:grid-cols-3 gap-6">
          <Card
            step="1"
            title="Deposit SUI"
            description="Connect your wallet and deposit SUI into the shared vault. You receive shares representing your ownership — like buying into a fund."
            learnMore="Shares work like stock: if you own 10% of shares, you own 10% of the vault's total value."
          />
          <Card
            step="2"
            title="Agent Trades"
            description="Every 60 seconds, the AI reads the live orderbook on DeepBook, analyzes market conditions, and decides whether to buy, sell, or hold."
            learnMore="The agent uses Claude AI with real market data — prices, depth, spread, and recent history."
          />
          <Card
            step="3"
            title="Verify Reasoning"
            description="Every decision is stored on Walrus with full reasoning. Click any trade to see exactly why it was made — no hidden logic."
            learnMore="Walrus is decentralized storage on Sui. Once stored, reasoning data cannot be changed or deleted."
          />
        </div>
      </section>

      {/* Track Coverage */}
      <section>
        <h2 className="text-2xl font-bold text-center mb-3">Built on Sui</h2>
        <p className="text-gray-500 text-center mb-10 max-w-lg mx-auto text-sm">
          SuiSage covers all four Sui Overflow hackathon tracks in a single, cohesive product.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <TrackBadge
            track="Agentic Web"
            description="Claude-powered autonomous agent making real trading decisions on Sui"
            color="blue"
            icon="🤖"
          />
          <TrackBadge
            track="Walrus"
            description="Every reasoning chain stored immutably as Walrus blobs"
            color="purple"
            icon="🐘"
          />
          <TrackBadge
            track="DeepBook"
            description="All trading executed on DeepBook's central limit orderbook"
            color="orange"
            icon="📊"
          />
          <TrackBadge
            track="DeFi & Payments"
            description="Share-based vault contract with deposit, withdraw, and yield"
            color="green"
            icon="💰"
          />
        </div>
      </section>

      {/* Live Stats */}
      <section className="bg-gray-900 rounded-xl p-8 border border-gray-800">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">Live Agent Stats</h2>
          <span className="flex items-center gap-2 text-xs text-gray-400">
            <span className="w-2 h-2 rounded-full bg-sage-500 animate-pulse" />
            Auto-refreshes
          </span>
        </div>
        <div className="grid sm:grid-cols-4 gap-6">
          <StatCard label="Total Vault Value" value="--" unit="SUI" hint="Total SUI managed by the agent" />
          <StatCard label="Trades Executed" value="--" unit="" hint="Number of BUY/SELL trades recorded on-chain" />
          <StatCard label="Current Price" value="--" unit="USD" hint="Live SUI/USDC mid-price from DeepBook" />
          <StatCard label="Reasoning Logs" value="--" unit="on Walrus" hint="Decision logs stored immutably" />
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

function TrackBadge({
  track,
  description,
  color,
  icon,
}: {
  track: string;
  description: string;
  color: string;
  icon: string;
}) {
  const colorMap: Record<string, string> = {
    blue: 'border-blue-500/30 bg-blue-500/5',
    purple: 'border-purple-500/30 bg-purple-500/5',
    orange: 'border-orange-500/30 bg-orange-500/5',
    green: 'border-sage-500/30 bg-sage-500/5',
  };

  return (
    <div className={`rounded-xl p-4 border ${colorMap[color]}`}>
      <span className="text-2xl mb-2 block">{icon}</span>
      <h3 className="font-semibold mb-1">{track}</h3>
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
