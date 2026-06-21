# SuiSage — Autonomous AI Trading Agent with Verifiable Reasoning

**An autonomous AI trading agent on Sui with verifiable reasoning on Walrus, persistent memory via MemWal, and encrypted decision logs via Seal.**

> *Every decision stored immutably on Walrus with a SHA-256 hash committed on-chain. Safety limits enforced by Move smart contracts, not just code.*

SuiSage manages a shared DeFi vault on Sui, trades SUI/USDC on [DeepBook V3](https://deepbook.tech), and stores every decision — with full reasoning — on [Walrus](https://walrus.xyz) for public audit. The agent has persistent memory via [MemWal](https://memory.walrus.xyz) and encrypted reasoning via [Seal](https://docs.seal.walrus.xyz). Guardian checks are enforced **in Move smart contracts** — even if someone forks the agent code and removes all safety checks, the Move contracts still block unauthorized actions.

> For full technical documentation, architecture details, and contract specifications, see **[DOCUMENTATION.md](./DOCUMENTATION.md)**.

## Mainnet Deployment

| Object | ID |
|--------|---|
| **Vault Package** | `0x257060c387b3bc3b3e516dc0e99ef06f57536e73aa2e8e1c530f26d60bb06f14` |
| **Seal Policy Package** | `0xbab048ffc7c206b6c25b5b15d2feae9b09ad9366a03ae1a3a6d9dac5643e2ac6` |
| Vault Object | `0xf0b3db5453f556996adc8f99d6d0f2c1cf3a28e04ceba33b06faa394a4344de0` |
| Agent Cap | `0x23a2e87bf43a8fcad5c7eed7ac0573d64740f4a8106119016f2c713c79143277` |
| Strategy Config | `0xd4912806f36657c7fbc36e69049df649052540c58fe20c9a75db16773af9b71d` |
| Agent Address | `0xa242f7d5f2cf145dac190151c80a1f3c7b4034eff8f6e43da023366538fd7ea5` |
| Seal Policy Object | `0xa64c1979c6988eaf8aff777110fc19d3f5b6ae685aa4c8809bcdfca51f8c57dd` |
| DeepBook V3 Pool | `0xe05dafb5133bcffb8d59f4e12465dc0e9faeaa05e3e342a08fe135800e3e4407` |

**Testnet Package ID:** `0x4f4419eaa848151f9adffa2386aa5ea40a6bfefe3ec930a5c2629dc826bdb53b`

## The Core Trust Problem

AI agents are stuck at the "approve wall" — every action needs a human signature. When agents do get autonomous access, the safety rails are in application code that can be bypassed by anyone who forks the repo. There's no way to:

- **Cryptographically verify** what an AI agent was thinking when it traded your money
- **Enforce budget limits** that the agent physically cannot exceed, even if compromised
- **Revoke access** instantly without the agent's cooperation
- **Persist learning** across sessions through durable, verifiable memory

## The Solution

SuiSage uses Sui-native primitives to solve each of these:

| Problem | Sui Primitive | SuiSage Implementation |
|---------|--------------|----------------------|
| Verify agent reasoning | Walrus + SHA-256 | Reasoning stored on Walrus, hash committed on-chain |
| Enforce budget limits | Move `assert!` + Capability pattern | `withdraw_for_trading()` enforces 7 on-chain checks |
| Instant revocation | Object ownership (AdminCap/AgentCap) | `revoke_agent()` destroys AgentCap — access gone |
| Persistent memory | Walrus + MemWal | Semantic recall across sessions and agent instances |
| Atomic execution | Programmable Transaction Blocks | Withdraw → Trade → Record in single atomic PTB |
| Cooldown enforcement | `sui::clock::Clock` | On-chain time-based enforcement, not agent-controlled |
| Privacy for reasoning | Seal threshold encryption | Encrypted reasoning with whitelist-based access |

## Architecture

```
                          SuiSage Architecture

  Telegram Bot ◄──► ┌──────────────────────────────────┐
                    │         AI Agent (Groq LLM)        │
  MCP Server  ◄──► │                                    │
  (Claude Desktop)  │  Market   AI        Guardian       │
                    │  Reader  Reasoner  (8+7 checks)   │
                    │    │        │          │           │
                    └────┼────────┼──────────┼───────────┘
                         │        │          │
        ┌────────────────┼────────┼──────────┼──────────────┐
        │                ▼        ▼          ▼              │
        │  ┌──────────┐ ┌──────┐ ┌─────────────┐           │
        │  │ DeepBook │ │Walrus│ │  Vault+Auth  │           │
        │  │ V3 CLOB  │ │Blobs │ │  (Move)      │           │
        │  │orderbook │ │+Hash │ │ 7 on-chain   │           │
        │  └──────────┘ └──────┘ │ assert! chks │           │
        │                        └─────────────┘           │
        │  ┌──────┐  ┌────┐  ┌──────────────────┐          │
        │  │MemWal│  │Seal│  │ Dashboard        │          │
        │  │Memory│  │Enc.│  │ (Next.js)        │          │
        │  └──────┘  └────┘  └──────────────────┘          │
        │                                                   │
        │               Sui Blockchain                      │
        └───────────────────────────────────────────────────┘
```

## Smart Contracts (4 modules across 2 packages)

### Package 1: `suisage` (Mainnet: `0x2570...`)

| Module | LOC | Description |
|--------|-----|-------------|
| `vault.move` | 406 | Share-based vault with NAV tracking, high-water mark performance fees, emergency withdraw |
| `agent_auth.move` | 354 | AgentCap + AdminCap capability pattern, 7 Move-enforced guardian checks, TradeRecordEvent with Walrus blob ID + SHA-256 hash |
| `strategy.move` | 173 | On-chain risk parameters (position limits, stop-loss, cooldown, pool whitelist) |

Tests: `vault_tests.move` (296 LOC, 10 tests) + `agent_auth_tests.move` (321 LOC, 9 tests) = **19 unit tests**

### Package 2: `seal_policy` (Mainnet: `0xbab0...`)

| Module | LOC | Description |
|--------|-----|-------------|
| `whitelist.move` | 75 | Seal encryption access control — whitelist-based decryption policy for reasoning blobs on Walrus |

> For detailed contract specifications, function signatures, and error codes, see **[DOCUMENTATION.md](./DOCUMENTATION.md)**.

## Key Differentiators

### 1. Dual-Layer Guardian (TypeScript + Move)

**TypeScript Layer (8 pre-flight checks):**
Budget ceiling, spread, position concentration, liquidity depth, confidence floor, cooldown, slippage, vault health.

**Move Layer (7 on-chain enforced checks):**
Agent active, vault not paused, strategy active, trade size, deployment limit, position concentration, cooldown (Clock-enforced).

The Move layer uses `assert!` — the transaction aborts if ANY check fails. Even if someone forks the agent code and removes all TypeScript checks, the Move contracts still block unauthorized trades.

### 2. Verifiable Reasoning (SHA-256 Hash Commitment)

1. Agent generates reasoning JSON (market analysis, decision, guardian results)
2. JSON is stored on Walrus → returns blob ID
3. Agent computes `SHA-256(reasoning_json)` → reasoning hash
4. Both `blob_id` and `reasoning_hash` are committed on-chain in `TradeRecordEvent`
5. Anyone can fetch the Walrus blob, hash it, and compare against the on-chain hash

The dashboard does this verification automatically — showing "Verified" or "Mismatch".

### 3. Persistent Memory (Walrus + MemWal)

- **Walrus blobs**: Every reasoning chain is stored immutably, referenced by on-chain blob IDs
- **MemWal semantic memory**: Agent recalls past trades, tracks win rate, adapts strategy
- **Learning loop**: Performance metrics and market condition patterns fed back to AI reasoner every cycle

### 4. Seal Privacy Layer

Threshold encryption for sensitive reasoning data:
- Reasoning encrypted before Walrus storage using Seal
- Access control via Move `seal_approve` whitelist policy
- Vault owner manages decryption whitelist — add/remove auditors on-chain
- On-chain hash still proves integrity even when content is encrypted

## How It Works

Every 2-15 minutes (adaptive polling), the agent runs a decision cycle:

```
1. Read Market      → DeepBook V3 orderbook (bid/ask, spread, depth, imbalance)
2. Read Vault       → Balance, deployed amount, total value, NAV per share
3. Load Memory      → Past decisions from Walrus + MemWal persistent memory
4. AI Decision      → Groq LLM analysis with full memory context
5. Guardian Checks  → TypeScript pre-flight (8 checks)
6. Store on Walrus  → Reasoning JSON → blob ID, SHA-256 hash computed
7. Execute Trade    → Atomic PTB: withdraw → swap on DeepBook V3 → return → record
8. Update Memory    → MemWal persistent memory updated with decision outcome
9. Notify           → Telegram bot sends decision summary to subscribers
```

## Project Structure

```
suisage/
├── contracts/                 # Move smart contracts (3 modules, 19 tests)
│   └── sources/
│       ├── vault.move         # Share-based vault with performance fees
│       ├── agent_auth.move    # Agent capability + on-chain guardian
│       ├── strategy.move      # Risk parameters (admin-controlled)
│       ├── vault_tests.move   # 10 vault unit tests
│       └── agent_auth_tests.move  # 9 agent auth unit tests
│
├── seal-policy/               # Seal encryption policy contract
│   └── sources/
│       └── whitelist.move     # Whitelist-based decryption access control
│
├── agent/                     # Node.js autonomous agent
│   └── src/
│       ├── index.ts           # Main agent loop (multi-vault, adaptive polling)
│       ├── reasoner.ts        # LLM decision engine (Groq)
│       ├── executor.ts        # DeepBook V3 PTB execution + reasoning hash
│       ├── guardian.ts        # Dual-layer risk validation (8+7 checks)
│       ├── market-reader.ts   # DeepBook V3 orderbook + price feeds
│       ├── memory-manager.ts  # Walrus-backed learning system
│       ├── walrus-logger.ts   # Store/retrieve reasoning blobs
│       ├── memwal-client.ts   # Persistent semantic memory
│       ├── seal-client.ts     # Threshold encryption for reasoning
│       ├── telegram.ts        # AI-powered Telegram bot
│       ├── vault-manager.ts   # Read on-chain vault/agent/strategy state
│       ├── vault-discovery.ts # Auto-discover managed vaults via AgentCap
│       ├── decisions-log.ts   # Local decision log for dashboard
│       ├── client.ts          # SuiClient + DeepBook setup
│       └── config.ts          # Environment config loader
│
├── dashboard/                 # Next.js 14 frontend
│   └── src/app/
│       ├── page.tsx           # Landing page with live stats
│       ├── portfolio/         # Deposit/withdraw + vault performance
│       ├── reasoning/         # Reasoning timeline + SHA-256 hash verification
│       ├── admin/             # Vault management + AI Smart Setup chat
│       ├── api/               # API routes (chat-config, decisions)
│       ├── components/        # Navbar, Toast, shared components
│       └── context/           # Multi-vault selection context
│
├── packages/shared/           # Shared TypeScript types & constants
├── mcp-server/                # MCP server for Claude Desktop
└── scripts/deploy.sh          # Contract deployment script
```

## Quick Start

### Prerequisites
- Node.js 18+, [Sui CLI](https://docs.sui.io/build/install)
- [Groq API key](https://console.groq.com/) (free tier)
- Funded Sui wallet

### 1. Clone & Install
```bash
git clone https://github.com/mrsaints004/suisage.git
cd suisage && npx pnpm install
```

### 2. Run Contract Tests
```bash
cd contracts && sui move test    # 19 Move tests
```

### 3. Deploy Contracts
```bash
chmod +x scripts/deploy.sh && ./scripts/deploy.sh testnet
```

### 4. Configure & Run
```bash
cp .env.example .env  # Fill in your keys and deployed object IDs
cp dashboard/.env.local.example dashboard/.env.local

npx pnpm build
npx pnpm --filter agent dev        # Start the agent
npx pnpm --filter dashboard dev    # Start the dashboard (http://localhost:3000)
```

## Telegram Bot

SuiSage includes an AI-powered Telegram bot for monitoring the vault and receiving trade notifications.

| Command | What It Does |
|---------|-------------|
| `/link 0xAddr` | Link your Sui wallet address (read-only lookup) |
| `/portfolio` | Your shares, current value, P&L, and vault share % |
| `/market` | Live SUI/USDC price, spread, and depth from DeepBook |
| `/vault` | Vault balance, deployed amount, and status |
| `/trades` | Recent trade decisions with confidence and reasoning |
| `/subscribe` | Get push notifications when the agent trades |
| `/status` | Agent uptime, cycle interval, subscriber count |

Users can also ask natural language questions — the bot uses Groq to answer with live vault and market data.

## MCP Server (Claude Desktop)

SuiSage provides an MCP server so Claude Desktop can query vault state, market data, and reasoning logs.

| Tool | Description |
|------|------------|
| `get_vault_state` | Vault balance, shares, NAV, deployed amount, fees |
| `get_market_state` | DeepBook orderbook (bid/ask/spread) |
| `get_reasoning` | Fetch full reasoning from Walrus by blob ID |
| `get_recent_trades` | Last N trades with decision data |
| `get_agent_architecture` | System overview and how SuiSage works |
| `get_guardian_config` | Risk check thresholds (TypeScript + Move) |

## Access Everywhere

| Interface | Best For | Capabilities |
|-----------|----------|-------------|
| **Dashboard** (Next.js) | Full management | Deposit/withdraw, reasoning verification, admin controls, AI Smart Setup |
| **Telegram Bot** | Mobile monitoring | Portfolio, market data, trade notifications, natural language chat |
| **MCP Server** | AI-to-AI queries | Claude Desktop queries vault/market/reasoning data programmatically |

All three interfaces read from the same on-chain state. The agent is the only process that writes.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Blockchain | Sui (mainnet) |
| Smart Contracts | Move (4 modules across 2 packages, 19 unit tests) |
| DEX | DeepBook V3 (native CLOB, SUI/USDC on mainnet) |
| Storage | Walrus (immutable blob storage) + SHA-256 hash on-chain |
| Memory | MemWal — persistent semantic recall across sessions |
| Privacy | Seal — threshold encryption with whitelist policy |
| AI | Groq (llama-3.1-8b-instant) |
| Agent | Node.js + TypeScript |
| Frontend | Next.js 14 + Tailwind CSS + @mysten/dapp-kit |
| Telegram | grammy framework + Groq-powered chat |
| MCP | @modelcontextprotocol/sdk (Claude Desktop) |

## License

MIT

---

<sub>Built for [Sui Overflow 2026](https://suioverflow.com) — Walrus Track</sub>
