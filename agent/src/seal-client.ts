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
import type { SealClient as SealClientType } from '@mysten/seal';

// Seal configuration
const SEAL_PACKAGE_ID = process.env.SEAL_PACKAGE_ID || '';
const SEAL_KEY_SERVER_OBJECT_ID = process.env.SEAL_KEY_SERVER_OBJECT_ID || '';

let sealEnabled = false;
let sealClient: SealClientType | null = null;

/**
 * Initialize Seal client. Call once at startup.
 */
export async function initSeal(): Promise<boolean> {
  if (!SEAL_PACKAGE_ID || !SEAL_KEY_SERVER_OBJECT_ID) {
    console.log('[Seal] Not configured (set SEAL_PACKAGE_ID and SEAL_KEY_SERVER_OBJECT_ID to enable encrypted reasoning)');
    return false;
  }

  try {
    const { SealClient } = await import('@mysten/seal');
    const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');

    const suiClient = new SuiClient({
      url: config.suiRpcUrl || getFullnodeUrl(config.suiNetwork),
    });

    sealClient = new SealClient({
      suiClient,
      serverConfigs: [
        {
          objectId: SEAL_KEY_SERVER_OBJECT_ID,
          weight: 1,
        },
      ],
      verifyKeyServers: config.suiNetwork === 'mainnet',
    });

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
  return sealEnabled && sealClient !== null;
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
  if (!sealClient || !policyId) {
    return { data: jsonData, encrypted: false };
  }

  try {
    const encoder = new TextEncoder();
    const plaintext = encoder.encode(jsonData);

    const { encryptedObject } = await sealClient.encrypt({
      threshold: 1,
      packageId: SEAL_PACKAGE_ID,
      id: policyId,
      data: plaintext,
    });

    console.log(`[Seal] Encrypted reasoning (${plaintext.length} bytes → ${encryptedObject.length} bytes)`);
    return { data: encryptedObject, encrypted: true };
  } catch (error) {
    console.error('[Seal] Encryption failed, storing unencrypted:', error);
    return { data: jsonData, encrypted: false };
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
    keyServer: SEAL_KEY_SERVER_OBJECT_ID,
  };
}
