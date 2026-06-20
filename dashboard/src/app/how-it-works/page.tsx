'use client';

export default function HowItWorksPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-16 py-8">
      {/* Header */}
      <section className="text-center">
        <h1 className="text-3xl sm:text-4xl font-bold mb-4">How SuiSage Works</h1>
        <p className="text-gray-400 max-w-2xl mx-auto">
          SuiSage is an autonomous agent that trades on your behalf — with strict on-chain rules
          that make it impossible for it to steal funds or exceed limits. Here&apos;s the full picture.
        </p>
      </section>

      {/* The One-Liner */}
      <section className="bg-sage-900/20 border border-sage-800/40 rounded-xl p-6 sm:p-8 text-center">
        <p className="text-lg sm:text-xl text-sage-300 font-medium leading-relaxed">
          You deposit SUI into a vault. An autonomous agent trades it on DeepBook (a decentralized exchange).
          Move smart contracts enforce safety limits the agent cannot bypass. Every decision is stored
          on Walrus with a hash on-chain so anyone can verify what happened.
        </p>
      </section>

      {/* Step-by-Step */}
      <section>
        <h2 className="text-2xl font-bold mb-8 text-center">Step by Step</h2>
        <div className="space-y-0">
          <Step
            number={1}
            title="You Create a Vault"
            who="Admin (you)"
            what="Go to the Admin page and click &quot;Create Vault.&quot; This deploys a smart contract on Sui that holds funds and enforces trading rules."
            result="You get a Vault (holds SUI), an AgentCap (the agent's permission slip), and a StrategyConfig (the safety rules)."
            isLast={false}
          />
          <Step
            number={2}
            title="Users Deposit SUI"
            who="Any wallet holder"
            what="Go to the Portfolio page, connect your wallet, and deposit SUI. You receive shares that represent your portion of the vault — like shares in a fund."
            result="Your SUI is in the vault. You hold a DepositReceipt NFT that tracks your shares."
            isLast={false}
          />
          <Step
            number={3}
            title="The Agent Analyzes the Market"
            who="Agent (automated)"
            what="Every 60 seconds, the agent reads the DeepBook orderbook (bid/ask prices, depth, spread) and the current SUI price. It analyzes this data and decides: should I buy, sell, or hold?"
            result="The agent produces a decision with full reasoning — why it chose that action, what signals it saw, and a confidence score."
            isLast={false}
          />
          <Step
            number={4}
            title="Guardian Checks Block Bad Trades"
            who="TypeScript + Move contracts"
            what={`Before any trade executes, it passes through two layers of checks:

• TypeScript Guardian (off-chain): 15 checks including trade size, concentration limits, confidence threshold, cooldown period, and portfolio exposure.

• Move Guardian (on-chain): The smart contract independently enforces max trade size, cooldown timer (using Sui's Clock — can't be faked), and deployment limits. Even if the TypeScript layer is compromised, the Move contract will reject illegal trades.`}
            result="Only trades that pass BOTH layers get executed. Failed checks are logged with the reason."
            isLast={false}
          />
          <Step
            number={5}
            title="Trade Executes on DeepBook"
            who="Agent via Programmable Transaction Block"
            what="The agent builds a single atomic transaction that: withdraws SUI from the vault, places the trade on DeepBook, records the trade result, and returns any remaining funds — all in one transaction. If any step fails, everything reverts."
            result="The trade is executed. The vault balance updates. A TradeRecordEvent is emitted on-chain."
            isLast={false}
          />
          <Step
            number={6}
            title="Reasoning is Stored on Walrus"
            who="Agent"
            what="The full reasoning (market data, analysis, decision, confidence score) is uploaded to Walrus — a decentralized storage network. This creates a permanent, tamper-proof record. A SHA-256 hash of this reasoning is then committed on-chain in the TradeRecordEvent."
            result="Anyone can fetch the Walrus blob and verify its hash matches what's on-chain. If they don't match, the reasoning was tampered with."
            isLast={false}
          />
          <Step
            number={7}
            title="You Withdraw Anytime"
            who="Any depositor"
            what="Go to Portfolio, click Withdraw. Your shares are burned and you receive your proportional SUI back — including any trading profits (minus a 10% performance fee on profits only)."
            result="Your SUI (plus gains or minus losses) is back in your wallet."
            isLast={true}
          />
        </div>
      </section>

      {/* Key Concepts */}
      <section>
        <h2 className="text-2xl font-bold mb-8 text-center">Key Concepts Explained</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Concept
            term="Vault"
            explanation="A smart contract that holds SUI. Think of it like a shared bank account — multiple people can deposit, and the AI agent is authorized to trade with the funds, but only within strict limits."
          />
          <Concept
            term="AgentCap"
            explanation="A Move object that acts as the agent's permission slip. Without it, the agent can't touch the vault. It defines the maximum trade size and links the agent to a specific vault."
          />
          <Concept
            term="StrategyConfig"
            explanation="The safety rulebook stored on-chain. Contains: max trade size, cooldown between trades, max % of vault that can be deployed, and position limits. The agent must obey these — they're enforced by the smart contract."
          />
          <Concept
            term="NAV / Share"
            explanation="Net Asset Value per share. Starts at 1.0. If the agent makes profitable trades, it goes above 1.0 (your shares are worth more). If it loses, it drops below 1.0. This is how you track performance."
          />
          <Concept
            term="Guardian"
            explanation="A two-layer safety system. Layer 1 (TypeScript) runs 15 checks before submitting a trade. Layer 2 (Move smart contract) independently enforces rules on-chain. Both must approve for a trade to go through."
          />
          <Concept
            term="Walrus"
            explanation="A decentralized storage network built on Sui. The agent uploads its full reasoning (why it made each trade) to Walrus. This creates a permanent record that can't be deleted or altered."
          />
          <Concept
            term="SHA-256 Hash"
            explanation="A fingerprint of the reasoning data. The agent stores this fingerprint on-chain. Anyone can download the Walrus blob, compute its hash, and compare — if they match, the data hasn't been tampered with."
          />
          <Concept
            term="DeepBook"
            explanation="A decentralized exchange (DEX) built on Sui with a central limit order book. The agent places buy and sell orders here. It's fully on-chain — no middleman."
          />
          <Concept
            term="DepositReceipt"
            explanation="An NFT you receive when you deposit SUI. It records how many shares you own and at what NAV you entered. You need this receipt to withdraw your funds."
          />
          <Concept
            term="Programmable Transaction Block (PTB)"
            explanation="A Sui feature that bundles multiple operations into one atomic transaction. The agent uses this to withdraw → trade → record in a single step. If any part fails, nothing happens — no partial states."
          />
        </div>
      </section>

      {/* Architecture Diagram */}
      <section>
        <h2 className="text-2xl font-bold mb-4 text-center">Architecture</h2>
        <p className="text-gray-500 text-center mb-8 text-sm">How the components connect</p>
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 sm:p-8 overflow-x-auto">
          <div className="min-w-[600px] space-y-6">
            {/* Row 1: User interfaces */}
            <div className="flex justify-center gap-4">
              <ArchBox label="Web Dashboard" sub="Next.js" color="sage" />
              <ArchBox label="Telegram Bot" sub="Grammy" color="blue" />
              <ArchBox label="MCP Server" sub="Claude Desktop" color="purple" />
            </div>
            <Arrow />
            {/* Row 2: Agent */}
            <div className="flex justify-center">
              <div className="bg-gray-800 rounded-xl border border-gray-700 px-8 py-4 text-center max-w-md w-full">
                <p className="text-sm font-semibold text-white mb-1">SuiSage Agent</p>
                <p className="text-xs text-gray-400">Node.js process running every 60s</p>
                <div className="flex justify-center gap-3 mt-3">
                  <MiniBox label="Reasoner" />
                  <MiniBox label="Guardian" />
                  <MiniBox label="Executor" />
                </div>
              </div>
            </div>
            <Arrow />
            {/* Row 3: On-chain */}
            <div className="flex justify-center gap-4">
              <ArchBox label="Sui Blockchain" sub="Move contracts" color="sage" />
              <ArchBox label="DeepBook DEX" sub="Order book" color="sage" />
              <ArchBox label="Walrus" sub="Reasoning storage" color="sage" />
            </div>
          </div>
        </div>
      </section>

      {/* Safety Guarantees */}
      <section>
        <h2 className="text-2xl font-bold mb-4 text-center">What the Agent Cannot Do</h2>
        <p className="text-gray-500 text-center mb-8 text-sm">These are enforced by Move smart contracts — not just promises</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Guarantee text="Cannot trade more than the max trade size set in AgentCap" />
          <Guarantee text="Cannot trade more frequently than the cooldown period" />
          <Guarantee text="Cannot deploy more than the max % of vault funds" />
          <Guarantee text="Cannot withdraw funds to its own wallet" />
          <Guarantee text="Cannot change its own safety limits (only admin can)" />
          <Guarantee text="Cannot delete or alter past reasoning logs on Walrus" />
          <Guarantee text="Cannot fake the on-chain hash — it's computed from actual data" />
          <Guarantee text="Cannot operate without a valid AgentCap for that specific vault" />
        </div>
      </section>

      {/* FAQ */}
      <section>
        <h2 className="text-2xl font-bold mb-8 text-center">Common Questions</h2>
        <div className="space-y-4">
          <FAQ
            q="What happens if the agent makes a bad trade?"
            a="The guardian limits how much can be traded at once (e.g., max 10 SUI per trade). A single bad decision has limited impact. The agent also can't trade again until the cooldown expires, preventing panic-selling spirals."
          />
          <FAQ
            q="Can the agent drain the vault?"
            a="No. The Move contract limits how much of the vault can be deployed for trading (e.g., max 50%). The rest stays safely in the vault. And the agent can only trade on DeepBook — it can't send funds to arbitrary addresses."
          />
          <FAQ
            q="What if the agent's server goes down?"
            a="Nothing bad happens. The funds sit safely in the vault smart contract on Sui. Users can still withdraw anytime. When the server comes back, the agent resumes trading."
          />
          <FAQ
            q="Why not just trade manually?"
            a="You can. SuiSage is for people who want 24/7 automated trading with provable safety guarantees. The agent watches the market continuously and makes decisions with full transparency."
          />
          <FAQ
            q="How do I verify the agent isn't lying about its reasoning?"
            a="Go to the Reasoning page. Each entry shows the Walrus blob ID and the on-chain SHA-256 hash. Click 'Verify Hash' — it downloads the blob from Walrus, computes the hash locally, and compares it to the on-chain hash. If they match, the reasoning is authentic."
          />
          <FAQ
            q="What's the performance fee?"
            a="10% on profits only, calculated using a high-water mark. If the NAV/Share goes from 1.0 to 1.1, the fee is 10% of the 0.1 gain. If the vault loses money, no fee is charged until it recovers past its previous high."
          />
        </div>
      </section>
    </div>
  );
}

/* ---------- Sub-components ---------- */

function Step({
  number,
  title,
  who,
  what,
  result,
  isLast,
}: {
  number: number;
  title: string;
  who: string;
  what: string;
  result: string;
  isLast: boolean;
}) {
  return (
    <div className="flex gap-4 sm:gap-6">
      {/* Timeline */}
      <div className="flex flex-col items-center">
        <div className="w-10 h-10 rounded-full bg-sage-900 border-2 border-sage-600 flex items-center justify-center text-sage-400 font-bold text-sm shrink-0">
          {number}
        </div>
        {!isLast && <div className="w-0.5 bg-gray-800 flex-1 my-1" />}
      </div>
      {/* Content */}
      <div className="pb-10">
        <h3 className="text-lg font-semibold text-white mb-1">{title}</h3>
        <p className="text-xs text-sage-400 mb-3 font-medium">Who: {who}</p>
        <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-line mb-3">{what}</p>
        <div className="bg-gray-900 rounded-lg border border-gray-800 px-4 py-3">
          <p className="text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">Result</p>
          <p className="text-sm text-gray-300">{result}</p>
        </div>
      </div>
    </div>
  );
}

function Concept({ term, explanation }: { term: string; explanation: string }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
      <h3 className="text-sm font-semibold text-sage-400 mb-2">{term}</h3>
      <p className="text-sm text-gray-400 leading-relaxed">{explanation}</p>
    </div>
  );
}

function ArchBox({ label, sub, color }: { label: string; sub: string; color: string }) {
  const colors: Record<string, string> = {
    sage: 'border-sage-700/40 bg-sage-900/20',
    blue: 'border-blue-700/40 bg-blue-900/20',
    purple: 'border-purple-700/40 bg-purple-900/20',
  };
  return (
    <div className={`rounded-lg border px-5 py-3 text-center ${colors[color] || colors.sage}`}>
      <p className="text-sm font-semibold text-white">{label}</p>
      <p className="text-xs text-gray-500">{sub}</p>
    </div>
  );
}

function MiniBox({ label }: { label: string }) {
  return (
    <span className="px-2.5 py-1 rounded bg-gray-700/50 text-xs text-gray-300 font-medium">
      {label}
    </span>
  );
}

function Arrow() {
  return (
    <div className="flex justify-center">
      <svg width="16" height="24" viewBox="0 0 16 24" className="text-gray-600">
        <line x1="8" y1="0" x2="8" y2="18" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
        <polygon points="4,18 8,24 12,18" fill="currentColor" />
      </svg>
    </div>
  );
}

function Guarantee({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3 bg-gray-900 rounded-lg border border-gray-800 px-4 py-3">
      <svg className="w-5 h-5 text-red-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
      </svg>
      <p className="text-sm text-gray-300">{text}</p>
    </div>
  );
}

function FAQ({ q, a }: { q: string; a: string }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
      <h3 className="text-sm font-semibold text-white mb-2">{q}</h3>
      <p className="text-sm text-gray-400 leading-relaxed">{a}</p>
    </div>
  );
}
