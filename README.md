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

Every 60 seconds, the agent runs a cycle:

1. **Read Market** — Fetches live SUI/wUSDC orderbook from DeepBook (price, spread, depth)
2. **Read Vault** — Checks vault balance, deployed capital, share accounting
3. **AI Reasoning** — Claude analyzes market data + vault state + recent history and outputs a structured decision (BUY / SELL / HOLD / REBALANCE) with confidence %, reasoning, and risk assessment
4. **Execute Trade** — Places a real order on DeepBook if action is not HOLD
5. **Store on Walrus** — Saves the full reasoning chain as an immutable blob on Walrus
6. **Record On-Chain** — Writes the trade + Walrus blob ID on-chain so anyone can verify

The key insight: **click any trade on the dashboard and read exactly why the AI made that decision**, fetched directly from Walrus. No hidden logic, no trust required.

## Track Coverage (Sui Overflow 2026)

| Track | How SuiSage Uses It |
|-------|-------------------|
| **Agentic Web** | Claude-powered autonomous agent making real trading decisions on Sui |
| **Walrus** | Every reasoning chain stored immutably as Walrus blobs, referenced on-chain |
| **DeepBook** | All trading executed on DeepBook V2 orderbook (SUI/wUSDC pool) |
| **DeFi & Payments** | Share-based vault contract (deposit/withdraw/yield) on Sui |

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
│       ├── index.ts         # Main 60-second loop
│       ├── market-reader.ts # DeepBook orderbook reads
│       ├── reasoner.ts      # Claude API → TradeDecision
│       ├── executor.ts      # DeepBook order placement
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
- **AI**: Claude (Anthropic API) — both for trading reasoning and Telegram chat
- **Agent**: Node.js + TypeScript
- **Frontend**: Next.js 14 + Tailwind CSS + `@mysten/dapp-kit`
- **Telegram**: grammy framework
- **MCP**: `@modelcontextprotocol/sdk` for Claude Desktop integration

## License

MIT
