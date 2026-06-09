module suisage::agent_auth {
    use sui::event;
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::clock::Clock;
    use suisage::vault::{Self, Vault};
    use suisage::strategy::{Self, StrategyConfig};

    // ===== Errors =====
    const ENotAuthorized: u64 = 100;
    const EExceedsMaxTradeSize: u64 = 101;
    const ENotVaultCreator: u64 = 102;
    const EExceedsDeploymentLimit: u64 = 103;
    const ECooldownNotMet: u64 = 104;
    const EPositionTooConcentrated: u64 = 105;
    #[allow(unused_const)]
    const EPoolNotAllowed: u64 = 106;
    const EAgentNotActive: u64 = 107;
    const EStrategyNotActive: u64 = 108;
    const EVaultPaused: u64 = 109;

    // ===== Objects =====

    /// Admin capability - held by vault creator
    public struct AdminCap has key, store {
        id: UID,
        vault_id: ID,
    }

    /// Agent capability - granted to the trading agent with Move-enforced limits
    public struct AgentCap has key, store {
        id: UID,
        vault_id: ID,
        /// Maximum single trade size in MIST
        max_trade_size: u64,
        /// Maximum basis points of vault to deploy (e.g., 5000 = 50%)
        max_deployment_bps: u64,
        /// Whether this agent cap is active
        active: bool,
        /// Timestamp of last trade (ms) — enforces cooldown on-chain
        last_trade_timestamp_ms: u64,
        /// Total trades executed by this agent
        total_trades: u64,
        /// Total volume traded (MIST)
        total_volume: u64,
    }

    // ===== Events =====

    public struct TradeRecordEvent has copy, drop {
        vault_id: ID,
        agent: address,
        trade_type: u8, // 0=BUY, 1=SELL, 2=REBALANCE
        amount: u64,
        price: u64,
        walrus_blob_id: vector<u8>,
        /// SHA-256 hash of the reasoning JSON — enables verification against Walrus blob
        reasoning_hash: vector<u8>,
        timestamp_ms: u64,
        /// Guardian check results summary
        guardian_approved: bool,
        confidence: u8,
    }

    public struct AgentAuthorizedEvent has copy, drop {
        vault_id: ID,
        agent_cap_id: ID,
        agent: address,
        max_trade_size: u64,
        max_deployment_bps: u64,
    }

    public struct AgentRevokedEvent has copy, drop {
        vault_id: ID,
        agent_cap_id: ID,
    }

    public struct CooldownViolationEvent has copy, drop {
        vault_id: ID,
        agent: address,
        time_since_last_ms: u64,
        required_interval_ms: u64,
    }

    // ===== Public functions =====

    /// Create admin cap (only vault creator can call)
    public fun create_admin_cap(
        vault: &Vault,
        ctx: &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == vault::vault_creator(vault), ENotVaultCreator);
        let admin_cap = AdminCap {
            id: object::new(ctx),
            vault_id: object::id(vault),
        };
        transfer::transfer(admin_cap, tx_context::sender(ctx));
    }

    /// Create admin cap and return it (for PTB composition)
    public fun create_admin_cap_returning(
        vault: &Vault,
        ctx: &mut TxContext,
    ): AdminCap {
        assert!(tx_context::sender(ctx) == vault::vault_creator(vault), ENotVaultCreator);
        AdminCap {
            id: object::new(ctx),
            vault_id: object::id(vault),
        }
    }

    /// Authorize a new agent with specified limits
    public fun authorize_agent(
        _admin_cap: &AdminCap,
        vault: &Vault,
        agent_address: address,
        max_trade_size: u64,
        max_deployment_bps: u64,
        ctx: &mut TxContext,
    ) {
        assert!(_admin_cap.vault_id == object::id(vault), ENotAuthorized);

        let agent_cap = AgentCap {
            id: object::new(ctx),
            vault_id: object::id(vault),
            max_trade_size,
            max_deployment_bps,
            active: true,
            last_trade_timestamp_ms: 0,
            total_trades: 0,
            total_volume: 0,
        };

        let agent_cap_id = object::id(&agent_cap);
        transfer::transfer(agent_cap, agent_address);

        event::emit(AgentAuthorizedEvent {
            vault_id: object::id(vault),
            agent_cap_id,
            agent: agent_address,
            max_trade_size,
            max_deployment_bps,
        });
    }

    /// Record a trade with full verification data (Walrus blob ID + reasoning hash)
    /// This is the core function that creates an immutable on-chain audit trail.
    public fun record_trade(
        agent_cap: &mut AgentCap,
        _vault: &Vault,
        trade_type: u8,
        amount: u64,
        price: u64,
        walrus_blob_id: vector<u8>,
        reasoning_hash: vector<u8>,
        guardian_approved: bool,
        confidence: u8,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(agent_cap.active, EAgentNotActive);
        assert!(agent_cap.vault_id == object::id(_vault), ENotAuthorized);
        assert!(amount <= agent_cap.max_trade_size, EExceedsMaxTradeSize);

        let timestamp_ms = sui::clock::timestamp_ms(clock);

        // Update agent stats
        agent_cap.total_trades = agent_cap.total_trades + 1;
        agent_cap.total_volume = agent_cap.total_volume + amount;
        agent_cap.last_trade_timestamp_ms = timestamp_ms;

        event::emit(TradeRecordEvent {
            vault_id: agent_cap.vault_id,
            agent: tx_context::sender(ctx),
            trade_type,
            amount,
            price,
            walrus_blob_id,
            reasoning_hash,
            timestamp_ms,
            guardian_approved,
            confidence,
        });
    }

    /// Agent pulls funds from vault for trading — with Move-enforced Guardian checks
    /// This function enforces:
    /// 1. Agent must be active
    /// 2. Trade size within max_trade_size
    /// 3. Deployment within max_deployment_bps
    /// 4. Cooldown between trades (from StrategyConfig)
    /// 5. Position concentration limit (from StrategyConfig)
    /// 6. Vault not paused
    /// 7. Strategy is active
    public fun withdraw_for_trading(
        agent_cap: &mut AgentCap,
        vault: &mut Vault,
        strategy: &StrategyConfig,
        amount: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ): Coin<SUI> {
        // Check 1: Agent active
        assert!(agent_cap.active, EAgentNotActive);
        assert!(agent_cap.vault_id == object::id(vault), ENotAuthorized);

        // Check 2: Vault not paused
        assert!(!vault::vault_paused(vault), EVaultPaused);

        // Check 3: Strategy active
        assert!(strategy::is_active(strategy), EStrategyNotActive);

        // Check 4: Trade size within limit
        assert!(amount <= agent_cap.max_trade_size, EExceedsMaxTradeSize);

        // Check 5: Deployment within limit
        let total_value = vault::vault_balance(vault) + vault::vault_deployed_amount(vault);
        let max_deploy = ((total_value as u128) * (agent_cap.max_deployment_bps as u128) / 10000) as u64;
        assert!(vault::vault_deployed_amount(vault) + amount <= max_deploy, EExceedsDeploymentLimit);

        // Check 6: Position concentration — trade must not exceed max_position_bps of vault
        let max_position = ((total_value as u128) * (strategy::max_position_bps(strategy) as u128) / 10000) as u64;
        assert!(amount <= max_position, EPositionTooConcentrated);

        // Check 7: Cooldown enforcement (on-chain, using Clock)
        let now_ms = sui::clock::timestamp_ms(clock);
        let min_interval_ms = strategy::min_trade_interval_sec(strategy) * 1000;
        if (agent_cap.last_trade_timestamp_ms > 0 && min_interval_ms > 0) {
            let elapsed = now_ms - agent_cap.last_trade_timestamp_ms;
            if (elapsed < min_interval_ms) {
                event::emit(CooldownViolationEvent {
                    vault_id: agent_cap.vault_id,
                    agent: tx_context::sender(ctx),
                    time_since_last_ms: elapsed,
                    required_interval_ms: min_interval_ms,
                });
                assert!(false, ECooldownNotMet);
            };
        };

        let balance = vault::withdraw_for_deployment(vault, amount);
        coin::from_balance(balance, ctx)
    }

    /// Agent returns funds to vault after trading
    public fun return_from_trading(
        agent_cap: &AgentCap,
        vault: &mut Vault,
        funds: Coin<SUI>,
    ) {
        assert!(agent_cap.active, EAgentNotActive);
        assert!(agent_cap.vault_id == object::id(vault), ENotAuthorized);
        vault::return_from_deployment(vault, coin::into_balance(funds));
    }

    /// Pause the vault (admin only)
    public fun pause_vault(
        admin_cap: &AdminCap,
        vault: &mut Vault,
    ) {
        assert!(admin_cap.vault_id == object::id(vault), ENotAuthorized);
        vault::set_paused(vault, true);
    }

    /// Unpause the vault (admin only)
    public fun unpause_vault(
        admin_cap: &AdminCap,
        vault: &mut Vault,
    ) {
        assert!(admin_cap.vault_id == object::id(vault), ENotAuthorized);
        vault::set_paused(vault, false);
    }

    /// Set performance fee (admin only)
    public fun set_performance_fee(
        admin_cap: &AdminCap,
        vault: &mut Vault,
        fee_bps: u64,
    ) {
        assert!(admin_cap.vault_id == object::id(vault), ENotAuthorized);
        vault::set_performance_fee(vault, fee_bps);
    }

    /// Withdraw accrued performance fees (admin only)
    public fun withdraw_fees(
        admin_cap: &AdminCap,
        vault: &mut Vault,
        ctx: &mut TxContext,
    ) {
        assert!(admin_cap.vault_id == object::id(vault), ENotAuthorized);
        let fee_coin = vault::withdraw_fees(vault, ctx);
        transfer::public_transfer(fee_coin, tx_context::sender(ctx));
    }

    /// Revoke an agent - destroys the AgentCap (admin must own it or agent returns it)
    public fun revoke_agent(
        admin_cap: &AdminCap,
        agent_cap: AgentCap,
    ) {
        assert!(admin_cap.vault_id == agent_cap.vault_id, ENotAuthorized);

        let agent_cap_id = object::id(&agent_cap);
        let vault_id = agent_cap.vault_id;

        let AgentCap {
            id, vault_id: _, max_trade_size: _, max_deployment_bps: _,
            active: _, last_trade_timestamp_ms: _, total_trades: _, total_volume: _,
        } = agent_cap;
        object::delete(id);

        event::emit(AgentRevokedEvent {
            vault_id,
            agent_cap_id,
        });
    }

    /// Validate that a trade does not exceed agent limits (view function for pre-trade check)
    public fun validate_trade_size(
        agent_cap: &AgentCap,
        amount: u64,
    ): bool {
        agent_cap.active && amount <= agent_cap.max_trade_size
    }

    // ===== View functions =====

    public fun agent_cap_vault_id(cap: &AgentCap): ID {
        cap.vault_id
    }

    public fun agent_cap_max_trade_size(cap: &AgentCap): u64 {
        cap.max_trade_size
    }

    public fun agent_cap_active(cap: &AgentCap): bool {
        cap.active
    }

    public fun agent_cap_last_trade_ms(cap: &AgentCap): u64 {
        cap.last_trade_timestamp_ms
    }

    public fun agent_cap_total_trades(cap: &AgentCap): u64 {
        cap.total_trades
    }

    public fun agent_cap_total_volume(cap: &AgentCap): u64 {
        cap.total_volume
    }

    public fun admin_cap_vault_id(cap: &AdminCap): ID {
        cap.vault_id
    }
}
