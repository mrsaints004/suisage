# SuiSage — Safe Autonomous Agent Wallet Framework

**A framework for building autonomous agent wallets with Move-enforced guardrails and verifiable reasoning on Sui.**

> *Safety limits enforced by smart contracts, not just code. Every decision stored immutably on Walrus with a SHA-256 hash committed on-chain for public verification.*

SuiSage demonstrates a reusable pattern for **safe autonomous agent wallets** on Sui. The reference implementation manages a shared vault, trades SUI/USDC on [DeepBook](https://deepbook.tech), and stores every decision — with full reasoning — on [Walrus](https://walrus.xyz) for public audit. Guardian checks are enforced **in Move smart contracts**, not just TypeScript. Even if someone forks the agent code and removes all safety checks, the Move contracts still block unauthorized actions.

## The Core Trust Problem

AI agents are stuck at the "approve wall" — every action needs a human signature. When agents do get autonomous access, the safety rails are in application code that can be bypassed by anyone who forks the repo. There's no way to:

- **Cryptographically verify** what an AI agent was thinking when it traded your money
- **Enforce budget limits** that the agent physically cannot exceed, even if compromised
- **Revoke access** instantly without the agent's cooperation
- **Share learning** across agent instances through persistent, verifiable memory

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
| Privacy for reasoning | Seal threshold encryption | Optional encrypted reasoning with policy-based access |

## Architecture

```
                          SuiSage Architecture

  Telegram Bot ◄──► ┌──────────────────────────────────┐
                    │         AI Agent (Groq/Claude)     │
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
        │  │Orderbook │ │Blobs │ │  (Move)      │           │
        │  │+ Predict │ │+Hash │ │ 7 on-chain   │           │
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

## Must-Have Requirements (All Met)

| Requirement | Implementation |
|-------------|---------------|
| **Real DeepBook Orders** | Limit orders on DeepBook SUI/wUSDC pool via Programmable Transaction Blocks |
| **Self-Enforced Budget Ceiling** | `AgentCap.max_trade_size` checked in Move `withdraw_for_trading()` — the agent literally cannot withdraw more |
| **On-Chain Activity Log** | `TradeRecordEvent` emitted with Walrus blob ID + SHA-256 reasoning hash + guardian approval status |
| **Owner Revocation Demo** | `AdminCap.revoke_agent()` destroys the `AgentCap` object, instantly cutting agent access |

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
- **MemWal semantic memory**: Agent recalls past trades by similarity ("what happened when spread was wide?")
- **Cross-agent intelligence**: Multiple SuiSage instances share patterns via `suisage-shared` namespace
- **Learning loop**: Win rate, PnL patterns, and market condition performance fed back to AI reasoner

### 4. DeepBook Predict Integration

Optional integration with DeepBook's testnet prediction markets:
- Reads oracle prices, implied volatility, and strike probabilities
- Feeds prediction market sentiment into trading decisions
- Ready for mainnet day-one deployment

### 5. Seal Privacy Layer

Optional threshold encryption for sensitive reasoning data:
- Reasoning encrypted before Walrus storage
- Access control via Move `seal_approve` policy
- Vault depositors can decrypt; outsiders cannot

## How It Works

Every 60 seconds, the agent runs a 9-step cycle:

```
1. Read Market      → DeepBook orderbook (bid/ask, spread, depth)
2. Read Vault       → Balance, deployed, total value, NAV per share
3. Check Position   → DeepBook available base/quote
4. Load Memory      → Past decisions from Walrus + MemWal semantic recall
   4b. Predict      → DeepBook Predict market sentiment (if configured)
5. AI Decision      → Groq/Claude LLM analysis with full memory context
6. Guardian Checks  → TypeScript pre-flight (8 checks) + on-chain validation
7. Store on Walrus  → Reasoning JSON → blob ID, SHA-256 hash computed
8. Execute Trade    → Atomic PTB: withdraw → trade → record (Move guardian enforced)
9. Record & Share   → MemWal persistent memory + cross-agent intelligence sharing
```

## Smart Contracts (3 modules, 19 tests)

### vault.move (406 LOC)
- ERC-4626 style share-based vault with performance fee tracking
- High-water mark NAV prevents fee gaming
- Emergency withdraw bypasses pause (user protection)
- 10 unit tests

### agent_auth.move (354 LOC)
- Capability-based access control (AdminCap + AgentCap)
- 7 Move `assert!` checks in `withdraw_for_trading()`
- `record_trade()` stores Walrus blob ID + reasoning hash on-chain
- `revoke_agent()` destroys AgentCap (instant access revocation)
- 9 unit tests

### strategy.move (173 LOC)
- Admin-controlled risk parameters
- Pool whitelist, position limits, cooldown, stop-loss

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
├── agent/                     # Node.js autonomous agent
│   └── src/
│       ├── index.ts           # Main 9-step agent loop (multi-vault)
│       ├── reasoner.ts        # LLM decision engine (Groq/Claude)
│       ├── executor.ts        # DeepBook PTB execution + reasoning hash
│       ├── guardian.ts        # Dual-layer risk validation (8+7 checks)
│       ├── market-reader.ts   # DeepBook orderbook + price feeds
│       ├── memory-manager.ts  # Walrus-backed learning system
│       ├── walrus-logger.ts   # Store/retrieve with retry + local fallback
│       ├── memwal-client.ts   # Persistent semantic memory (3 namespaces)
│       ├── seal-client.ts     # Threshold encryption for reasoning
│       ├── predict.ts         # DeepBook Predict integration
│       ├── telegram.ts        # AI-powered Telegram bot
│       ├── vault-manager.ts   # Read on-chain vault/agent/strategy state
│       ├── vault-discovery.ts # Auto-discover managed vaults
│       ├── client.ts          # SuiClient + DeepBook setup
│       ├── config.ts          # Environment config loader
│       └── __tests__/         # Integration tests (vitest)
│
├── dashboard/                 # Next.js 14 frontend
│   └── src/app/
│       ├── page.tsx           # Landing page with live stats + how-it-works
│       ├── portfolio/         # Deposit/withdraw + performance chart
│       ├── reasoning/         # Reasoning timeline + hash verification
│       ├── guardian/          # Interactive guardian enforcement demo
│       ├── admin/             # Vault management + strategy parameters
│       ├── components/        # Navbar, PerformanceChart, Toast, etc.
│       └── context/           # Multi-vault selection context
│
├── packages/shared/           # Shared TypeScript types & constants
├── mcp-server/                # MCP server for Claude Desktop
└── scripts/deploy.sh          # 5-step contract deployment
```

## Quick Start

### Prerequisites
- Node.js 18+, [Sui CLI](https://docs.sui.io/build/install)
- [Groq API key](https://console.groq.com/) (free tier) or [Anthropic API key](https://console.anthropic.com/)
- Funded Sui wallet

### 1. Clone & Install
```bash
git clone https://github.com/mrsaints004/suisage.git
cd suisage && npx pnpm install
```

### 2. Run Contract Tests
```bash
cd contracts && sui move test    # 19 Move tests
cd ../agent && npx pnpm test     # TypeScript integration tests
```

### 3. Deploy Contracts
```bash
chmod +x scripts/deploy.sh && ./scripts/deploy.sh testnet
```

### 4. Configure & Run
```bash
cp .env.example .env  # Fill in your keys and deployed object IDs

# Dashboard env (required for frontend)
cp dashboard/.env.local.example dashboard/.env.local
# Edit dashboard/.env.local with your VAULT_PACKAGE_ID and other values

npx pnpm build
npx pnpm --filter agent dev        # Start the agent
npx pnpm --filter dashboard dev    # Start the dashboard (http://localhost:3000)
```

## Deployment

**Testnet Package ID:** `0x4f4419eaa848151f9adffa2386aa5ea40a6bfefe3ec930a5c2629dc826bdb53b`

## Guardian Risk Checks

### TypeScript Pre-Flight (Layer 1)

| Check | Threshold | What Happens |
|-------|-----------|-------------|
| Budget Ceiling | `AgentCap.max_trade_size` | Trade blocked before submission |
| Spread | ≤ 50 bps | Prevents trading in illiquid conditions |
| Position Concentration | ≤ 30% of vault | No single over-sized bet |
| Liquidity Depth | ≥ 100 units | Ensures sufficient orderbook depth |
| Confidence Floor | ≥ 30% | Rejects low-conviction trades |
| Trade Cooldown | ≥ 30s | Prevents overtrading |
| Slippage Estimate | < 100 bps | Protects against price impact |
| Vault Health | Active, non-zero balance | Basic sanity |

### Move On-Chain Enforcement (Layer 2)

| Check | Move Error Code | Bypassed If Forked? |
|-------|----------------|-------------------|
| Agent active | `EAgentNotActive (107)` | **NO** |
| Vault not paused | `EVaultPaused (109)` | **NO** |
| Strategy active | `EStrategyNotActive (108)` | **NO** |
| Trade size ≤ max | `EExceedsMaxTradeSize (101)` | **NO** |
| Deployment limit | `EExceedsDeploymentLimit (103)` | **NO** |
| Position concentration | `EPositionTooConcentrated (105)` | **NO** |
| Cooldown (Clock) | `ECooldownNotMet (104)` | **NO** |

## Competitive Analysis

| Feature | SuiSage | Generic AI Trading Bots | Eliza/AutoGPT |
|---------|---------|------------------------|---------------|
| On-chain safety limits | Move `assert!` enforcement | App-level only | None |
| Verifiable reasoning | SHA-256 hash on-chain + Walrus | None | None |
| Persistent memory | Walrus + MemWal | In-memory only | Local files |
| Cross-agent learning | MemWal shared namespace | None | None |
| Instant revocation | Destroy AgentCap object | Kill process | Kill process |
| Privacy layer | Seal threshold encryption | None | None |
| Atomic execution | Sui PTB (withdraw+trade+record) | Multi-step | Multi-step |

## Beyond Trading: The Framework

SuiSage's architecture is not specific to trading. The same pattern — **capability-gated agent + on-chain guardrails + verifiable reasoning** — applies to any autonomous agent that handles value:

| Use Case | Agent Action | Move Guardrail |
|----------|-------------|---------------|
| **Payment Agent** | Send payments on behalf of a business | Budget ceiling, recipient whitelist, daily limit |
| **DAO Treasury Bot** | Execute approved proposals | Proposal quorum check, spending cap, timelock |
| **Gaming NPC** | Trade in-game assets, manage guild treasury | Asset type whitelist, value cap per trade |
| **DeFi Yield Agent** | Rebalance across lending protocols | Max allocation per protocol, slippage limit |
| **Subscription Manager** | Auto-renew services, manage recurring payments | Max amount per period, approved vendors |

The `AgentCap` + `AdminCap` pattern, dual-layer guardian, and Walrus reasoning logs are reusable building blocks for any agent that needs **autonomous access with provable constraints**.

## Roadmap

**Q3 2026 — Mainnet Launch**
- Mainnet deployment with audited contracts
- Multi-strategy support (momentum, mean-reversion, range)
- DeepBook Predict mainnet integration

**Q4 2026 — Institutional Features**
- Multi-depositor vaults with role-based access
- Performance analytics dashboard with backtesting
- Governance voting on strategy parameters

**Q1 2027 — Platform Expansion**
- SuiSage-as-a-Service: anyone can deploy a managed vault
- Cross-protocol strategies (lending + trading + prediction)
- Mobile app with push notifications

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Blockchain | Sui (Move smart contracts, 19 unit tests) |
| DEX | DeepBook (`@mysten/deepbook` SDK) |
| Prediction Markets | DeepBook Predict (testnet) |
| Storage | Walrus (decentralized blob storage) + SHA-256 hash on-chain |
| Memory | MemWal (`@mysten-incubation/memwal`) — persistent semantic recall |
| Privacy | Seal (`@mysten/seal`) — threshold encryption |
| AI | Groq (llama-3.3-70b) / Claude (Anthropic API) |
| Agent | Node.js + TypeScript + vitest |
| Frontend | Next.js 14 + Tailwind CSS + Recharts + `@mysten/dapp-kit` |
| Telegram | grammy framework + Groq-powered chat |
| MCP | `@modelcontextprotocol/sdk` (Claude Desktop integration) |

## License

MIT

---

<sub>Built for [Sui Overflow 2026](https://suioverflow.com) — Agentic Web Track (Sub-track 2: Autonomous Agent Wallet)</sub>
