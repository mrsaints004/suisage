import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { DeepBookClient } from '@mysten/deepbook';
import { config } from './config.js';

// Initialize Sui client
export const suiClient = new SuiClient({
  url: config.suiRpcUrl || getFullnodeUrl(config.suiNetwork),
});

// Initialize keypair from private key
function getKeypair(): Ed25519Keypair {
  const key = config.agentPrivateKey;
  if (key.startsWith('suiprivkey')) {
    return Ed25519Keypair.fromSecretKey(key);
  }
  const bytes = Buffer.from(key, 'base64');
  return Ed25519Keypair.fromSecretKey(bytes);
}

export const keypair = getKeypair();
export const agentAddress = keypair.getPublicKey().toSuiAddress();

// Initialize DeepBook client
export const deepbookClient = new DeepBookClient(
  suiClient,
  config.accountCapId || undefined,
  agentAddress,
);

// Set account cap if provided
if (config.accountCapId) {
  deepbookClient.setAccountCap(config.accountCapId);
  console.log(`[Client] DeepBook AccountCap set: ${config.accountCapId}`);
}

// Execute a transaction with retry logic (max 2 retries, exponential backoff)
export async function executeTransaction(tx: Transaction) {
  const maxRetries = 2;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await suiClient.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: {
          showEffects: true,
          showEvents: true,
          showObjectChanges: true,
        },
      });
      return result;
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const delayMs = 1000 * Math.pow(2, attempt); // 1s, 2s
        console.warn(`[Client] Transaction attempt ${attempt + 1} failed, retrying in ${delayMs}ms...`, error);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}

/**
 * Create a DeepBook AccountCap if one doesn't exist yet.
 * Returns the new AccountCap object ID.
 */
export async function createAccountCap(): Promise<string> {
  console.log('[Client] Creating DeepBook AccountCap...');
  const tx = deepbookClient.createAccount(agentAddress);
  const result = await executeTransaction(tx);

  // Find the created AccountCap object
  const created = result.objectChanges?.find(
    (change) => change.type === 'created' && change.objectType.includes('AccountCap'),
  );

  if (!created || created.type !== 'created') {
    throw new Error('Failed to create AccountCap - no created object found');
  }

  const capId = created.objectId;
  deepbookClient.setAccountCap(capId);
  console.log(`[Client] AccountCap created: ${capId}`);
  console.log(`[Client] Add this to your .env: ACCOUNT_CAP_ID=${capId}`);
  return capId;
}

/**
 * Discover available DeepBook pools on the current network.
 */
export async function discoverPools(): Promise<Array<{ poolId: string; baseAsset: string; quoteAsset: string }>> {
  console.log('[Client] Discovering DeepBook pools...');
  const pools = await deepbookClient.getAllPools({ limit: 100 });
  for (const pool of pools.data) {
    console.log(`  Pool: ${pool.poolId}`);
    console.log(`    Base: ${pool.baseAsset}`);
    console.log(`    Quote: ${pool.quoteAsset}`);
  }
  return pools.data;
}

console.log(`[Client] Agent address: ${agentAddress}`);
console.log(`[Client] DeepBook pool: ${config.deepbookPoolId || 'not set (will discover)'}`);
