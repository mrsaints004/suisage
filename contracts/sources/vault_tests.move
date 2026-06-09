#[test_only]
module suisage::vault_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use suisage::vault::{Self, Vault, DepositReceipt};

    const ADMIN: address = @0xAD;
    const USER1: address = @0xA1;
    const USER2: address = @0xA2;

    fun setup_vault(scenario: &mut Scenario) {
        ts::next_tx(scenario, ADMIN);
        vault::create_vault(ts::ctx(scenario));
    }

    fun mint_sui(amount: u64, scenario: &mut Scenario): Coin<SUI> {
        coin::mint_for_testing<SUI>(amount, ts::ctx(scenario))
    }

    #[test]
    fun test_create_vault() {
        let mut scenario = ts::begin(ADMIN);
        setup_vault(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        let vault = ts::take_shared<Vault>(&scenario);
        assert!(vault::vault_balance(&vault) == 0);
        assert!(vault::vault_total_shares(&vault) == 0);
        assert!(vault::vault_deployed_amount(&vault) == 0);
        assert!(!vault::vault_paused(&vault));
        assert!(vault::vault_creator(&vault) == ADMIN);
        assert!(vault::vault_performance_fee_bps(&vault) == 1000); // 10% default
        ts::return_shared(vault);
        ts::end(scenario);
    }

    #[test]
    fun test_first_deposit_1_to_1_shares() {
        let mut scenario = ts::begin(ADMIN);
        setup_vault(&mut scenario);

        // Deposit 100 SUI
        ts::next_tx(&mut scenario, USER1);
        let mut vault = ts::take_shared<Vault>(&scenario);
        let coin = mint_sui(100_000_000_000, &mut scenario); // 100 SUI in MIST
        vault::deposit(&mut vault, coin, ts::ctx(&mut scenario));
        assert!(vault::vault_balance(&vault) == 100_000_000_000);
        assert!(vault::vault_total_shares(&vault) == 100_000_000_000); // 1:1
        ts::return_shared(vault);

        // Check receipt
        ts::next_tx(&mut scenario, USER1);
        let receipt = ts::take_from_sender<DepositReceipt>(&scenario);
        assert!(vault::receipt_shares(&receipt) == 100_000_000_000);
        ts::return_to_sender(&scenario, receipt);

        ts::end(scenario);
    }

    #[test]
    fun test_proportional_shares_on_second_deposit() {
        let mut scenario = ts::begin(ADMIN);
        setup_vault(&mut scenario);

        // User1 deposits 100 SUI
        ts::next_tx(&mut scenario, USER1);
        let mut vault = ts::take_shared<Vault>(&scenario);
        vault::deposit(&mut vault, mint_sui(100_000_000_000, &mut scenario), ts::ctx(&mut scenario));
        ts::return_shared(vault);

        // User2 deposits 50 SUI
        ts::next_tx(&mut scenario, USER2);
        let mut vault = ts::take_shared<Vault>(&scenario);
        vault::deposit(&mut vault, mint_sui(50_000_000_000, &mut scenario), ts::ctx(&mut scenario));
        assert!(vault::vault_total_shares(&vault) == 150_000_000_000); // 100 + 50
        assert!(vault::vault_balance(&vault) == 150_000_000_000);
        ts::return_shared(vault);

        // Check User2 receipt
        ts::next_tx(&mut scenario, USER2);
        let receipt = ts::take_from_sender<DepositReceipt>(&scenario);
        assert!(vault::receipt_shares(&receipt) == 50_000_000_000); // proportional
        ts::return_to_sender(&scenario, receipt);

        ts::end(scenario);
    }

    #[test]
    fun test_full_withdraw() {
        let mut scenario = ts::begin(ADMIN);
        setup_vault(&mut scenario);

        // Deposit 100 SUI
        ts::next_tx(&mut scenario, USER1);
        let mut vault = ts::take_shared<Vault>(&scenario);
        vault::deposit(&mut vault, mint_sui(100_000_000_000, &mut scenario), ts::ctx(&mut scenario));
        ts::return_shared(vault);

        // Withdraw all shares
        ts::next_tx(&mut scenario, USER1);
        let mut vault = ts::take_shared<Vault>(&scenario);
        let receipt = ts::take_from_sender<DepositReceipt>(&scenario);
        let shares = vault::receipt_shares(&receipt);
        vault::withdraw(&mut vault, receipt, shares, ts::ctx(&mut scenario));
        assert!(vault::vault_total_shares(&vault) == 0);
        assert!(vault::vault_balance(&vault) == 0);
        ts::return_shared(vault);

        ts::end(scenario);
    }

    #[test]
    fun test_partial_withdraw() {
        let mut scenario = ts::begin(ADMIN);
        setup_vault(&mut scenario);

        // Deposit 100 SUI
        ts::next_tx(&mut scenario, USER1);
        let mut vault = ts::take_shared<Vault>(&scenario);
        vault::deposit(&mut vault, mint_sui(100_000_000_000, &mut scenario), ts::ctx(&mut scenario));
        ts::return_shared(vault);

        // Withdraw half
        ts::next_tx(&mut scenario, USER1);
        let mut vault = ts::take_shared<Vault>(&scenario);
        let receipt = ts::take_from_sender<DepositReceipt>(&scenario);
        vault::withdraw(&mut vault, receipt, 50_000_000_000, ts::ctx(&mut scenario));
        assert!(vault::vault_total_shares(&vault) == 50_000_000_000);
        assert!(vault::vault_balance(&vault) == 50_000_000_000);
        ts::return_shared(vault);

        // Check new receipt with remaining shares
        ts::next_tx(&mut scenario, USER1);
        let receipt = ts::take_from_sender<DepositReceipt>(&scenario);
        assert!(vault::receipt_shares(&receipt) == 50_000_000_000);
        ts::return_to_sender(&scenario, receipt);

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = suisage::vault::EVaultPaused)]
    fun test_deposit_when_paused_fails() {
        let mut scenario = ts::begin(ADMIN);
        setup_vault(&mut scenario);

        // Pause vault directly (using package-level function from test)
        ts::next_tx(&mut scenario, ADMIN);
        let mut vault = ts::take_shared<Vault>(&scenario);
        vault::set_paused(&mut vault, true);
        ts::return_shared(vault);

        // Try to deposit — should fail
        ts::next_tx(&mut scenario, USER1);
        let mut vault = ts::take_shared<Vault>(&scenario);
        vault::deposit(&mut vault, mint_sui(100, &mut scenario), ts::ctx(&mut scenario));
        ts::return_shared(vault);

        ts::end(scenario);
    }

    #[test]
    fun test_emergency_withdraw_when_paused() {
        let mut scenario = ts::begin(ADMIN);
        setup_vault(&mut scenario);

        // Deposit
        ts::next_tx(&mut scenario, USER1);
        let mut vault = ts::take_shared<Vault>(&scenario);
        vault::deposit(&mut vault, mint_sui(100_000_000_000, &mut scenario), ts::ctx(&mut scenario));
        ts::return_shared(vault);

        // Pause vault
        ts::next_tx(&mut scenario, ADMIN);
        let mut vault = ts::take_shared<Vault>(&scenario);
        vault::set_paused(&mut vault, true);
        ts::return_shared(vault);

        // Emergency withdraw should work even when paused
        ts::next_tx(&mut scenario, USER1);
        let mut vault = ts::take_shared<Vault>(&scenario);
        let receipt = ts::take_from_sender<DepositReceipt>(&scenario);
        vault::emergency_withdraw(&mut vault, receipt, ts::ctx(&mut scenario));
        assert!(vault::vault_total_shares(&vault) == 0);
        ts::return_shared(vault);

        ts::end(scenario);
    }

    #[test]
    fun test_nav_per_share() {
        let mut scenario = ts::begin(ADMIN);
        setup_vault(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        let vault = ts::take_shared<Vault>(&scenario);
        // Empty vault should have NAV = 1.0 (1e9)
        assert!(vault::vault_nav_per_share(&vault) == 1_000_000_000);
        ts::return_shared(vault);

        // Deposit 100 SUI
        ts::next_tx(&mut scenario, USER1);
        let mut vault = ts::take_shared<Vault>(&scenario);
        vault::deposit(&mut vault, mint_sui(100_000_000_000, &mut scenario), ts::ctx(&mut scenario));
        // After first deposit, NAV = total_value / total_shares * 1e9 = 1.0 * 1e9
        assert!(vault::vault_nav_per_share(&vault) == 1_000_000_000);
        ts::return_shared(vault);

        ts::end(scenario);
    }

    #[test]
    fun test_vault_total_value_includes_deployed() {
        let mut scenario = ts::begin(ADMIN);
        setup_vault(&mut scenario);

        ts::next_tx(&mut scenario, USER1);
        let mut vault = ts::take_shared<Vault>(&scenario);
        vault::deposit(&mut vault, mint_sui(100_000_000_000, &mut scenario), ts::ctx(&mut scenario));
        ts::return_shared(vault);

        // Simulate deployment
        ts::next_tx(&mut scenario, ADMIN);
        let mut vault = ts::take_shared<Vault>(&scenario);
        let _deployed = vault::withdraw_for_deployment(&mut vault, 30_000_000_000);
        assert!(vault::vault_balance(&vault) == 70_000_000_000);
        assert!(vault::vault_deployed_amount(&vault) == 30_000_000_000);
        assert!(vault::vault_total_value(&vault) == 100_000_000_000); // balance + deployed
        sui::balance::destroy_for_testing(_deployed);
        ts::return_shared(vault);

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = suisage::vault::EInsufficientLiquidity)]
    fun test_withdraw_blocked_when_funds_deployed() {
        let mut scenario = ts::begin(ADMIN);
        setup_vault(&mut scenario);

        ts::next_tx(&mut scenario, USER1);
        let mut vault = ts::take_shared<Vault>(&scenario);
        vault::deposit(&mut vault, mint_sui(100_000_000_000, &mut scenario), ts::ctx(&mut scenario));
        ts::return_shared(vault);

        // Deploy 80% of funds
        ts::next_tx(&mut scenario, ADMIN);
        let mut vault = ts::take_shared<Vault>(&scenario);
        let _deployed = vault::withdraw_for_deployment(&mut vault, 80_000_000_000);
        sui::balance::destroy_for_testing(_deployed);
        ts::return_shared(vault);

        // Try to withdraw all — should fail (only 20 SUI liquid)
        ts::next_tx(&mut scenario, USER1);
        let mut vault = ts::take_shared<Vault>(&scenario);
        let receipt = ts::take_from_sender<DepositReceipt>(&scenario);
        vault::withdraw(&mut vault, receipt, 100_000_000_000, ts::ctx(&mut scenario));
        ts::return_shared(vault);

        ts::end(scenario);
    }

    #[test]
    fun test_profit_tracking_and_fees() {
        let mut scenario = ts::begin(ADMIN);
        setup_vault(&mut scenario);

        // Deposit 100 SUI
        ts::next_tx(&mut scenario, USER1);
        let mut vault = ts::take_shared<Vault>(&scenario);
        vault::deposit(&mut vault, mint_sui(100_000_000_000, &mut scenario), ts::ctx(&mut scenario));
        ts::return_shared(vault);

        // Deploy 50 SUI
        ts::next_tx(&mut scenario, ADMIN);
        let mut vault = ts::take_shared<Vault>(&scenario);
        let _deployed = vault::withdraw_for_deployment(&mut vault, 50_000_000_000);
        sui::balance::destroy_for_testing(_deployed);
        ts::return_shared(vault);

        // Return 60 SUI (10 SUI profit)
        ts::next_tx(&mut scenario, ADMIN);
        let mut vault = ts::take_shared<Vault>(&scenario);
        let profit_funds = sui::balance::create_for_testing<SUI>(60_000_000_000);
        vault::return_from_deployment(&mut vault, profit_funds);
        assert!(vault::vault_total_profit(&vault) == 10_000_000_000); // 10 SUI profit
        assert!(vault::vault_accrued_fees(&vault) == 1_000_000_000); // 10% fee = 1 SUI
        // Balance = 50 (remaining) + 60 (returned) - 1 (fee) = 109 SUI
        // deployed_amount = 0
        assert!(vault::vault_deployed_amount(&vault) == 0);
        ts::return_shared(vault);

        ts::end(scenario);
    }
}
