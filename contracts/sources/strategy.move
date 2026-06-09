module suisage::strategy {
    use sui::event;

    // ===== Errors =====
    const ENotAuthorized: u64 = 200;
    const EInvalidBps: u64 = 201;

    // ===== Events =====

    public struct StrategyCreatedEvent has copy, drop {
        vault_id: ID,
        strategy_config_id: ID,
    }

    public struct StrategyUpdatedEvent has copy, drop {
        vault_id: ID,
        max_position_bps: u64,
        stop_loss_bps: u64,
        min_trade_interval_sec: u64,
        max_open_positions: u64,
    }

    // ===== Objects =====

    /// On-chain risk parameters the agent must obey — enforced in withdraw_for_trading.
    /// Authorization is via `creator` address (set at creation, matches the deployer).
    public struct StrategyConfig has key {
        id: UID,
        vault_id: ID,
        /// Address authorized to modify this config
        creator: address,
        /// Allowed DeepBook pool IDs (as addresses)
        allowed_pools: vector<address>,
        /// Maximum position size in basis points of vault (e.g., 3000 = 30%)
        max_position_bps: u64,
        /// Stop-loss threshold in basis points (e.g., 500 = 5% loss triggers stop)
        stop_loss_bps: u64,
        /// Minimum seconds between trades (enforced on-chain via Clock)
        min_trade_interval_sec: u64,
        /// Maximum number of open positions
        max_open_positions: u64,
        /// Whether strategy is active (agent blocked if false)
        active: bool,
    }

    // ===== Public functions =====

    /// Create a strategy config for a vault.
    /// The caller (tx sender) becomes the authorized admin for this config.
    public fun create_strategy(
        vault_id: ID,
        max_position_bps: u64,
        stop_loss_bps: u64,
        min_trade_interval_sec: u64,
        max_open_positions: u64,
        ctx: &mut TxContext,
    ) {
        assert!(max_position_bps <= 10000, EInvalidBps);
        assert!(stop_loss_bps <= 10000, EInvalidBps);

        let config = StrategyConfig {
            id: object::new(ctx),
            vault_id,
            creator: tx_context::sender(ctx),
            allowed_pools: vector[],
            max_position_bps,
            stop_loss_bps,
            min_trade_interval_sec,
            max_open_positions,
            active: true,
        };

        event::emit(StrategyCreatedEvent {
            vault_id,
            strategy_config_id: object::id(&config),
        });

        transfer::share_object(config);
    }

    /// Add an allowed pool
    public fun add_allowed_pool(
        config: &mut StrategyConfig,
        pool: address,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == config.creator, ENotAuthorized);
        vector::push_back(&mut config.allowed_pools, pool);
    }

    /// Update risk parameters
    public fun update_params(
        config: &mut StrategyConfig,
        max_position_bps: u64,
        stop_loss_bps: u64,
        min_trade_interval_sec: u64,
        max_open_positions: u64,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == config.creator, ENotAuthorized);
        assert!(max_position_bps <= 10000, EInvalidBps);
        assert!(stop_loss_bps <= 10000, EInvalidBps);

        config.max_position_bps = max_position_bps;
        config.stop_loss_bps = stop_loss_bps;
        config.min_trade_interval_sec = min_trade_interval_sec;
        config.max_open_positions = max_open_positions;

        event::emit(StrategyUpdatedEvent {
            vault_id: config.vault_id,
            max_position_bps,
            stop_loss_bps,
            min_trade_interval_sec,
            max_open_positions,
        });
    }

    /// Toggle strategy active state
    public fun set_active(
        config: &mut StrategyConfig,
        active: bool,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == config.creator, ENotAuthorized);
        config.active = active;
    }

    // ===== View functions =====

    public fun is_active(config: &StrategyConfig): bool {
        config.active
    }

    public fun max_position_bps(config: &StrategyConfig): u64 {
        config.max_position_bps
    }

    public fun stop_loss_bps(config: &StrategyConfig): u64 {
        config.stop_loss_bps
    }

    public fun min_trade_interval_sec(config: &StrategyConfig): u64 {
        config.min_trade_interval_sec
    }

    public fun max_open_positions(config: &StrategyConfig): u64 {
        config.max_open_positions
    }

    public fun allowed_pools(config: &StrategyConfig): &vector<address> {
        &config.allowed_pools
    }

    public fun vault_id(config: &StrategyConfig): ID {
        config.vault_id
    }

    /// Check if a pool is in the allowed list (or if list is empty, all pools allowed)
    public fun is_pool_allowed(config: &StrategyConfig, pool: address): bool {
        let pools = &config.allowed_pools;
        if (vector::length(pools) == 0) {
            return true // Empty whitelist = all pools allowed
        };
        let mut i = 0;
        while (i < vector::length(pools)) {
            if (*vector::borrow(pools, i) == pool) {
                return true
            };
            i = i + 1;
        };
        false
    }
}
