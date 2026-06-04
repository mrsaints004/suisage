import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { config } from './config.js';

// Initialize Sui client
export const suiClient = new SuiClient({
  url: config.suiRpcUrl || getFullnodeUrl(config.suiNetwork),
});

// Initialize keypair from private key
export function getKeypair(): Ed25519Keypair {
  const key = config.agentPrivateKey;
  // Support both bech32 (suiprivkey...) and base64 formats
  if (key.startsWith('suiprivkey')) {
    return Ed25519Keypair.fromSecretKey(key);
  }
  // Assume raw base64 bytes
  const bytes = Buffer.from(key, 'base64');
  return Ed25519Keypair.fromSecretKey(bytes);
}

export const keypair = getKeypair();
export const agentAddress = keypair.getPublicKey().toSuiAddress();

// Execute a transaction
export async function executeTransaction(tx: Transaction) {
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
}

console.log(`[Client] Agent address: ${agentAddress}`);
