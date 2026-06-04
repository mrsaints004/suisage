module suisage::agent_auth {
    use sui::event;
    use suisage::vault::Vault;

    // ===== Errors =====
    const ENotAuthorized: u64 = 100;
    const EExceedsMaxTradeSize: u64 = 101;

    // ===== Objects =====

    /// Admin capability - held by vault creator
    public struct AdminCap has key, store {
        id: UID,
        vault_id: ID,
    }

    /// Agent capability - granted to the trading agent
    public struct AgentCap has key, store {
        id: UID,
        vault_id: ID,
        /// Maximum single trade size in MIST
        max_trade_size: u64,
        /// Maximum basis points of vault to deploy (e.g., 5000 = 50%)
        max_deployment_bps: u64,
        /// Whether this agent cap is active
        active: bool,
    }

    // ===== Events =====

    public struct TradeRecordEvent has copy, drop {
        vault_id: ID,
        agent: address,
        trade_type: u8, // 0=BUY, 1=SELL, 2=REBALANCE
        amount: u64,
        price: u64,
        walrus_blob_id: vector<u8>,
        timestamp_ms: u64,
    }

    public struct AgentAuthorizedEvent has copy, drop {
        vault_id: ID,
        agent_cap_id: ID,
        agent: address,
    }

    public struct AgentRevokedEvent has copy, drop {
        vault_id: ID,
        agent_cap_id: ID,
    }

    // ===== Public functions =====

    /// Create admin cap (called alongside vault creation)
    public fun create_admin_cap(
        vault: &Vault,
        ctx: &mut TxContext,
    ) {
        let admin_cap = AdminCap {
            id: object::new(ctx),
            vault_id: object::id(vault),
        };
        transfer::transfer(admin_cap, tx_context::sender(ctx));
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
        };

        let agent_cap_id = object::id(&agent_cap);
        transfer::transfer(agent_cap, agent_address);

        event::emit(AgentAuthorizedEvent {
            vault_id: object::id(vault),
            agent_cap_id,
            agent: agent_address,
        });
    }

    /// Record a trade executed by the agent (stores Walrus blob reference on-chain)
    public fun record_trade(
        agent_cap: &AgentCap,
        _vault: &Vault,
        trade_type: u8,
        amount: u64,
        price: u64,
        walrus_blob_id: vector<u8>,
        timestamp_ms: u64,
        ctx: &mut TxContext,
    ) {
        assert!(agent_cap.active, ENotAuthorized);
        assert!(agent_cap.vault_id == object::id(_vault), ENotAuthorized);
        assert!(amount <= agent_cap.max_trade_size, EExceedsMaxTradeSize);

        event::emit(TradeRecordEvent {
            vault_id: agent_cap.vault_id,
            agent: tx_context::sender(ctx),
            trade_type,
            amount,
            price,
            walrus_blob_id,
            timestamp_ms,
        });
    }

    /// Pause the vault (admin only)
    public fun pause_vault(
        admin_cap: &AdminCap,
        vault: &mut Vault,
    ) {
        assert!(admin_cap.vault_id == object::id(vault), ENotAuthorized);
        suisage::vault::set_paused(vault, true);
    }

    /// Unpause the vault (admin only)
    public fun unpause_vault(
        admin_cap: &AdminCap,
        vault: &mut Vault,
    ) {
        assert!(admin_cap.vault_id == object::id(vault), ENotAuthorized);
        suisage::vault::set_paused(vault, false);
    }

    /// Revoke an agent - destroys the AgentCap (admin must own it or agent returns it)
    public fun revoke_agent(
        admin_cap: &AdminCap,
        agent_cap: AgentCap,
    ) {
        assert!(admin_cap.vault_id == agent_cap.vault_id, ENotAuthorized);

        let agent_cap_id = object::id(&agent_cap);
        let vault_id = agent_cap.vault_id;

        let AgentCap { id, vault_id: _, max_trade_size: _, max_deployment_bps: _, active: _ } = agent_cap;
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

    public fun admin_cap_vault_id(cap: &AdminCap): ID {
        cap.vault_id
    }
}
