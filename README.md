# SuiSage

**Autonomous DeFi Agent with Move-Enforced Guardrails & Verifiable Reasoning on Sui**

SuiSage is an AI-powered trading agent that autonomously trades SUI/USDC on [DeepBook](https://deepbook.tech), manages a shared vault on Sui, and stores every decision — with full reasoning — on [Walrus](https://walrus.xyz) for public audit. Guardian checks are enforced **in Move smart contracts**, not just TypeScript. A SHA-256 hash of every reasoning chain is committed on-chain so anyone can verify it matches the Walrus blob.

> **Sui Overflow 2026 — Agentic Web Track (Sub-track 2: Autonomous Agent Wallet)**

```
┌─────────────────────────────────────────────────────────────┐
│                    SuiSage Architecture                      │
│                                                              │
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
│                                                              │
│  Move Contracts enforce: budget ceiling, cooldown,           │
│  position concentration, deployment limits, performance fees │
│                                                              │
│                    Sui Blockchain                             │
└─────────────────────────────────────────────────────────────┘
```

## Hackathon Track: Agentic Web (Sub-track 2)

All **must-have** requirements for the Autonomous Agent Wallet sub-track are met:

| Requirement | How SuiSage Meets It |
|-------------|---------------------|
| **Real DeepBook Orders** | Limit orders on DeepBook V2 SUI/wUSDC pool via Programmable Transaction Blocks |
| **Self-Enforced Budget Ceiling** | `AgentCap.max_trade_size` checked in Move `withdraw_for_trading()` — the agent literally cannot withdraw more |
| **On-Chain Activity Log** | `TradeRecordEvent` emitted with Walrus blob ID + SHA-256 reasoning hash + guardian approval status |
| **Owner Revocation Demo** | `AdminCap.revoke_agent()` destroys the `AgentCap` object, instantly cutting agent access |

## What Makes This Different

This is not a generic LLM wrapper. Sui-specific primitives enforce safety at the contract level:

### Move-Enforced Guardian (On-Chain)
The `withdraw_for_trading()` function in `agent_auth.move` checks **7 conditions in Move** before releasing any funds:

1. **Agent active** — `AgentCap.active` must be true
2. **Vault not paused** — cannot trade when paused
3. **Strategy active** — `StrategyConfig.active` must be true
4. **Trade size** — amount ≤ `AgentCap.max_trade_size`
5. **Deployment limit** — total deployed ≤ `max_deployment_bps` of vault
6. **Position concentration** — trade ≤ `max_position_bps` of vault value (from StrategyConfig)
7. **Cooldown** — `Clock`-enforced minimum interval between trades

These are Move `assert!` checks — the transaction aborts if any fail. No off-chain workaround is possible.

### Verifiable Reasoning (SHA-256 Hash)
1. Agent generates reasoning JSON (market analysis, decision, guardian results)
2. JSON is stored on Walrus → returns blob ID
3. Agent computes `SHA-256(reasoning_json)` → reasoning hash
4. Both `blob_id` and `reasoning_hash` are committed on-chain in `TradeRecordEvent`
5. Anyone can fetch the Walrus blob, hash it, and compare against the on-chain hash

The dashboard does this verification automatically — showing "Verified" or "Mismatch" for each entry.

### Performance Fee Accounting
- ERC-4626 style share-based vault with **high-water mark NAV tracking**
- 10% performance fee on profits only (configurable by admin)
- `return_from_deployment()` calculates profit/loss, deducts fee from profit, updates high-water mark
- `PerformanceEvent` emitted with profit amount, fee taken, new NAV per share

### Dual-Layer Guardian
Risk checks run in **both** TypeScript (pre-flight) and Move (on-chain):
- TypeScript guardian runs 8 checks before building the transaction (spread, depth, slippage, budget, cooldown, concentration, confidence, vault health)
- Move guardian runs 7 checks when the transaction executes (budget, deployment, concentration, cooldown, agent/strategy/vault active)
- Even if the TypeScript guardian is bypassed (e.g., someone forks the agent), Move enforcement still blocks unauthorized trades

## How It Works

Every 60 seconds, the agent runs a cycle:

1. **Read Market** — Fetches live SUI/wUSDC orderbook from DeepBook (price, spread, depth)
2. **Read Vault** — Checks vault balance, deployed capital, NAV per share, performance data
3. **Load Memory** — Retrieves past decisions from Walrus, computes win rate, extracts patterns
4. **AI Reasoning** — Claude analyzes market + vault + memory and outputs a structured `TradeDecision`
5. **Guardian Validation** — 8 TypeScript risk checks + on-chain `devInspectTransactionBlock` validation
6. **Store on Walrus** — Full reasoning chain saved as immutable blob, SHA-256 hash computed
7. **Atomic Execution** — In a single PTB: withdraw funds → place DeepBook order → record trade with reasoning hash
8. **On-Chain Recording** — `TradeRecordEvent` with blob ID, reasoning hash, guardian status, confidence

## Project Structure

```
suisage/
├── contracts/                 # Move smart contracts (with tests)
│   └── sources/
│       ├── vault.move         # Share-based vault with performance fees
│       ├── agent_auth.move    # Agent capability + on-chain guardian enforcement
│       ├── strategy.move      # Risk parameters (admin-controlled)
│       ├── vault_tests.move   # 10 vault unit tests
│       └── agent_auth_tests.move  # 9 agent auth unit tests
│
├── packages/shared/           # Shared TypeScript types & constants
│
├── agent/                     # Node.js autonomous agent
│   └── src/
│       ├── index.ts           # Main agent loop
│       ├── market-reader.ts   # DeepBook orderbook reads
│       ├── reasoner.ts        # Claude API → TradeDecision
│       ├── executor.ts        # DeepBook orders + atomic PTB + reasoning hash
│       ├── guardian.ts        # Pre-trade risk validation (8 checks, dual-layer)
│       ├── memory-manager.ts  # Walrus-backed learning/memory layer
│       ├── walrus-logger.ts   # Store/retrieve reasoning on Walrus
│       ├── vault-manager.ts   # Read vault + agent cap + strategy state
│       ├── predict.ts         # DeepBook Predict integration (testnet)
│       ├── telegram.ts        # AI-powered Telegram bot
│       └── client.ts          # SuiClient + DeepBookClient setup
│
├── dashboard/                 # Next.js frontend
│   └── src/app/
│       ├── page.tsx           # Landing page with live on-chain stats
│       ├── portfolio/         # Deposit/withdraw + vault performance
│       ├── reasoning/         # Reasoning timeline with hash verification
│       └── admin/             # Vault management + strategy parameters
│
├── mcp-server/                # MCP server for Claude Desktop
└── scripts/
    └── deploy.sh              # 5-step contract deployment script
```

## Quick Start

### Prerequisites

- Node.js 18+
- [Sui CLI](https://docs.sui.io/build/install)
- [Anthropic API key](https://console.anthropic.com/)
- Funded Sui wallet (for gas + trading)

### 1. Clone & Install

```bash
git clone https://github.com/AhmedKhan-GIT/SuiSage.git
cd suisage
npx pnpm install
```

### 2. Run Contract Tests

```bash
cd contracts
sui move test
```

This runs 19 Move unit tests covering vault operations, guardian enforcement, and edge cases.

### 3. Deploy Contracts

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh testnet
```

Deploys all contracts and creates: Vault, AdminCap, StrategyConfig, and AgentCap. Outputs the object IDs.

### 4. Configure Environment

```bash
cp .env.example .env
```

Fill in your `.env`:

```env
AGENT_PRIVATE_KEY=suiprivkey1...
VAULT_PACKAGE_ID=0x...
VAULT_OBJECT_ID=0x...
AGENT_CAP_ID=0x...
STRATEGY_CONFIG_ID=0x...
ANTHROPIC_API_KEY=sk-ant-...
```

### 5. Build & Run

```bash
npx pnpm build
npx pnpm agent:dev      # Start the agent
npx pnpm dashboard:dev  # Start the dashboard (separate terminal)
```

## Smart Contracts

### vault.move
- **Share-based accounting** — Users deposit SUI and receive proportional shares (ERC-4626 style)
- **Performance fees** — 10% fee on profits above high-water mark NAV
- **DepositReceipt NFT** — Proof of deposit, required for withdrawal
- **Emergency withdraw** — Users can always exit, even when paused
- **NAV tracking** — `vault_nav_per_share()`, `vault_total_profit()`, `vault_total_loss()`

### agent_auth.move
- **AdminCap / AgentCap** — Capability-based access control
- **On-chain guardian** — `withdraw_for_trading()` enforces 7 Move checks (budget, cooldown, concentration, deployment, active status)
- **Reasoning hash** — `record_trade()` stores SHA-256 hash + Walrus blob ID in `TradeRecordEvent`
- **Agent stats** — Tracks total trades, total volume, last trade timestamp on-chain
- **Performance fee admin** — `set_performance_fee()`, `withdraw_fees()`

### strategy.move
- **Risk parameters** — Max position size, stop-loss, trade cooldown, max open positions
- **Pool whitelist** — `is_pool_allowed()` for restricting trading pools
- **Admin-controlled** — Only AdminCap holder can modify parameters

## Move Tests (19 total)

### Vault Tests (10)
- `test_create_vault` — initial state and default 10% fee
- `test_first_deposit_1_to_1_shares` — 1:1 share minting
- `test_proportional_shares_on_second_deposit`
- `test_full_withdraw`, `test_partial_withdraw`
- `test_deposit_when_paused_fails`
- `test_emergency_withdraw_when_paused`
- `test_nav_per_share`
- `test_vault_total_value_includes_deployed`
- `test_withdraw_blocked_when_funds_deployed`
- `test_profit_tracking_and_fees` — verifies 10 SUI profit → 1 SUI fee

### Agent Auth Tests (9)
- `test_authorize_and_check_agent_cap`
- `test_withdraw_for_trading_within_limits`
- `test_withdraw_exceeds_max_trade_size` (expected failure)
- `test_withdraw_exceeds_position_concentration` (expected failure)
- `test_cooldown_enforcement` (expected failure)
- `test_record_trade_with_reasoning_hash`
- `test_revoke_agent`
- `test_trading_blocked_when_paused` (expected failure)
- `test_trading_blocked_when_strategy_inactive` (expected failure)

## Guardian Risk Layer

### TypeScript Pre-Flight (8 checks)

| Check | What It Does |
|-------|-------------|
| Budget Ceiling | Trade size within AgentCap's `max_trade_size` |
| Spread | Rejects if spread exceeds 50 bps |
| Position Concentration | No single trade > 30% of vault value |
| Liquidity Depth | Minimum 100 units on relevant book side |
| Confidence Floor | AI confidence must be ≥ 30% |
| Trade Cooldown | Minimum 30s between trades |
| Slippage Estimate | Expected slippage < 100 bps |
| Vault Health | Vault active with non-zero balance |

### Move On-Chain Enforcement (7 checks)

| Check | Move Error Code |
|-------|----------------|
| Agent active | `EAgentNotActive (107)` |
| Vault not paused | `EVaultPaused (109)` |
| Strategy active | `EStrategyNotActive (108)` |
| Trade size ≤ max | `EExceedsMaxTradeSize (101)` |
| Deployment limit | `EExceedsDeploymentLimit (103)` |
| Position concentration | `EPositionTooConcentrated (105)` |
| Cooldown (Clock) | `ECooldownNotMet (104)` |

If the TypeScript guardian is bypassed (e.g., forked agent), Move enforcement still blocks the transaction.

## Walrus Memory System

SuiSage reads back past decisions from Walrus to learn:

1. On-chain `TradeRecordEvent`s contain Walrus blob IDs
2. Memory manager fetches those blobs from Walrus
3. Computes: win rate, PnL per trade, average confidence, behavioral patterns
4. Injects memory context into Claude's prompt for the next decision

### Reasoning Hash Verification
- Every reasoning JSON is hashed with SHA-256 before the trade transaction
- The hash is stored in `TradeRecordEvent.reasoning_hash` on-chain
- The dashboard fetches the Walrus blob, re-computes the hash, and compares
- Any tampering of the Walrus blob would produce a hash mismatch

## MemWal Integration

[MemWal](https://github.com/MystenLabs/memwal) provides persistent, encrypted, semantically-searchable agent memory on Walrus.

**Three namespaces:**
- `suisage-trades` — Individual trade decisions with outcomes
- `suisage-patterns` — Discovered market patterns
- `suisage-shared` — Cross-agent shared intelligence

## Seal Privacy Layer

Optional [Seal](https://github.com/MystenLabs/seal) threshold encryption for sensitive reasoning data. Access control defined by Move `seal_approve` function.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AGENT_PRIVATE_KEY` | **Yes** | Agent wallet private key (`suiprivkey...` format) |
| `VAULT_PACKAGE_ID` | **Yes** | Package ID from deployment |
| `VAULT_OBJECT_ID` | **Yes** | Vault shared object ID |
| `AGENT_CAP_ID` | **Yes** | AgentCap object ID |
| `STRATEGY_CONFIG_ID` | **Yes** | StrategyConfig object ID |
| `ANTHROPIC_API_KEY` | **Yes** | Claude API key |
| `SUI_NETWORK` | No | `mainnet` or `testnet` (default: `mainnet`) |
| `SUI_RPC_URL` | No | Custom RPC URL |
| `DEEPBOOK_POOL_ID` | No | DeepBook pool (default: SUI/wUSDC) |
| `ACCOUNT_CAP_ID` | No | DeepBook AccountCap (auto-created if empty) |
| `TELEGRAM_BOT_TOKEN` | No | Telegram bot token |
| `AGENT_LOOP_INTERVAL_MS` | No | Cycle interval in ms (default: `60000`) |
| `MAX_TRADE_SIZE_SUI` | No | Max SUI per trade (default: `10`) |
| `WALRUS_AGGREGATOR_URL` | No | Walrus aggregator endpoint |
| `WALRUS_PUBLISHER_URL` | No | Walrus publisher endpoint |

## Tech Stack

- **Blockchain**: Sui (Move smart contracts with 19 unit tests)
- **DEX**: DeepBook V2 (`@mysten/deepbook` SDK)
- **Storage**: Walrus (decentralized blob storage) + SHA-256 hash on-chain
- **Memory**: MemWal (`@mysten-incubation/memwal`)
- **Privacy**: Seal (`@mysten/seal`) — threshold encryption
- **AI**: Claude (Anthropic API)
- **Agent**: Node.js + TypeScript
- **Frontend**: Next.js 14 + Tailwind CSS + `@mysten/dapp-kit`
- **Telegram**: grammy framework
- **MCP**: `@modelcontextprotocol/sdk`

## License

MIT
