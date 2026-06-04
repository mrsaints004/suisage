/**
 * Seal Integration — Encrypted Reasoning on Walrus
 *
 * Uses the Seal SDK (@mysten/seal) to encrypt reasoning data before
 * storing on Walrus. Only authorized parties (vault depositors, the agent
 * itself, auditors with access) can decrypt reasoning blobs.
 *
 * Flow:
 * 1. Agent generates reasoning → JSON blob
 * 2. Seal encrypts the blob using a threshold encryption scheme
 * 3. Encrypted blob is stored on Walrus (encrypted at rest)
 * 4. Blob ID is recorded on-chain (Move TradeRecordEvent)
 * 5. Authorized users decrypt via Seal key servers using on-chain policy
 *
 * Access Control:
 * - The Seal policy is defined by a Move function (seal_approve)
 * - Only addresses that satisfy the policy can request decryption keys
 * - Policy can check: is the caller a vault depositor? Is the caller the admin?
 */

import { config } from './config.js';

// Seal configuration
const SEAL_PACKAGE_ID = process.env.SEAL_PACKAGE_ID || '';
const SEAL_KEY_SERVER_URL = process.env.SEAL_KEY_SERVER_URL || 'https://seal-key-server.testnet.walrus.dev';

let sealEnabled = false;

interface SealInstance {
  encrypt: (data: Uint8Array, policyId: string) => Promise<Uint8Array>;
  decrypt: (encryptedData: Uint8Array, txBytes: Uint8Array) => Promise<Uint8Array>;
}

let sealInstance: SealInstance | null = null;

/**
 * Initialize Seal client. Call once at startup.
 */
export async function initSeal(): Promise<boolean> {
  if (!SEAL_PACKAGE_ID) {
    console.log('[Seal] Not configured (set SEAL_PACKAGE_ID to enable encrypted reasoning)');
    return false;
  }

  try {
    // Dynamic import of Seal SDK
    const sealModule = await import('@mysten/seal');

    // The Seal SDK provides SealClient for encryption/decryption
    const { SealClient } = sealModule;
    const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');

    const suiClient = new SuiClient({
      url: config.suiRpcUrl || getFullnodeUrl(config.suiNetwork),
    });

    const client = new SealClient({
      suiClient,
      serverObjectIds: [SEAL_KEY_SERVER_URL], // key server object IDs
      verifyKeyServers: false, // testnet, skip verification
    });

    sealInstance = {
      encrypt: async (data: Uint8Array, policyId: string): Promise<Uint8Array> => {
        // Seal encrypts using the policy object ID as the encryption identity
        const encrypted = await client.encrypt({
          threshold: 2,
          packageId: SEAL_PACKAGE_ID,
          id: policyId,
          data,
        });
        return encrypted;
      },
      decrypt: async (encryptedData: Uint8Array, txBytes: Uint8Array): Promise<Uint8Array> => {
        const decrypted = await client.decrypt({
          data: encryptedData,
          txBytes,
        });
        return decrypted;
      },
    };

    console.log('[Seal] Initialized — reasoning will be encrypted before Walrus storage');
    sealEnabled = true;
    return true;
  } catch (error) {
    console.error('[Seal] Initialization failed (continuing without encryption):', error);
    sealEnabled = false;
    return false;
  }
}

/**
 * Check if Seal encryption is enabled.
 */
export function isSealEnabled(): boolean {
  return sealEnabled && sealInstance !== null;
}

/**
 * Encrypt a reasoning blob before storing on Walrus.
 * If Seal is not configured, returns the original data unchanged.
 *
 * @param jsonData - The reasoning JSON string to encrypt
 * @param policyId - The Seal policy object ID (controls who can decrypt)
 * @returns Object with the data to store and whether it's encrypted
 */
export async function encryptReasoning(
  jsonData: string,
  policyId?: string,
): Promise<{ data: string | Uint8Array; encrypted: boolean }> {
  if (!sealInstance || !policyId) {
    return { data: jsonData, encrypted: false };
  }

  try {
    const encoder = new TextEncoder();
    const plaintext = encoder.encode(jsonData);

    const encrypted = await sealInstance.encrypt(plaintext, policyId);

    console.log(`[Seal] Encrypted reasoning (${plaintext.length} bytes → ${encrypted.length} bytes)`);
    return { data: encrypted, encrypted: true };
  } catch (error) {
    console.error('[Seal] Encryption failed, storing unencrypted:', error);
    return { data: jsonData, encrypted: false };
  }
}

/**
 * Decrypt a reasoning blob retrieved from Walrus.
 * If the data is not encrypted, returns it as-is.
 *
 * @param data - The encrypted data from Walrus
 * @param txBytes - Transaction bytes proving authorization (from Move seal_approve call)
 * @returns Decrypted JSON string
 */
export async function decryptReasoning(
  data: Uint8Array,
  txBytes: Uint8Array,
): Promise<string> {
  if (!sealInstance) {
    // Not encrypted, treat as plain text
    const decoder = new TextDecoder();
    return decoder.decode(data);
  }

  try {
    const decrypted = await sealInstance.decrypt(data, txBytes);
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (error) {
    console.error('[Seal] Decryption failed:', error);
    throw error;
  }
}

/**
 * Get the Seal policy ID for the current vault.
 * The policy is a Move object that defines who can decrypt reasoning blobs.
 * Returns empty string if Seal is not configured.
 */
export function getSealPolicyId(): string {
  return process.env.SEAL_POLICY_ID || '';
}

/**
 * Build the Seal policy description for display purposes.
 */
export function getSealStatus(): {
  enabled: boolean;
  packageId: string;
  policyId: string;
  keyServer: string;
} {
  return {
    enabled: sealEnabled,
    packageId: SEAL_PACKAGE_ID,
    policyId: getSealPolicyId(),
    keyServer: SEAL_KEY_SERVER_URL,
  };
}
