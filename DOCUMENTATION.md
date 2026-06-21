# SuiSage — Full Technical Documentation

This document provides complete technical details for SuiSage: contract specifications, function signatures, error codes, data flows, and integration details.

For an overview and quick start, see [README.md](./README.md).

---

## Table of Contents

1. [Mainnet Deployment](#1-mainnet-deployment)
2. [Smart Contract Specifications](#2-smart-contract-specifications)
   - [vault.move](#21-vaultmove)
   - [agent_auth.move](#22-agent_authmove)
   - [strategy.move](#23-strategymove)
   - [seal_policy/whitelist.move](#24-seal_policywhitelistmove)
3. [Dual-Layer Guardian System](#3-dual-layer-guardian-system)
4. [Walrus Integration](#4-walrus-integration)
5. [MemWal Integration](#5-memwal-integration)
6. [Seal Integration](#6-seal-integration)
7. [DeepBook V3 Integration](#7-deepbook-v3-integration)
8. [Agent Runtime](#8-agent-runtime)
9. [Dashboard](#9-dashboard)
10. [Telegram Bot](#10-telegram-bot)
11. [MCP Server](#11-mcp-server)
12. [Data Flow Diagrams](#12-data-flow-diagrams)

---

## 1. Mainnet Deployment

### Package 1: suisage (Vault + Agent Auth + Strategy)

- Package ID: `0x257060c387b3bc3b3e516dc0e99ef06f57536e73aa2e8e1c530f26d60bb06f14`
- Chain ID: `35834a8a` (Sui Mainnet)
- Upgrade Capability: `0x5e58e3628838887fd7758f71c9d6e26f2e55fc188b2f92f22d58fec1ad0a4f48`

### Package 2: seal_policy (Whitelist Encryption Policy)

- Package ID: `0xbab048ffc7c206b6c25b5b15d2feae9b09ad9366a03ae1a3a6d9dac5643e2ac6`
- Chain ID: `35834a8a` (Sui Mainnet)
- Upgrade Capability: `0xe9a0555306a5bf067269f0fc12205e13332399e45a23a8f56f6eb3a19eb98de0`

### Live Objects

| Object | ID |
|--------|---|
| Vault | `0xf0b3db5453f556996adc8f99d6d0f2c1cf3a28e04ceba33b06faa394a4344de0` |
| Agent Cap | `0x23a2e87bf43a8fcad5c7eed7ac0573d64740f4a8106119016f2c713c79143277` |
| Strategy Config | `0xd4912806f36657c7fbc36e69049df649052540c58fe20c9a75db16773af9b71d` |
| Agent Address | `0xa242f7d5f2cf145dac190151c80a1f3c7b4034eff8f6e43da023366538fd7ea5` |
| Seal Policy Object | `0xa64c1979c6988eaf8aff777110fc19d3f5b6ae685aa4c8809bcdfca51f8c57dd` |
| Seal Key Server Object | `0x686098f1439237fff9f36b99c7329683c22979d2005c2465cb891acb012a7595` |
| DeepBook V3 Pool (SUI/USDC) | `0xe05dafb5133bcffb8d59f4e12465dc0e9faeaa05e3e342a08fe135800e3e4407` |
| DeepBook V3 Package | `0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809` |
| Balance Manager | `0xe468a2b4e9722d8ab77d1b2f84a0a19d1feb65362bb836a8bcd567ab8ee411b3` |

### Testnet

- Vault Package: `0x4f4419eaa848151f9adffa2386aa5ea40a6bfefe3ec930a5c2629dc826bdb53b`

### Verified Mainnet Trade

- Transaction: `F3K84LKyjN7Z1HM14XASLEXXBoyDJkWbQ8wirzD9ec8Q`
- Walrus Blob: `UIao2Ld4RdtHgmtJAFBHdkkCMN0VyvEiqfTH74JPfmE`
- Action: SELL 0.01 SUI @ $0.7087 (72% confidence, SIDEWAYS market)

---

## 2. Smart Contract Specifications

### 2.1 vault.move

**Module:** `suisage::vault` (406 LOC, 10 unit tests)

A shared vault holding SUI deposits from multiple users with proportional share-based accounting and performance fee tracking.

#### Objects

**Vault** (shared object)
```
- id: UID
- creator: address                    # Vault creator, used for AdminCap access
- balance: Balance<SUI>              # Total SUI held in vault
- total_shares: u64                  # Total shares outstanding
- deployed_amount: u64               # SUI currently deployed to trading
- paused: bool                       # Emergency pause state
- performance_fee_bps: u64           # Fee on profits (default 1000 = 10%)
- high_water_mark: u64               # Highest NAV per share (scaled 1e9)
- accrued_fees: Balance<SUI>         # Fees available for admin withdrawal
- total_profit: u64                  # Lifetime profit
- total_loss: u64                    # Lifetime loss
- profit_events: u64                 # Number of profit-taking events
```

**DepositReceipt** (owned NFT)
```
- id: UID
- vault_id: ID
- shares: u64                       # Number of shares this receipt represents
- deposited_amount: u64             # Original deposit amount
```

#### Public Functions

| Function | Description |
|----------|-------------|
| `create_vault(ctx)` | Create a new shared vault with default 10% performance fee |
| `create_vault_with_fee(fee_bps, ctx)` | Create vault with custom fee (max 50%) |
| `deposit(vault, coin, ctx)` | Deposit SUI, receive DepositReceipt with proportional shares |
| `withdraw(vault, receipt, shares_to_burn, ctx)` | Withdraw SUI by burning shares (partial supported) |
| `emergency_withdraw(vault, receipt, ctx)` | Withdraw ignoring pause state (user protection) |

#### Package-Internal Functions (called by agent_auth)

| Function | Description |
|----------|-------------|
| `withdraw_for_deployment(vault, amount)` | Extract SUI for trading, tracks deployed_amount |
| `return_from_deployment(vault, funds)` | Return SUI after trading, handles profit/loss/fees |
| `set_paused(vault, paused)` | Toggle pause state |
| `set_performance_fee(vault, fee_bps)` | Update performance fee |
| `withdraw_fees(vault, ctx)` | Withdraw accrued fees as Coin<SUI> |

#### View Functions

| Function | Returns |
|----------|---------|
| `vault_balance(vault)` | u64 — available SUI balance |
| `vault_total_shares(vault)` | u64 — total shares outstanding |
| `vault_deployed_amount(vault)` | u64 — SUI deployed to trading |
| `vault_paused(vault)` | bool |
| `vault_creator(vault)` | address |
| `vault_total_value(vault)` | u64 — balance + deployed |
| `vault_nav_per_share(vault)` | u64 — NAV per share (scaled 1e9) |
| `vault_performance_fee_bps(vault)` | u64 |
| `vault_high_water_mark(vault)` | u64 |
| `vault_accrued_fees(vault)` | u64 |
| `vault_total_profit(vault)` | u64 |
| `vault_total_loss(vault)` | u64 |
| `receipt_shares(receipt)` | u64 |
| `receipt_vault_id(receipt)` | ID |

#### Events

| Event | Fields |
|-------|--------|
| `DepositEvent` | vault_id, depositor, amount, shares_minted, total_shares |
| `WithdrawEvent` | vault_id, withdrawer, amount, shares_burned, total_shares |
| `PerformanceEvent` | vault_id, profit, fee_taken, new_high_water_mark, nav_per_share |
| `FeeWithdrawnEvent` | vault_id, amount, recipient |

#### Error Codes

| Code | Constant | Trigger |
|------|----------|---------|
| 0 | `EZeroDeposit` | Depositing 0 SUI |
| 1 | `EInsufficientShares` | Burning more shares than owned |
| 2 | `EVaultPaused` | Deposit/withdraw while paused (except emergency) |
| 3 | `EZeroWithdraw` | Withdrawing 0 shares |
| 4 | `EInsufficientLiquidity` | Withdrawing more than available (deployed funds locked) |
| 5 | `EInvalidFeeBps` | Fee > 5000 (50%) |

#### Share Calculation

- First deposit: 1 SUI = 1 share (1:1)
- Subsequent: `shares = (deposit_amount * total_shares) / total_value`
- Withdraw: `amount = (shares_to_burn * total_value) / total_shares`

#### Performance Fee Logic

When funds return from trading with profit:
1. `profit = returned_amount - deployed_amount`
2. `fee = profit * performance_fee_bps / 10000`
3. Fee is split from returned funds into `accrued_fees`
4. NAV per share is recalculated
5. If NAV > high_water_mark, high_water_mark is updated
6. PerformanceEvent emitted

Fees are only charged on profits above the high-water mark, preventing fee gaming via deposit/withdraw cycles.

---

### 2.2 agent_auth.move

**Module:** `suisage::agent_auth` (354 LOC, 9 unit tests)

Capability-based access control for the vault. AdminCap is held by the vault creator, AgentCap is held by the trading agent. All trading operations go through this module with Move-enforced safety checks.

#### Objects

**AdminCap** (owned by vault creator)
```
- id: UID
- vault_id: ID
```

**AgentCap** (owned by agent address)
```
- id: UID
- vault_id: ID
- max_trade_size: u64               # Maximum MIST per trade
- max_deployment_bps: u64           # Max % of vault to deploy (basis points)
- active: bool                      # Whether agent is authorized
- last_trade_timestamp_ms: u64      # For cooldown enforcement (Clock)
- total_trades: u64                 # Lifetime trade count
- total_volume: u64                 # Lifetime volume (MIST)
```

#### Admin Functions

| Function | Description |
|----------|-------------|
| `create_admin_cap(vault, ctx)` | Create AdminCap (vault creator only) |
| `create_admin_cap_returning(vault, ctx)` | Create AdminCap and return it (for PTB composition) |
| `authorize_agent(admin_cap, vault, agent_address, max_trade_size, max_deployment_bps, ctx)` | Create AgentCap and transfer to agent |
| `revoke_agent(admin_cap, agent_cap)` | Destroy AgentCap — instantly cuts agent access |
| `pause_vault(admin_cap, vault)` | Pause vault (blocks trading and deposits) |
| `unpause_vault(admin_cap, vault)` | Unpause vault |
| `set_performance_fee(admin_cap, vault, fee_bps)` | Update performance fee |
| `withdraw_fees(admin_cap, vault, ctx)` | Withdraw accrued fees to admin wallet |

#### Agent Functions

| Function | Description |
|----------|-------------|
| `withdraw_for_trading(agent_cap, vault, strategy, amount, clock, ctx)` | Withdraw SUI for trading — **7 on-chain checks enforced** |
| `return_from_trading(agent_cap, vault, funds)` | Return SUI to vault after trading |
| `record_trade(agent_cap, vault, trade_type, amount, price, walrus_blob_id, reasoning_hash, guardian_approved, confidence, clock, ctx)` | Record trade with Walrus blob ID and SHA-256 hash on-chain |
| `validate_trade_size(agent_cap, amount)` | View function — check if trade size is valid |

#### 7 On-Chain Checks in withdraw_for_trading

```
1. assert!(agent_cap.active, EAgentNotActive)
2. assert!(agent_cap.vault_id == object::id(vault), ENotAuthorized)
3. assert!(!vault::vault_paused(vault), EVaultPaused)
4. assert!(strategy::is_active(strategy), EStrategyNotActive)
5. assert!(amount <= agent_cap.max_trade_size, EExceedsMaxTradeSize)
6. assert!(vault::vault_deployed_amount(vault) + amount <= max_deploy, EExceedsDeploymentLimit)
7. assert!(amount <= max_position, EPositionTooConcentrated)
8. assert!(elapsed >= min_interval_ms, ECooldownNotMet)  // Clock-based
```

Note: Check 2 (vault ID match) and check 8 (cooldown) bring it to 8 assertions, but the external-facing description groups related checks for clarity.

#### Events

| Event | Fields |
|-------|--------|
| `TradeRecordEvent` | vault_id, agent, trade_type (0=BUY/1=SELL/2=REBALANCE), amount, price, walrus_blob_id, reasoning_hash, timestamp_ms, guardian_approved, confidence |
| `AgentAuthorizedEvent` | vault_id, agent_cap_id, agent, max_trade_size, max_deployment_bps |
| `AgentRevokedEvent` | vault_id, agent_cap_id |
| `CooldownViolationEvent` | vault_id, agent, time_since_last_ms, required_interval_ms |

#### Error Codes

| Code | Constant | Trigger |
|------|----------|---------|
| 100 | `ENotAuthorized` | Agent/admin cap doesn't match vault |
| 101 | `EExceedsMaxTradeSize` | Trade amount > AgentCap.max_trade_size |
| 102 | `ENotVaultCreator` | Non-creator trying to create AdminCap |
| 103 | `EExceedsDeploymentLimit` | Total deployed would exceed max_deployment_bps |
| 104 | `ECooldownNotMet` | Trading too soon after last trade (Clock-enforced) |
| 105 | `EPositionTooConcentrated` | Trade exceeds max_position_bps of vault |
| 107 | `EAgentNotActive` | AgentCap.active is false |
| 108 | `EStrategyNotActive` | StrategyConfig.active is false |
| 109 | `EVaultPaused` | Vault is paused |

---

### 2.3 strategy.move

**Module:** `suisage::strategy` (173 LOC)

On-chain risk parameters that the agent must obey. These are checked in `withdraw_for_trading()`. The vault owner can update them via the dashboard.

#### Objects

**StrategyConfig** (shared object)
```
- id: UID
- vault_id: ID
- creator: address                   # Authorized to modify
- allowed_pools: vector<address>     # Pool whitelist (empty = all allowed)
- max_position_bps: u64             # Max single trade as % of vault (e.g., 3000 = 30%)
- stop_loss_bps: u64                # Stop-loss threshold (e.g., 500 = 5%)
- min_trade_interval_sec: u64       # Cooldown between trades (seconds)
- max_open_positions: u64           # Max simultaneous open positions
- active: bool                       # Whether strategy is active
```

#### Functions

| Function | Description |
|----------|-------------|
| `create_strategy(vault_id, max_position_bps, stop_loss_bps, min_trade_interval_sec, max_open_positions, ctx)` | Create strategy config (caller becomes authorized admin) |
| `update_params(config, max_position_bps, stop_loss_bps, min_trade_interval_sec, max_open_positions, ctx)` | Update risk parameters (creator only) |
| `add_allowed_pool(config, pool, ctx)` | Add pool to whitelist (creator only) |
| `set_active(config, active, ctx)` | Toggle strategy active state (creator only) |
| `is_pool_allowed(config, pool)` | Check if pool is in whitelist (empty = all allowed) |

#### Events

| Event | Fields |
|-------|--------|
| `StrategyCreatedEvent` | vault_id, strategy_config_id |
| `StrategyUpdatedEvent` | vault_id, max_position_bps, stop_loss_bps, min_trade_interval_sec, max_open_positions |

#### Error Codes

| Code | Constant | Trigger |
|------|----------|---------|
| 200 | `ENotAuthorized` | Non-creator trying to modify config |
| 201 | `EInvalidBps` | BPS value > 10000 |

---

### 2.4 seal_policy/whitelist.move

**Module:** `seal_policy::whitelist` (75 LOC)

Controls who can decrypt encrypted reasoning blobs stored on Walrus via Seal threshold encryption.

#### Objects

**Whitelist** (shared object)
```
- id: UID
- addresses: Table<address, bool>   # Set of authorized addresses
```

**Cap** (owned by whitelist admin)
```
- id: UID
- wl_id: ID                         # ID of the associated Whitelist
```

#### Functions

| Function | Description |
|----------|-------------|
| `create(ctx)` | Create whitelist + admin Cap (entry function) |
| `add(wl, cap, account)` | Add address to whitelist (admin only) |
| `remove(wl, cap, account)` | Remove address from whitelist (admin only) |
| `seal_approve(id, wl, ctx)` | Entry function called by Seal key servers — verifies caller is whitelisted and ID prefix matches |

#### Error Codes

| Code | Constant | Trigger |
|------|----------|---------|
| 1 | `ENoAccess` | Caller not on whitelist or ID prefix mismatch |
| 2 | `EInvalidCap` | Cap doesn't match whitelist |
| 3 | `EDuplicate` | Address already in whitelist |
| 4 | `ENotInWhitelist` | Removing address that isn't whitelisted |

#### How seal_approve Works

1. Seal key servers call `seal_approve(id, wl, ctx)` when a user requests decryption
2. The function extracts the whitelist object ID as a byte prefix
3. It checks that the requested `id` starts with this prefix (ensures the policy applies to this data)
4. It checks that `ctx.sender()` is in the whitelist table
5. If both pass, the Seal key server releases the decryption key share

---

## 3. Dual-Layer Guardian System

### Layer 1: TypeScript Pre-flight (8 checks)

These run in the agent before submitting any transaction:

| Check | Threshold | Blocks If |
|-------|-----------|-----------|
| Budget Ceiling | `AgentCap.max_trade_size` | Trade exceeds agent's max |
| Spread | <= 50 bps | Market too illiquid |
| Position Concentration | <= 30% of vault | Single trade too large relative to vault |
| Liquidity Depth | >= 100 units | Orderbook too thin |
| Confidence Floor | >= 30% | AI not confident enough |
| Trade Cooldown | >= configured interval | Trading too frequently |
| Slippage Estimate | < 100 bps | Estimated price impact too high |
| Vault Health | Active, non-zero balance | Vault paused or empty |

### Layer 2: Move On-chain Enforcement (7 checks)

These are `assert!` statements in `withdraw_for_trading()`:

| Check | Error Code | Can Be Bypassed? |
|-------|-----------|-----------------|
| Agent active | 107 | No — Move enforced |
| Vault not paused | 109 | No — Move enforced |
| Strategy active | 108 | No — Move enforced |
| Trade size <= max | 101 | No — Move enforced |
| Deployment limit | 103 | No — Move enforced |
| Position concentration | 105 | No — Move enforced |
| Cooldown (Clock) | 104 | No — Move enforced |

The key insight: even if someone forks the agent code, removes all TypeScript checks, and submits a raw transaction, the Move contract will abort. The budget ceiling is enforced by the blockchain.

---

## 4. Walrus Integration

### Reasoning Storage Flow

1. Agent generates a reasoning JSON package:
   ```json
   {
     "timestamp": 1782048223965,
     "decision": {
       "action": "SELL",
       "reasoning": "...",
       "confidence": 72,
       "quantity": 0.01,
       "price": 0.708715,
       "marketCondition": "SIDEWAYS",
       "riskAssessment": "..."
     },
     "marketSnapshot": {
       "midPrice": 0.708715,
       "bestBid": 0.708360,
       "bestAsk": 0.709070,
       "spreadBps": 10.0,
       "bidDepth": 10000,
       "askDepth": 10000
     },
     "guardianCheck": {
       "approved": true,
       "checks": [
         {"name": "Spread", "passed": true, "value": "10.0 bps"},
         {"name": "Depth", "passed": true, "value": "10000 units"},
         ...
       ]
     },
     "vaultState": {
       "balance": "100000000",
       "deployedAmount": "0",
       "totalShares": "100000000"
     }
   }
   ```

2. JSON is stored on Walrus via HTTP PUT to publisher:
   - Endpoint: `{WALRUS_PUBLISHER_URL}/v1/blobs`
   - Returns blob ID (e.g., `UIao2Ld4RdtHgmtJAFBHdkkCMN0VyvEiqfTH74JPfmE`)

3. SHA-256 hash is computed:
   ```typescript
   const hash = createHash('sha256').update(jsonString).digest();
   ```

4. Both `blob_id` and `reasoning_hash` are included in the `record_trade` call on-chain

5. Anyone can verify:
   - Fetch blob: `GET {WALRUS_AGGREGATOR_URL}/v1/blobs/{blob_id}`
   - Compute SHA-256 of response body
   - Compare against `reasoning_hash` from `TradeRecordEvent`

### Walrus Configuration

| Setting | Value |
|---------|-------|
| Publisher URL | `https://publisher.walrus-testnet.walrus.space` |
| Aggregator URL | `https://aggregator.walrus-testnet.walrus.space` |
| Storage | Testnet (mainnet publisher not yet publicly available) |

### Fallback Behavior

If Walrus publisher is unavailable, the agent:
1. Stores reasoning locally in `.walrus-fallback/` directory
2. Uses blob ID prefix `local-{timestamp}` to indicate local storage
3. Retries Walrus on next cycle

---

## 5. MemWal Integration

### Configuration

| Setting | Value |
|---------|-------|
| Server URL | `https://relayer.memory.walrus.xyz` |
| Account ID | `0x0890ac0ba278ab74440f988b5dea823adb6f2961151d717508448cbc2d73ce17` |
| Delegate Key | Used for authentication (stored in .env) |

### Memory Structure

The agent stores and retrieves:
- Past trading decisions with outcomes
- Performance metrics (win rate, PnL, average confidence)
- Market condition patterns
- Strategy effectiveness tracking

### Memory in the Decision Loop

Before each trading cycle:
1. Agent calls MemWal to retrieve recent memory context
2. Memory is formatted into a prompt section:
   ```
   PAST PERFORMANCE (from Walrus memory):
   - Total trades: 15
   - Win rate: 40%
   - Average confidence: 62%
   - Total PnL: -0.002 SUI
   - Last 5 decisions: HOLD, HOLD, SELL, HOLD, HOLD
   ```
3. This context is included in the LLM prompt
4. After the decision, the outcome is written back to MemWal

---

## 6. Seal Integration

### Configuration

| Setting | Value |
|---------|-------|
| Seal Package ID | `0x931739224160073d8e391c9aa6e7ade9818e9814b4907066b7efa058636c4e45` |
| Seal Policy ID | `0xa64c1979c6988eaf8aff777110fc19d3f5b6ae685aa4c8809bcdfca51f8c57dd` |
| Key Server Object | `0x686098f1439237fff9f36b99c7329683c22979d2005c2465cb891acb012a7595` |
| Whitelist Package | `0xbab048ffc7c206b6c25b5b15d2feae9b09ad9366a03ae1a3a6d9dac5643e2ac6` |

### Encryption Flow

1. Agent generates reasoning JSON
2. Reasoning is encrypted using Seal before storing on Walrus
3. The SHA-256 hash is computed on the plaintext JSON (pre-encryption)
4. Encrypted blob is stored on Walrus
5. Hash is committed on-chain in TradeRecordEvent
6. Authorized users (on whitelist) can decrypt via Seal key servers
7. After decryption, they can verify the hash matches the on-chain commitment

### Access Control

The vault owner manages the whitelist:
- `add(wl, cap, address)` — grant decryption access
- `remove(wl, cap, address)` — revoke decryption access
- Changes take effect immediately — no need to re-encrypt existing data

---

## 7. DeepBook V3 Integration

### Pool Configuration

| Setting | Value |
|---------|-------|
| DeepBook V3 Package | `0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809` |
| Pool (SUI/USDC) | `0xe05dafb5133bcffb8d59f4e12465dc0e9faeaa05e3e342a08fe135800e3e4407` |
| Balance Manager | `0xe468a2b4e9722d8ab77d1b2f84a0a19d1feb65362bb836a8bcd567ab8ee411b3` |
| SUI Coin Type | `0x2::sui::SUI` |
| USDC Coin Type | `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC` |
| DEEP Coin Type | `0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP` |

### Market Reading

The agent reads market data via `devInspectTransactionBlock`:
- `pool::mid_price` — returns u64 scaled by 1e6 (USDC has 6 decimals)
- `pool::best_bid_price` / `pool::best_ask_price`
- `pool::get_level2_ticks_from_mid` — bid/ask depth

### Trade Execution

Trades are executed via `swap_exact_base_for_quote`:

```typescript
// Create zero DEEP coin (required by V3 but no DEEP fee needed)
const deepCoinIn = tx.moveCall({
  target: '0x2::coin::zero',
  typeArguments: [DEEP_COIN_TYPE]
});

// Execute swap
const [baseCoinOut, quoteCoinOut, deepCoinOut] = tx.moveCall({
  target: `${deepbookPackageId}::pool::swap_exact_base_for_quote`,
  arguments: [
    tx.object(poolId),     // Pool<SUI, USDC>
    tradeCoin,             // Coin<SUI> to sell
    deepCoinIn,            // Coin<DEEP> (zero)
    tx.pure.u64(0),        // min_quote_out
    tx.object('0x6'),      // Clock
  ],
  typeArguments: [SUI_COIN_TYPE, USDC_COIN_TYPE],
});
```

### Full Trade PTB

A complete trade is an atomic Programmable Transaction Block:

```
1. withdraw_for_trading(agent_cap, vault, strategy, amount, clock)
   → Returns Coin<SUI> (7 Move checks enforced)

2. coin::zero<DEEP>()
   → Creates zero DEEP coin for swap fee parameter

3. pool::swap_exact_base_for_quote(pool, sui_coin, deep_coin, min_out, clock)
   → Executes trade on DeepBook V3, returns base/quote/deep coins

4. Merge and handle returned coins
   → Transfer USDC to agent, destroy zero coins

5. return_from_trading(agent_cap, vault, remaining_sui)
   → Returns unused SUI to vault, triggers profit/loss accounting

6. record_trade(agent_cap, vault, trade_type, amount, price, blob_id, hash, approved, confidence, clock)
   → Commits Walrus blob ID + reasoning hash on-chain as TradeRecordEvent
```

All 6 steps execute atomically — if any fails, the entire transaction reverts.

---

## 8. Agent Runtime

### Configuration (Environment Variables)

| Variable | Description |
|----------|-------------|
| `SUI_NETWORK` | Network (mainnet/testnet) |
| `SUI_RPC_URL` | Sui RPC endpoint |
| `AGENT_PRIVATE_KEY` | Agent wallet private key (suiprivkey format) |
| `VAULT_PACKAGE_ID` | Deployed vault package ID |
| `VAULT_OBJECT_ID` | Vault shared object ID |
| `AGENT_CAP_ID` | Agent's AgentCap object ID |
| `STRATEGY_CONFIG_ID` | StrategyConfig shared object ID |
| `DEEPBOOK_PACKAGE_ID` | DeepBook V3 package ID |
| `DEEPBOOK_POOL_ID` | SUI/USDC pool ID |
| `BALANCE_MANAGER_ID` | DeepBook balance manager |
| `WALRUS_AGGREGATOR_URL` | Walrus read endpoint |
| `WALRUS_PUBLISHER_URL` | Walrus write endpoint |
| `MEMWAL_DELEGATE_KEY` | MemWal authentication key |
| `MEMWAL_ACCOUNT_ID` | MemWal account |
| `MEMWAL_SERVER_URL` | MemWal relay server |
| `SEAL_PACKAGE_ID` | Seal package ID |
| `SEAL_POLICY_ID` | Seal whitelist policy ID |
| `SEAL_KEY_SERVER_OBJECT_ID` | Seal key server |
| `GROQ_API_KEY` | Groq LLM API key |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `AGENT_LOOP_INTERVAL_MS` | Base polling interval (default 120000) |
| `MAX_TRADE_SIZE_SUI` | Max trade size in SUI (default 10) |

### Adaptive Polling

The agent adjusts its polling interval based on market activity:

| Consecutive HOLDs | Interval |
|-------------------|----------|
| 0-2 | 2 minutes (base) |
| 3-5 | 4 minutes |
| 6-10 | 8 minutes |
| 11+ | 15 minutes |

Any trade resets the counter to 0 (back to 2-minute polling).

This keeps Groq API usage under the free tier limit (~100k tokens/day) for 24/7 operation.

### Multi-Vault Support

The agent auto-discovers vaults by querying `AgentAuthorizedEvent` for its address. It processes each vault sequentially in the main loop. Empty vaults (0 balance + 0 deployed) are skipped to save LLM tokens.

### LLM Configuration

| Setting | Value |
|---------|-------|
| Model | `llama-3.1-8b-instant` |
| Max Tokens | 512 |
| Temperature | 0.3 |
| Provider | Groq |

---

## 9. Dashboard

### Pages

| Route | Description |
|-------|-------------|
| `/` | Landing page with live vault stats and how-it-works section |
| `/portfolio` | Deposit/withdraw SUI, view shares, NAV per share, vault performance |
| `/reasoning` | Reasoning timeline with expandable entries, SHA-256 hash verification, Walrus blob links, Suiscan TX links. Filters: ALL/BUY/SELL/HOLD. Auto-refreshes every 15 seconds. |
| `/admin` | Vault creation, strategy parameter management, pause/unpause, fee management, AI Smart Setup chat |

### AI Smart Setup (Admin Page)

The admin page includes an AI chat interface that translates plain English into vault configuration:

- Three preset buttons: Conservative, Moderate, Aggressive
- Free-text input for custom descriptions (e.g., "I have 100 SUI and want safe trading")
- AI responds with explanation + suggested parameter values
- "Apply to Form" button fills the vault creation form
- Powered by Groq (server-side API route at `/api/chat-config`)

### Dashboard Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_VAULT_PACKAGE_ID` | Vault package ID |
| `NEXT_PUBLIC_SUI_NETWORK` | Network (mainnet/testnet) |
| `NEXT_PUBLIC_AGENT_ADDRESS` | Agent public address |
| `NEXT_PUBLIC_WALRUS_AGGREGATOR_URL` | Walrus read endpoint |
| `GROQ_API_KEY` | Groq key for Smart Setup (server-side only) |

### Hash Verification (Reasoning Page)

When a user expands an on-chain trade entry:
1. Dashboard fetches the Walrus blob using the blob ID from TradeRecordEvent
2. Computes SHA-256 of the blob content using Web Crypto API
3. Compares against the reasoning_hash from the on-chain event
4. Shows "Verified — blob matches on-chain hash" or "Mismatch"

---

## 10. Telegram Bot

### Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message with available commands |
| `/link 0xAddr` | Link Sui wallet address (read-only, queries DepositReceipt objects) |
| `/portfolio` | Shows shares, current value, P&L, vault share percentage |
| `/market` | Live SUI/USDC price, spread, depth from DeepBook V3 |
| `/vault` | Vault balance, deployed amount, total value, status |
| `/trades` | Recent decisions with confidence bars and reasoning |
| `/subscribe` | Enable push notifications for new trades |
| `/unsubscribe` | Disable push notifications |
| `/status` | Agent uptime, current cycle interval, subscriber count |
| `/unlink` | Remove linked wallet |

### Natural Language

Users can ask questions in plain English. The bot uses Groq to answer with live vault and market data injected into the context.

### Trade Notifications

When the agent makes a trade, subscribed users receive:
- Action (BUY/SELL/HOLD) with confidence bar
- Full reasoning text
- Market condition and risk assessment
- Market snapshot (mid price, spread, bid/ask depth)
- Walrus blob ID link

---

## 11. MCP Server

### Setup

```bash
npx pnpm --filter mcp-server build
```

Add to Claude Desktop config:
```json
{
  "mcpServers": {
    "suisage": {
      "command": "node",
      "args": ["/absolute/path/to/suisage/mcp-server/dist/index.js"]
    }
  }
}
```

### Available Tools

| Tool | Description |
|------|------------|
| `get_vault_state` | Vault balance, shares, NAV, deployed amount, fees |
| `get_market_state` | DeepBook orderbook (bid/ask/spread/depth) |
| `get_reasoning` | Fetch full reasoning from Walrus by blob ID |
| `get_recent_trades` | Last N trades with decision data |
| `get_deposit_events` | Vault deposit/withdraw history |
| `get_agent_architecture` | System overview |
| `get_guardian_config` | Risk check thresholds (TypeScript + Move) |

All tools are read-only. The MCP server runs locally via stdio.

---

## 12. Data Flow Diagrams

### Trade Execution Flow

```
User deposits SUI
       |
       v
  Vault (shared object on Sui)
       |
       v
  Agent loop (every 2-15 min)
       |
  +----v----+
  | Read    |  DeepBook V3 orderbook
  | Market  |  (mid price, spread, depth)
  +---------+
       |
  +----v----+
  | Read    |  On-chain vault state
  | Vault   |  (balance, deployed, NAV)
  +---------+
       |
  +----v----+
  | Load    |  MemWal persistent memory
  | Memory  |  (past decisions, performance)
  +---------+
       |
  +----v----+
  | LLM     |  Groq llama-3.1-8b-instant
  | Decide  |  Returns TradeDecision JSON
  +---------+
       |
  +----v----+
  | Guardian|  8 TypeScript pre-flight checks
  | Check   |  (spread, depth, confidence, etc.)
  +---------+
       |
  +----v----+
  | Store   |  Walrus publisher
  | Reason  |  (returns blob ID)
  | + Hash  |  SHA-256 of reasoning JSON
  +---------+
       |
  +----v----+
  | Execute |  Atomic PTB on Sui:
  | Trade   |  withdraw -> swap -> return -> record
  |         |  (7 Move checks enforced)
  +---------+
       |
  +----v----+
  | Update  |  MemWal write
  | Memory  |  (store outcome)
  +---------+
       |
  +----v----+
  | Notify  |  Telegram bot
  |         |  (to all subscribers)
  +---------+
```

### Verification Flow

```
On-chain TradeRecordEvent
  contains: walrus_blob_id, reasoning_hash
       |
       v
  Fetch blob from Walrus aggregator
  GET /v1/blobs/{blob_id}
       |
       v
  Compute SHA-256 of blob content
       |
       v
  Compare with on-chain reasoning_hash
       |
  +----v----+
  | Match?  |--Yes--> "Verified — blob matches on-chain hash"
  |         |--No---> "Mismatch — blob does not match"
  +---------+
```

### Encryption Flow (Seal)

```
Agent generates reasoning JSON
       |
       v
  Compute SHA-256 hash (on plaintext)
       |
       v
  Encrypt via Seal (threshold encryption)
       |
       v
  Store encrypted blob on Walrus
       |
       v
  Commit blob_id + hash on-chain (TradeRecordEvent)

--- Later, authorized user wants to read ---

User requests decryption
       |
       v
  Seal key servers call seal_approve(id, whitelist)
       |
  +----v----+
  | On      |--No---> Decryption denied
  | Whitelist?|
  |         |--Yes--> Key share released
  +---------+
       |
       v
  User decrypts blob
       |
       v
  Verify SHA-256 matches on-chain hash
```
