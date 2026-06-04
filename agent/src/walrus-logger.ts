import { config } from './config.js';
import type { ReasoningLog } from '@suisage/shared';

/**
 * Store a reasoning log on Walrus as a JSON blob.
 * Returns the blob ID for on-chain reference.
 */
export async function storeReasoning(log: ReasoningLog): Promise<string> {
  const payload = JSON.stringify(log, null, 2);

  try {
    const response = await fetch(`${config.walrusPublisherUrl}/v1/blobs`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });

    if (!response.ok) {
      throw new Error(`Walrus store failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as Record<string, unknown>;

    // Walrus returns different shapes depending on new vs existing blob
    let blobId: string;
    if ('newlyCreated' in result) {
      const created = result.newlyCreated as Record<string, unknown>;
      const blobObject = created.blobObject as Record<string, unknown>;
      blobId = String(blobObject.blobId);
    } else if ('alreadyCertified' in result) {
      const certified = result.alreadyCertified as Record<string, unknown>;
      blobId = String(certified.blobId);
    } else {
      throw new Error(`Unexpected Walrus response: ${JSON.stringify(result)}`);
    }

    console.log(`[WalrusLogger] Stored reasoning blob: ${blobId}`);
    return blobId;
  } catch (error) {
    console.error('[WalrusLogger] Failed to store reasoning:', error);
    // Return a placeholder so the agent doesn't crash
    return `error-${Date.now()}`;
  }
}

/**
 * Retrieve a reasoning log from Walrus by blob ID.
 */
export async function retrieveReasoning(blobId: string): Promise<ReasoningLog | null> {
  try {
    const response = await fetch(`${config.walrusAggregatorUrl}/v1/blobs/${blobId}`);

    if (!response.ok) {
      throw new Error(`Walrus fetch failed: ${response.status}`);
    }

    const data = await response.json();
    return data as ReasoningLog;
  } catch (error) {
    console.error(`[WalrusLogger] Failed to retrieve blob ${blobId}:`, error);
    return null;
  }
}
