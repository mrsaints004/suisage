module suisage::strategy {
    use sui::event;
    use suisage::agent_auth::AdminCap;

    // ===== Errors =====
    const ENotAuthorized: u64 = 200;
    const EInvalidBps: u64 = 201;

    // ===== Events =====

    public struct StrategyCreatedEvent has copy, drop {
        vault_id: ID,
        strategy_config_id: ID,
    }

    // ===== Objects =====

    /// On-chain risk parameters the agent must obey
    public struct StrategyConfig has key {
        id: UID,
        vault_id: ID,
        /// Allowed DeepBook pool IDs (as addresses)
        allowed_pools: vector<address>,
        /// Maximum position size in basis points of vault (e.g., 3000 = 30%)
        max_position_bps: u64,
        /// Stop-loss threshold in basis points (e.g., 500 = 5% loss triggers stop)
        stop_loss_bps: u64,
        /// Minimum seconds between trades
        min_trade_interval_sec: u64,
        /// Maximum number of open positions
        max_open_positions: u64,
        /// Whether strategy is active
        active: bool,
    }

    // ===== Public functions =====

    /// Create a strategy config for a vault
    public fun create_strategy(
        admin_cap: &AdminCap,
        vault_id: ID,
        max_position_bps: u64,
        stop_loss_bps: u64,
        min_trade_interval_sec: u64,
        max_open_positions: u64,
        ctx: &mut TxContext,
    ) {
        assert!(
            suisage::agent_auth::admin_cap_vault_id(admin_cap) == vault_id,
            ENotAuthorized,
        );
        assert!(max_position_bps <= 10000, EInvalidBps);
        assert!(stop_loss_bps <= 10000, EInvalidBps);

        let config = StrategyConfig {
            id: object::new(ctx),
            vault_id,
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
        _admin_cap: &AdminCap,
        config: &mut StrategyConfig,
        pool: address,
    ) {
        vector::push_back(&mut config.allowed_pools, pool);
    }

    /// Update risk parameters
    public fun update_params(
        _admin_cap: &AdminCap,
        config: &mut StrategyConfig,
        max_position_bps: u64,
        stop_loss_bps: u64,
        min_trade_interval_sec: u64,
        max_open_positions: u64,
    ) {
        assert!(max_position_bps <= 10000, EInvalidBps);
        assert!(stop_loss_bps <= 10000, EInvalidBps);

        config.max_position_bps = max_position_bps;
        config.stop_loss_bps = stop_loss_bps;
        config.min_trade_interval_sec = min_trade_interval_sec;
        config.max_open_positions = max_open_positions;
    }

    /// Toggle strategy active state
    public fun set_active(
        _admin_cap: &AdminCap,
        config: &mut StrategyConfig,
        active: bool,
    ) {
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
}
