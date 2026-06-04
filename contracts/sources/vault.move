module suisage::vault {
    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::event;

    // ===== Errors =====
    const EZeroDeposit: u64 = 0;
    const EInsufficientShares: u64 = 1;
    const EVaultPaused: u64 = 2;
    const EZeroWithdraw: u64 = 3;

    // ===== Objects =====

    /// Shared vault holding all user deposits
    public struct Vault has key {
        id: UID,
        /// Total SUI balance held
        balance: Balance<SUI>,
        /// Total shares outstanding
        total_shares: u64,
        /// Amount currently deployed to trading (tracked off-balance)
        deployed_amount: u64,
        /// Whether the vault is paused (emergency stop)
        paused: bool,
    }

    /// Receipt NFT proving a user's deposit and share count
    public struct DepositReceipt has key, store {
        id: UID,
        vault_id: ID,
        shares: u64,
        deposited_amount: u64,
    }

    // ===== Events =====

    public struct DepositEvent has copy, drop {
        vault_id: ID,
        depositor: address,
        amount: u64,
        shares_minted: u64,
        total_shares: u64,
    }

    public struct WithdrawEvent has copy, drop {
        vault_id: ID,
        withdrawer: address,
        amount: u64,
        shares_burned: u64,
        total_shares: u64,
    }

    // ===== Public functions =====

    /// Create a new shared vault
    public fun create_vault(ctx: &mut TxContext) {
        let vault = Vault {
            id: object::new(ctx),
            balance: balance::zero(),
            total_shares: 0,
            deployed_amount: 0,
            paused: false,
        };
        transfer::share_object(vault);
    }

    /// Deposit SUI into the vault, receive a DepositReceipt
    public fun deposit(
        vault: &mut Vault,
        coin: Coin<SUI>,
        ctx: &mut TxContext,
    ) {
        assert!(!vault.paused, EVaultPaused);
        let amount = coin::value(&coin);
        assert!(amount > 0, EZeroDeposit);

        // Calculate shares: if first deposit, 1:1. Otherwise proportional.
        let total_value = balance::value(&vault.balance) + vault.deployed_amount;
        let shares = if (vault.total_shares == 0 || total_value == 0) {
            amount
        } else {
            ((((amount as u128) * (vault.total_shares as u128)) / (total_value as u128)) as u64)
        };

        // Take the coin into the vault balance
        balance::join(&mut vault.balance, coin::into_balance(coin));
        vault.total_shares = vault.total_shares + shares;

        let vault_id = object::id(vault);

        // Mint receipt
        let receipt = DepositReceipt {
            id: object::new(ctx),
            vault_id,
            shares,
            deposited_amount: amount,
        };
        transfer::transfer(receipt, tx_context::sender(ctx));

        event::emit(DepositEvent {
            vault_id,
            depositor: tx_context::sender(ctx),
            amount,
            shares_minted: shares,
            total_shares: vault.total_shares,
        });
    }

    /// Withdraw SUI by burning a DepositReceipt (full or partial)
    public fun withdraw(
        vault: &mut Vault,
        receipt: DepositReceipt,
        shares_to_burn: u64,
        ctx: &mut TxContext,
    ) {
        assert!(!vault.paused, EVaultPaused);
        assert!(shares_to_burn > 0, EZeroWithdraw);
        assert!(shares_to_burn <= receipt.shares, EInsufficientShares);

        let total_value = balance::value(&vault.balance) + vault.deployed_amount;
        let withdraw_amount = ((((shares_to_burn as u128) * (total_value as u128)) / (vault.total_shares as u128)) as u64);

        // Clamp to available balance (deployed funds may not be available)
        let available = balance::value(&vault.balance);
        let actual_withdraw = if (withdraw_amount > available) { available } else { withdraw_amount };

        vault.total_shares = vault.total_shares - shares_to_burn;

        let vault_id = object::id(vault);

        // Handle receipt: if partial burn, update; if full burn, destroy
        let DepositReceipt { id, vault_id: _, shares, deposited_amount: _ } = receipt;
        if (shares_to_burn < shares) {
            // Create new receipt with remaining shares
            let new_receipt = DepositReceipt {
                id: object::new(ctx),
                vault_id,
                shares: shares - shares_to_burn,
                deposited_amount: 0, // original deposit tracking lost on partial
            };
            transfer::transfer(new_receipt, tx_context::sender(ctx));
        };
        object::delete(id);

        // Transfer withdrawn SUI to sender
        let withdrawn_balance = balance::split(&mut vault.balance, actual_withdraw);
        let withdrawn_coin = coin::from_balance(withdrawn_balance, ctx);
        transfer::public_transfer(withdrawn_coin, tx_context::sender(ctx));

        event::emit(WithdrawEvent {
            vault_id,
            withdrawer: tx_context::sender(ctx),
            amount: actual_withdraw,
            shares_burned: shares_to_burn,
            total_shares: vault.total_shares,
        });
    }

    /// Emergency withdraw - ignores pause, burns full receipt
    public fun emergency_withdraw(
        vault: &mut Vault,
        receipt: DepositReceipt,
        ctx: &mut TxContext,
    ) {
        let shares_to_burn = receipt.shares;
        assert!(shares_to_burn > 0, EZeroWithdraw);

        let total_value = balance::value(&vault.balance) + vault.deployed_amount;
        let withdraw_amount = ((((shares_to_burn as u128) * (total_value as u128)) / (vault.total_shares as u128)) as u64);

        let available = balance::value(&vault.balance);
        let actual_withdraw = if (withdraw_amount > available) { available } else { withdraw_amount };

        vault.total_shares = vault.total_shares - shares_to_burn;

        let DepositReceipt { id, vault_id: _, shares: _, deposited_amount: _ } = receipt;
        object::delete(id);

        let withdrawn_balance = balance::split(&mut vault.balance, actual_withdraw);
        let withdrawn_coin = coin::from_balance(withdrawn_balance, ctx);
        transfer::public_transfer(withdrawn_coin, tx_context::sender(ctx));

        event::emit(WithdrawEvent {
            vault_id: object::id(vault),
            withdrawer: tx_context::sender(ctx),
            amount: actual_withdraw,
            shares_burned: shares_to_burn,
            total_shares: vault.total_shares,
        });
    }

    // ===== Agent-only functions (called via agent_auth) =====

    /// Withdraw funds from vault for trading deployment (agent only)
    public(package) fun withdraw_for_deployment(
        vault: &mut Vault,
        amount: u64,
    ): Balance<SUI> {
        vault.deployed_amount = vault.deployed_amount + amount;
        balance::split(&mut vault.balance, amount)
    }

    /// Return funds from trading back to vault (agent only)
    public(package) fun return_from_deployment(
        vault: &mut Vault,
        funds: Balance<SUI>,
    ) {
        let amount = balance::value(&funds);
        if (amount <= vault.deployed_amount) {
            vault.deployed_amount = vault.deployed_amount - amount;
        } else {
            // Profit case: deployed_amount goes to 0, excess is profit
            vault.deployed_amount = 0;
        };
        balance::join(&mut vault.balance, funds);
    }

    /// Set paused state (package-level, controlled by admin_cap)
    public(package) fun set_paused(vault: &mut Vault, paused: bool) {
        vault.paused = paused;
    }

    // ===== View functions =====

    public fun vault_balance(vault: &Vault): u64 {
        balance::value(&vault.balance)
    }

    public fun vault_total_shares(vault: &Vault): u64 {
        vault.total_shares
    }

    public fun vault_deployed_amount(vault: &Vault): u64 {
        vault.deployed_amount
    }

    public fun vault_paused(vault: &Vault): bool {
        vault.paused
    }

    public fun receipt_shares(receipt: &DepositReceipt): u64 {
        receipt.shares
    }

    public fun receipt_vault_id(receipt: &DepositReceipt): ID {
        receipt.vault_id
    }
}
