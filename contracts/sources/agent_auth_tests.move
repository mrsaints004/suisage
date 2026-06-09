#[test_only]
module suisage::agent_auth_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::coin;
    use sui::sui::SUI;
    use sui::clock::{Self, Clock};
    use suisage::vault::{Self, Vault};
    use suisage::agent_auth::{Self, AdminCap, AgentCap};
    use suisage::strategy::{Self, StrategyConfig};

    const ADMIN: address = @0xAD;
    const AGENT: address = @0xAE;
    const USER: address = @0xA1;

    fun setup_full(scenario: &mut Scenario) {
        // Create vault
        ts::next_tx(scenario, ADMIN);
        vault::create_vault(ts::ctx(scenario));

        // Create admin cap
        ts::next_tx(scenario, ADMIN);
        let vault = ts::take_shared<Vault>(scenario);
        agent_auth::create_admin_cap(&vault, ts::ctx(scenario));
        ts::return_shared(vault);

        // Authorize agent: max 10 SUI per trade, 50% max deployment
        ts::next_tx(scenario, ADMIN);
        let vault = ts::take_shared<Vault>(scenario);
        let admin_cap = ts::take_from_sender<AdminCap>(scenario);
        agent_auth::authorize_agent(
            &admin_cap, &vault, AGENT,
            10_000_000_000, // 10 SUI max trade
            5000,           // 50% max deployment
            ts::ctx(scenario),
        );
        ts::return_to_sender(scenario, admin_cap);
        ts::return_shared(vault);

        // Create strategy (no AdminCap needed — authorized by tx sender)
        ts::next_tx(scenario, ADMIN);
        let vault = ts::take_shared<Vault>(scenario);
        strategy::create_strategy(
            object::id(&vault),
            3000,  // 30% max position
            500,   // 5% stop loss
            30,    // 30s cooldown
            3,     // max 3 positions
            ts::ctx(scenario),
        );
        ts::return_shared(vault);
    }

    fun deposit_sui(scenario: &mut Scenario, amount: u64) {
        let mut vault = ts::take_shared<Vault>(scenario);
        let coin = coin::mint_for_testing<SUI>(amount, ts::ctx(scenario));
        vault::deposit(&mut vault, coin, ts::ctx(scenario));
        ts::return_shared(vault);
    }

    #[test]
    fun test_authorize_and_check_agent_cap() {
        let mut scenario = ts::begin(ADMIN);
        setup_full(&mut scenario);

        ts::next_tx(&mut scenario, AGENT);
        let cap = ts::take_from_sender<AgentCap>(&scenario);
        assert!(agent_auth::agent_cap_active(&cap));
        assert!(agent_auth::agent_cap_max_trade_size(&cap) == 10_000_000_000);
        assert!(agent_auth::agent_cap_total_trades(&cap) == 0);
        assert!(agent_auth::agent_cap_total_volume(&cap) == 0);
        ts::return_to_sender(&scenario, cap);

        ts::end(scenario);
    }

    #[test]
    fun test_withdraw_for_trading_within_limits() {
        let mut scenario = ts::begin(ADMIN);
        setup_full(&mut scenario);

        // Deposit 100 SUI as user
        ts::next_tx(&mut scenario, USER);
        deposit_sui(&mut scenario, 100_000_000_000);

        // Create clock
        ts::next_tx(&mut scenario, AGENT);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, 1000); // 1 second

        // Agent withdraws 5 SUI for trading
        let mut vault = ts::take_shared<Vault>(&scenario);
        let strategy = ts::take_shared<StrategyConfig>(&scenario);
        let mut cap = ts::take_from_sender<AgentCap>(&scenario);

        let coin = agent_auth::withdraw_for_trading(
            &mut cap, &mut vault, &strategy, 5_000_000_000, &clock, ts::ctx(&mut scenario),
        );
        assert!(coin::value(&coin) == 5_000_000_000);
        assert!(vault::vault_deployed_amount(&vault) == 5_000_000_000);

        // Return coin
        agent_auth::return_from_trading(&cap, &mut vault, coin);

        ts::return_to_sender(&scenario, cap);
        ts::return_shared(vault);
        ts::return_shared(strategy);
        clock::destroy_for_testing(clock);

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = suisage::agent_auth::EExceedsMaxTradeSize)]
    fun test_withdraw_exceeds_max_trade_size() {
        let mut scenario = ts::begin(ADMIN);
        setup_full(&mut scenario);

        ts::next_tx(&mut scenario, USER);
        deposit_sui(&mut scenario, 100_000_000_000);

        ts::next_tx(&mut scenario, AGENT);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, 1000);

        let mut vault = ts::take_shared<Vault>(&scenario);
        let strategy = ts::take_shared<StrategyConfig>(&scenario);
        let mut cap = ts::take_from_sender<AgentCap>(&scenario);

        // Try to withdraw 15 SUI — exceeds 10 SUI max
        let _coin = agent_auth::withdraw_for_trading(
            &mut cap, &mut vault, &strategy, 15_000_000_000, &clock, ts::ctx(&mut scenario),
        );

        abort 0 // unreachable
    }

    #[test]
    #[expected_failure(abort_code = suisage::agent_auth::EPositionTooConcentrated)]
    fun test_withdraw_exceeds_position_concentration() {
        let mut scenario = ts::begin(ADMIN);
        setup_full(&mut scenario);

        // Deposit 10 SUI (small vault)
        ts::next_tx(&mut scenario, USER);
        deposit_sui(&mut scenario, 10_000_000_000);

        ts::next_tx(&mut scenario, AGENT);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, 1000);

        let mut vault = ts::take_shared<Vault>(&scenario);
        let strategy = ts::take_shared<StrategyConfig>(&scenario);
        let mut cap = ts::take_from_sender<AgentCap>(&scenario);

        // Try to withdraw 5 SUI — that's 50% of 10 SUI vault, exceeds 30% max_position_bps
        let _coin = agent_auth::withdraw_for_trading(
            &mut cap, &mut vault, &strategy, 5_000_000_000, &clock, ts::ctx(&mut scenario),
        );

        abort 0 // unreachable
    }

    #[test]
    #[expected_failure(abort_code = suisage::agent_auth::ECooldownNotMet)]
    fun test_cooldown_enforcement() {
        let mut scenario = ts::begin(ADMIN);
        setup_full(&mut scenario);

        ts::next_tx(&mut scenario, USER);
        deposit_sui(&mut scenario, 100_000_000_000);

        ts::next_tx(&mut scenario, AGENT);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, 60_000); // 60 seconds

        let mut vault = ts::take_shared<Vault>(&scenario);
        let strategy = ts::take_shared<StrategyConfig>(&scenario);
        let mut cap = ts::take_from_sender<AgentCap>(&scenario);

        // First trade — should succeed
        let coin = agent_auth::withdraw_for_trading(
            &mut cap, &mut vault, &strategy, 2_000_000_000, &clock, ts::ctx(&mut scenario),
        );
        agent_auth::return_from_trading(&cap, &mut vault, coin);

        // Record trade to update last_trade_timestamp
        agent_auth::record_trade(
            &mut cap, &vault, 0, 2_000_000_000, 1_000_000_000,
            b"blob1", b"hash1", true, 70, &clock, ts::ctx(&mut scenario),
        );

        // Advance only 10 seconds (cooldown is 30s)
        clock::set_for_testing(&mut clock, 70_000);

        // Second trade — should fail due to cooldown
        let _coin2 = agent_auth::withdraw_for_trading(
            &mut cap, &mut vault, &strategy, 2_000_000_000, &clock, ts::ctx(&mut scenario),
        );

        abort 0 // unreachable
    }

    #[test]
    fun test_record_trade_with_reasoning_hash() {
        let mut scenario = ts::begin(ADMIN);
        setup_full(&mut scenario);

        ts::next_tx(&mut scenario, AGENT);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, 1000);

        let vault = ts::take_shared<Vault>(&scenario);
        let mut cap = ts::take_from_sender<AgentCap>(&scenario);

        agent_auth::record_trade(
            &mut cap, &vault,
            0,                  // BUY
            5_000_000_000,      // 5 SUI
            1_500_000_000,      // $1.50
            b"walrus_blob_abc", // blob ID
            b"sha256_hash_xyz", // reasoning hash
            true,               // guardian approved
            72,                 // confidence
            &clock,
            ts::ctx(&mut scenario),
        );

        assert!(agent_auth::agent_cap_total_trades(&cap) == 1);
        assert!(agent_auth::agent_cap_total_volume(&cap) == 5_000_000_000);

        ts::return_to_sender(&scenario, cap);
        ts::return_shared(vault);
        clock::destroy_for_testing(clock);

        ts::end(scenario);
    }

    #[test]
    fun test_revoke_agent() {
        let mut scenario = ts::begin(ADMIN);
        setup_full(&mut scenario);

        // Agent transfers cap back to admin (simulating return for revocation)
        ts::next_tx(&mut scenario, AGENT);
        let cap = ts::take_from_sender<AgentCap>(&scenario);
        transfer::public_transfer(cap, ADMIN);

        // Admin revokes
        ts::next_tx(&mut scenario, ADMIN);
        let admin_cap = ts::take_from_sender<AdminCap>(&scenario);
        let agent_cap = ts::take_from_sender<AgentCap>(&scenario);
        agent_auth::revoke_agent(&admin_cap, agent_cap);
        ts::return_to_sender(&scenario, admin_cap);

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = suisage::agent_auth::EVaultPaused)]
    fun test_trading_blocked_when_paused() {
        let mut scenario = ts::begin(ADMIN);
        setup_full(&mut scenario);

        ts::next_tx(&mut scenario, USER);
        deposit_sui(&mut scenario, 100_000_000_000);

        // Pause vault
        ts::next_tx(&mut scenario, ADMIN);
        let admin_cap = ts::take_from_sender<AdminCap>(&scenario);
        let mut vault = ts::take_shared<Vault>(&scenario);
        agent_auth::pause_vault(&admin_cap, &mut vault);
        ts::return_to_sender(&scenario, admin_cap);
        ts::return_shared(vault);

        // Agent tries to trade — should fail
        ts::next_tx(&mut scenario, AGENT);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, 1000);

        let mut vault = ts::take_shared<Vault>(&scenario);
        let strategy = ts::take_shared<StrategyConfig>(&scenario);
        let mut cap = ts::take_from_sender<AgentCap>(&scenario);

        let _coin = agent_auth::withdraw_for_trading(
            &mut cap, &mut vault, &strategy, 2_000_000_000, &clock, ts::ctx(&mut scenario),
        );

        abort 0 // unreachable
    }

    #[test]
    #[expected_failure(abort_code = suisage::agent_auth::EStrategyNotActive)]
    fun test_trading_blocked_when_strategy_inactive() {
        let mut scenario = ts::begin(ADMIN);
        setup_full(&mut scenario);

        ts::next_tx(&mut scenario, USER);
        deposit_sui(&mut scenario, 100_000_000_000);

        // Deactivate strategy (sender is ADMIN who created it)
        ts::next_tx(&mut scenario, ADMIN);
        let mut strategy = ts::take_shared<StrategyConfig>(&scenario);
        strategy::set_active(&mut strategy, false, ts::ctx(&mut scenario));
        ts::return_shared(strategy);

        // Agent tries to trade — should fail
        ts::next_tx(&mut scenario, AGENT);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, 1000);

        let mut vault = ts::take_shared<Vault>(&scenario);
        let strategy = ts::take_shared<StrategyConfig>(&scenario);
        let mut cap = ts::take_from_sender<AgentCap>(&scenario);

        let _coin = agent_auth::withdraw_for_trading(
            &mut cap, &mut vault, &strategy, 2_000_000_000, &clock, ts::ctx(&mut scenario),
        );

        abort 0 // unreachable
    }
}
