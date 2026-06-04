import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="space-y-16">
      {/* Hero */}
      <section className="text-center py-20">
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
            Open Portfolio
          </Link>
          <Link
            href="/reasoning"
            className="px-6 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-medium transition-colors"
          >
            View Reasoning
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section>
        <h2 className="text-2xl font-bold text-center mb-10">How It Works</h2>
        <div className="grid md:grid-cols-3 gap-6">
          <Card
            step="1"
            title="Deposit SUI"
            description="Deposit into the shared vault. You receive a DepositReceipt NFT representing your share of the vault."
          />
          <Card
            step="2"
            title="Agent Trades"
            description="Every 60 seconds, the AI agent analyzes DeepBook markets using Claude and executes optimal trades."
          />
          <Card
            step="3"
            title="Verify Reasoning"
            description="Every decision is stored on Walrus with full reasoning. Click any trade to see exactly why it was made."
          />
        </div>
      </section>

      {/* Track Coverage */}
      <section>
        <h2 className="text-2xl font-bold text-center mb-10">Track Coverage</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <TrackBadge
            track="Agentic Web"
            description="Claude-powered autonomous agent using Sui primitives"
            color="blue"
          />
          <TrackBadge
            track="Walrus"
            description="Every reasoning chain stored immutably as Walrus blobs"
            color="purple"
          />
          <TrackBadge
            track="DeepBook"
            description="All trading executed on DeepBook's orderbook"
            color="orange"
          />
          <TrackBadge
            track="DeFi & Payments"
            description="Vault contract with deposit, withdraw, and yield"
            color="green"
          />
        </div>
      </section>

      {/* Live Stats (placeholder) */}
      <section className="bg-gray-900 rounded-xl p-8">
        <h2 className="text-2xl font-bold mb-6">Live Agent Stats</h2>
        <div className="grid sm:grid-cols-4 gap-6">
          <StatCard label="Total Vault Value" value="--" unit="SUI" />
          <StatCard label="Trades Executed" value="--" unit="" />
          <StatCard label="Win Rate" value="--" unit="%" />
          <StatCard label="Reasoning Logs" value="--" unit="on Walrus" />
        </div>
      </section>
    </div>
  );
}

function Card({ step, title, description }: { step: string; title: string; description: string }) {
  return (
    <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
      <div className="w-8 h-8 bg-sage-900 text-sage-400 rounded-full flex items-center justify-center text-sm font-bold mb-4">
        {step}
      </div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-gray-400 text-sm">{description}</p>
    </div>
  );
}

function TrackBadge({ track, description, color }: { track: string; description: string; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'border-blue-500/30 bg-blue-500/5',
    purple: 'border-purple-500/30 bg-purple-500/5',
    orange: 'border-orange-500/30 bg-orange-500/5',
    green: 'border-sage-500/30 bg-sage-500/5',
  };

  return (
    <div className={`rounded-xl p-4 border ${colorMap[color]}`}>
      <h3 className="font-semibold mb-1">{track}</h3>
      <p className="text-gray-400 text-xs">{description}</p>
    </div>
  );
}

function StatCard({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div>
      <p className="text-gray-400 text-sm">{label}</p>
      <p className="text-2xl font-bold">
        {value} <span className="text-sm text-gray-500">{unit}</span>
      </p>
    </div>
  );
}
