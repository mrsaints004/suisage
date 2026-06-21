import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
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
 * Create a DeepBook V3 BalanceManager if one doesn't exist yet.
 * Returns the new BalanceManager object ID.
 */
export async function createBalanceManager(): Promise<string> {
  console.log('[Client] Creating DeepBook V3 BalanceManager...');
  const tx = new Transaction();

  const [balanceManager] = tx.moveCall({
    target: `${config.deepbookPackageId}::balance_manager::new`,
    arguments: [],
  });

  tx.transferObjects([balanceManager], agentAddress);
  const result = await executeTransaction(tx);

  // Find the created BalanceManager object
  const created = result.objectChanges?.find(
    (change) => change.type === 'created' && change.objectType?.includes('BalanceManager'),
  );

  if (!created || created.type !== 'created') {
    throw new Error('Failed to create BalanceManager — no created object found');
  }

  const managerId = created.objectId;
  console.log(`[Client] BalanceManager created: ${managerId}`);
  console.log(`[Client] Add this to your .env: BALANCE_MANAGER_ID=${managerId}`);
  return managerId;
}

console.log(`[Client] Agent address: ${agentAddress}`);
console.log(`[Client] DeepBook V3 pool: ${config.deepbookPoolId || 'not set (will discover)'}`);
