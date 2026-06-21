/// Seal Whitelist Policy for SuiSage
///
/// Controls who can decrypt encrypted reasoning logs stored on Walrus.
/// The admin (vault creator) manages the whitelist of authorized addresses.
module seal_policy::whitelist;

use sui::table;

const ENoAccess: u64 = 1;
const EInvalidCap: u64 = 2;
const EDuplicate: u64 = 3;
const ENotInWhitelist: u64 = 4;

/// Shared object holding the set of authorized addresses.
public struct Whitelist has key {
    id: UID,
    addresses: table::Table<address, bool>,
}

/// Capability granting admin control over a specific Whitelist.
public struct Cap has key, store {
    id: UID,
    wl_id: ID,
}

/// Create a new whitelist and transfer the admin cap to the caller.
entry fun create(ctx: &mut TxContext) {
    let wl = Whitelist {
        id: object::new(ctx),
        addresses: table::new(ctx),
    };
    let cap = Cap {
        id: object::new(ctx),
        wl_id: object::id(&wl),
    };
    transfer::share_object(wl);
    transfer::public_transfer(cap, ctx.sender());
}

/// Add an address to the whitelist (admin only).
public fun add(wl: &mut Whitelist, cap: &Cap, account: address) {
    assert!(cap.wl_id == object::id(wl), EInvalidCap);
    assert!(!wl.addresses.contains(account), EDuplicate);
    wl.addresses.add(account, true);
}

/// Remove an address from the whitelist (admin only).
public fun remove(wl: &mut Whitelist, cap: &Cap, account: address) {
    assert!(cap.wl_id == object::id(wl), EInvalidCap);
    assert!(wl.addresses.contains(account), ENotInWhitelist);
    wl.addresses.remove(account);
}

/// Seal approval function — called by Seal key servers to verify access.
/// The caller must be on the whitelist AND the requested id must match
/// this whitelist's object ID prefix.
entry fun seal_approve(id: vector<u8>, wl: &Whitelist, ctx: &TxContext) {
    assert!(check_policy(ctx.sender(), id, wl), ENoAccess);
}

/// Internal policy check.
fun check_policy(caller: address, id: vector<u8>, wl: &Whitelist): bool {
    let prefix = wl.id.to_bytes();
    let mut i = 0;
    if (prefix.length() > id.length()) {
        return false
    };
    while (i < prefix.length()) {
        if (prefix[i] != id[i]) {
            return false
        };
        i = i + 1;
    };
    wl.addresses.contains(caller)
}
