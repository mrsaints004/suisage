# SuiSage

**Autonomous DeFi Agent with Verifiable AI Reasoning on Sui**

SuiSage is an AI-powered trading agent that autonomously trades SUI/USDC on [DeepBook](https://deepbook.tech), manages a shared vault on Sui, and stores every decision — with full reasoning — on [Walrus](https://walrus.xyz) for public audit. No black box. Every trade is explainable, every decision is verifiable.

```
┌─────────────────────────────────────────────────────────────┐
│                      SuiSage Architecture                   │
│                                                             │
│  ┌──────────┐    ┌──────────────────────────────────────┐   │
│  │ Telegram │◄──►│          AI Agent (Claude)            │   │
│  │   Bot    │    │                                      │   │
│  └──────────┘    │  ┌────────┐  ┌────────┐  ┌────────┐ │   │
│                  │  │ Market │  │Reasoner│  │Executor│ │   │
│  ┌──────────┐    │  │ Reader │  │(Claude)│  │(Trade) │ │   │
│  │   MCP    │◄──►│  └───┬────┘  └───┬────┘  └───┬────┘ │   │
│  │  Server  │    │      │           │           │      │   │
│  └──────────┘    └──────┼───────────┼───────────┼──────┘   │
│                         │           │           │           │
│  ┌──────────┐     ┌─────▼─────┐ ┌───▼───┐ ┌────▼──────┐   │
│  │Dashboard │     │ DeepBook  │ │Walrus │ │   Vault   │   │
│  │ (Next.js)│────►│ Orderbook │ │(Blobs)│ │(Move/Sui) │   │
│  └──────────┘     └───────────┘ └───────┘ └───────────┘   │
│                                                             │
│                    Sui Blockchain (Mainnet)                  │
└─────────────────────────────────────────────────────────────┘
```

## How It Works

Every 60 seconds, the agent runs a 9-step cycle:

1. **Read Market** — Fetches live SUI/wUSDC orderbook from DeepBook (price, spread, depth)
2. **Read Vault** — Checks vault balance, deployed capital, share accounting
3. **Check Position** — Reads current DeepBook account balance
4. **Load Memory** — Retrieves past decisions from Walrus, computes win rate, extracts patterns
5. **AI Reasoning** — Claude analyzes market data + vault state + **Walrus memory** and outputs a structured decision
6. **Guardian Validation** — 8 automated risk checks (spread, depth, slippage, budget, cooldown, concentration, confidence, vault health) + on-chain AgentCap validation via `devInspectTransactionBlock`
7. **Store on Walrus** — Saves the full reasoning chain (including guardian results and memory context) as an immutable blob
8. **Atomic Execution** — Trade + on-chain recording in a single **Programmable Transaction Block** (PTB)
9. **Predict Check** — Optionally reads DeepBook Predict markets (testnet)

**Why Sui specifically makes this better:**
- **Move objects (AgentCap)** enforce budget ceiling at the type level — the AI literally cannot exceed its limits
- **PTBs** make trade execution + on-chain recording atomic — if either fails, both roll back
- **AdminCap** enables instant revocation — owner can cut agent access in one transaction
- **Walrus** provides verifiable, immutable AI memory — not just logging, but a learning loop

## Track Coverage (Sui Overflow 2026)

| Track | How SuiSage Uses It |
|-------|-------------------|
| **Agentic Web** | Autonomous Agent Wallet: Claude-powered agent with Move-enforced budget ceiling, on-chain activity log, owner revocation, guardian risk layer |
| **Walrus** | Verifiable AI memory + MemWal persistent encrypted memory + Seal threshold encryption. Agent stores decisions on Walrus, reads them back for learning, uses MemWal for semantic recall, and optionally encrypts with Seal. Cross-agent memory sharing via namespaces. |
| **DeepBook** | Real limit orders on DeepBook V2 (SUI/wUSDC), with optional DeepBook Predict integration (testnet binary predictions) |
| **DeFi & Payments** | Share-based vault (ERC-4626 style), DepositReceipt NFTs, emergency withdraw, working deposit/withdraw UI with PTB composability |

## Project Structure

```
suisage/
├── contracts/               # Move smart contracts
│   └── sources/
│       ├── vault.move       # Share-based vault (deposit, withdraw, accounting)
│       ├── agent_auth.move  # Agent capability + trade recording on-chain
│       └── strategy.move    # Risk parameters (admin-controlled)
│
├── packages/shared/         # Shared TypeScript types & constants
│
├── agent/                   # Node.js autonomous agent
│   └── src/
│       ├── index.ts         # Main 9-step loop
│       ├── market-reader.ts # DeepBook orderbook reads
│       ├── reasoner.ts      # Claude API → TradeDecision (with memory context)
│       ├── executor.ts      # DeepBook orders + atomic PTB execution
│       ├── guardian.ts      # Pre-trade risk validation (8 checks)
│       ├── memory-manager.ts# Walrus-backed learning/memory layer
│       ├── predict.ts       # DeepBook Predict integration (testnet)
│       ├── walrus-logger.ts # Store/retrieve reasoning on Walrus
│       ├── vault-manager.ts # Read vault state from chain
│       ├── telegram.ts      # AI-powered Telegram bot
│       └── client.ts        # SuiClient + DeepBookClient setup
│
├── dashboard/               # Next.js frontend
│   └── src/app/
│       ├── page.tsx         # Landing page
│       ├── portfolio/       # Deposit/withdraw + vault overview
│       └── reasoning/       # Reasoning timeline (the demo centerpiece)
│
└── mcp-server/              # MCP server (5 tools for Claude Desktop)
```

## Quick Start

### Prerequisites

- Node.js 18+
- [Sui CLI](https://docs.sui.io/build/install) installed
- An [Anthropic API key](https://console.anthropic.com/) (for Claude)
- A funded Sui wallet (for gas + trading)
- (Optional) A Telegram bot token from [@BotFather](https://t.me/BotFather)

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/suisage.git
cd suisage
npx pnpm install
```

### 2. Deploy Contracts

```bash
# Make the deploy script executable
chmod +x scripts/deploy.sh

# Deploy to mainnet (or testnet)
./scripts/deploy.sh mainnet
```

This will deploy all 3 contracts and print the object IDs you need for `.env`. Copy the output.

### 3. Configure Environment

```bash
cp .env.example .env
```

Fill in your `.env`:

```env
# Required
AGENT_PRIVATE_KEY=suiprivkey1...          # Your agent wallet private key
VAULT_PACKAGE_ID=0x...                     # From deploy script output
VAULT_OBJECT_ID=0x...                      # From deploy script output
AGENT_CAP_ID=0x...                         # From deploy script output
STRATEGY_CONFIG_ID=0x...                   # From deploy script output
ANTHROPIC_API_KEY=sk-ant-...               # From console.anthropic.com

# Optional
TELEGRAM_BOT_TOKEN=123456:ABC...           # From @BotFather
ACCOUNT_CAP_ID=                            # Auto-created on first trade if empty
```

### 4. Build & Run

```bash
# Build everything
npx pnpm build

# Start the agent
npx pnpm agent:dev

# In another terminal, start the dashboard
npx pnpm dashboard:dev
```

The agent will begin its 60-second cycle immediately. The dashboard opens at `http://localhost:3000`.

### 5. (Optional) Start MCP Server

Add to your Claude Desktop `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "suisage": {
      "command": "node",
      "args": ["path/to/suisage/mcp-server/dist/index.js"]
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUI_NETWORK` | No | `mainnet` or `testnet` (default: `mainnet`) |
| `SUI_RPC_URL` | No | Custom RPC URL (default: Sui public fullnode) |
| `AGENT_PRIVATE_KEY` | **Yes** | Agent wallet private key (bech32 `suiprivkey...` format) |
| `VAULT_PACKAGE_ID` | **Yes** | Package ID from contract deployment |
| `VAULT_OBJECT_ID` | **Yes** | Vault shared object ID |
| `AGENT_CAP_ID` | **Yes** | AgentCap object ID (from `authorize_agent`) |
| `STRATEGY_CONFIG_ID` | No | StrategyConfig object ID |
| `DEEPBOOK_POOL_ID` | No | DeepBook pool (default: SUI/wUSDC 0.02% fee pool) |
| `ACCOUNT_CAP_ID` | No | DeepBook AccountCap (auto-created if empty) |
| `ANTHROPIC_API_KEY` | **Yes** | Claude API key |
| `TELEGRAM_BOT_TOKEN` | No | Telegram bot token for notifications |
| `AGENT_LOOP_INTERVAL_MS` | No | Cycle interval in ms (default: `60000`) |
| `MAX_TRADE_SIZE_SUI` | No | Max SUI per trade (default: `10`) |
| `WALRUS_AGGREGATOR_URL` | No | Walrus aggregator endpoint |
| `WALRUS_PUBLISHER_URL` | No | Walrus publisher endpoint |

## Guardian Risk Layer

Every trade passes through 8 automated risk checks BEFORE execution:

| Check | What It Does |
|-------|-------------|
| Budget Ceiling | Trade size must be within AgentCap's `max_trade_size` (Move-enforced) |
| Spread | Rejects if bid-ask spread exceeds 50 bps (illiquid market) |
| Position Concentration | No single trade can exceed 30% of vault value |
| Liquidity Depth | Minimum 100 units on the relevant side of the book |
| Confidence Floor | AI confidence must be at least 30% |
| Trade Cooldown | Minimum 30 seconds between trades (prevents overtrading) |
| Slippage Estimate | Expected slippage must be under 100 bps |
| Vault Health | Vault must be active (not paused) with non-zero balance |

If ANY check fails, the trade is **blocked** — and the blocked decision is still recorded on-chain for transparency. The guardian results are stored in every Walrus reasoning blob.

Additionally, on-chain validation runs via `devInspectTransactionBlock` to verify the trade against the AgentCap's Move-enforced limits before execution.

## Walrus Memory System

SuiSage doesn't just log to Walrus — it **reads back** past decisions to learn:

1. On-chain `TradeRecordEvent`s contain Walrus blob IDs
2. The memory manager fetches those blobs from Walrus
3. It computes: win rate, PnL per trade, average confidence, best/worst trades
4. It extracts behavioral patterns (e.g., "struggles in BEARISH markets")
5. All of this is injected into Claude's prompt for the next decision

This creates a genuine learning loop where the agent improves over time, with all memory stored on a verifiable, decentralized data layer.

## MemWal Integration (Persistent Encrypted Memory)

SuiSage integrates [MemWal](https://github.com/MystenLabs/memwal) (`@mysten-incubation/memwal`) for persistent, encrypted, semantically-searchable agent memory stored on Walrus.

**Three memory namespaces:**
- **`suisage-trades`** — Individual trade decisions with outcomes
- **`suisage-patterns`** — Discovered market patterns (e.g., "spread widens before volatility")
- **`suisage-shared`** — Cross-agent shared intelligence (any SuiSage instance can read)

**How it works:**
1. After each trade, `rememberTrade()` stores the decision with semantic embedding
2. Before each decision, `buildMemWalContext()` does semantic recall across all namespaces
3. High-confidence trades are automatically shared via `shareWithAgents()`
4. The agent can ask natural language questions about its history (e.g., "what happened when spread was wide?")

**Cross-agent memory sharing:** Multiple SuiSage instances share the `suisage-shared` namespace. One agent discovers a pattern → all agents benefit. This creates a collective intelligence layer on Walrus.

## Seal Privacy Layer (Encrypted Reasoning)

SuiSage optionally encrypts reasoning data using [Seal](https://github.com/MystenLabs/seal) (`@mysten/seal`) before storing on Walrus.

**Why this matters:**
- Trading reasoning contains sensitive strategy information
- Seal uses threshold encryption — no single key server can decrypt alone
- Access control is defined by a Move function (`seal_approve`) — on-chain policy
- Only authorized parties (vault depositors, admin) can decrypt reasoning blobs
- Encrypted data is stored on Walrus — encrypted at rest, publicly verifiable metadata

**Flow:**
1. Agent generates reasoning JSON
2. Seal encrypts with threshold encryption using on-chain policy
3. Encrypted blob stored on Walrus
4. Authorized users call `seal_approve` Move function to prove access
5. Seal key servers release decryption shares only if policy check passes

## Smart Contracts

### vault.move
- **Share-based accounting** — Users deposit SUI and receive proportional shares (like ERC-4626)
- **DepositReceipt NFT** — Proof of deposit, required for withdrawal
- **Emergency withdraw** — Users can always exit, even if agent is offline
- **Package-level deploy/return** — Only the agent module can move funds to/from trading

### agent_auth.move
- **AdminCap / AgentCap** — Capability-based access control
- **Trade recording** — Every trade is recorded on-chain with Walrus blob ID reference
- **Pause/unpause** — Admin can halt agent operations instantly

### strategy.move
- **Risk parameters** — Max position size, stop-loss, allowed pools, trade intervals
- **Admin-controlled** — Only the vault admin can modify strategy parameters

## Telegram Bot

The Telegram bot provides both **slash commands** and **AI conversation**:

| Command | Description |
|---------|-------------|
| `/start` | Welcome message with quick-action buttons |
| `/help` | Command reference + natural language tips |
| `/market` | Live SUI/USDC orderbook data |
| `/vault` | Vault balance and status |
| `/trades` | Recent trade decisions with "Why?" buttons |
| `/status` | Agent health, uptime, network info |
| `/subscribe` | Get notified on every trade |

You can also just **chat naturally**: "Why did you buy?", "How's the market?", "Explain your strategy" — the bot uses Claude to respond with live data context.

## Tech Stack

- **Blockchain**: Sui (Move contracts)
- **DEX**: DeepBook V2 (`@mysten/deepbook` SDK)
- **Storage**: Walrus (decentralized blob storage)
- **Memory**: MemWal (`@mysten-incubation/memwal`) — persistent encrypted agent memory
- **Privacy**: Seal (`@mysten/seal`) — threshold encryption with on-chain access policy
- **AI**: Claude (Anthropic API) — both for trading reasoning and Telegram chat
- **Agent**: Node.js + TypeScript
- **Frontend**: Next.js 14 + Tailwind CSS + `@mysten/dapp-kit`
- **Telegram**: grammy framework
- **MCP**: `@modelcontextprotocol/sdk` for Claude Desktop integration

## License

MIT
