import { config } from './config.js';
import type { ReasoningLog } from '@suisage/shared';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_FALLBACK_DIR = path.resolve(__dirname, '../../.walrus-fallback');

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

/**
 * Store a reasoning log on Walrus as a JSON blob.
 * Includes retry logic with exponential backoff.
 * Falls back to local file storage if Walrus is unavailable.
 */
export async function storeReasoning(log: ReasoningLog): Promise<string> {
  const payload = JSON.stringify(log, null, 2);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(`${config.walrusPublisherUrl}/v1/blobs`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(30000), // 30s timeout per attempt
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Walrus store failed: ${response.status} ${response.statusText} — ${body}`);
      }

      const result = await response.json() as Record<string, unknown>;

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
      const isLastAttempt = attempt === MAX_RETRIES - 1;
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);

      if (isLastAttempt) {
        console.error(`[WalrusLogger] All ${MAX_RETRIES} attempts failed. Falling back to local storage.`);
        return storeReasoningLocally(log, payload);
      }

      console.warn(
        `[WalrusLogger] Attempt ${attempt + 1}/${MAX_RETRIES} failed, retrying in ${delay}ms:`,
        error instanceof Error ? error.message : error,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Unreachable, but TypeScript needs it
  return storeReasoningLocally(log, payload);
}

/**
 * Fallback: store reasoning locally when Walrus is unavailable.
 * Returns a deterministic local ID prefixed with 'local-' so the system
 * can distinguish local blobs from Walrus blobs.
 */
function storeReasoningLocally(log: ReasoningLog, payload: string): string {
  try {
    if (!existsSync(LOCAL_FALLBACK_DIR)) {
      mkdirSync(LOCAL_FALLBACK_DIR, { recursive: true });
    }

    const localId = `local-${log.timestamp}-${Math.random().toString(36).slice(2, 8)}`;
    const filePath = path.join(LOCAL_FALLBACK_DIR, `${localId}.json`);
    writeFileSync(filePath, payload, 'utf-8');

    console.log(`[WalrusLogger] Stored reasoning locally: ${filePath}`);
    console.log(`[WalrusLogger] Local blob ID: ${localId} — will NOT have on-chain hash verification`);
    return localId;
  } catch (fsError) {
    console.error('[WalrusLogger] Local fallback also failed:', fsError);
    // Return a deterministic error ID so the agent can still record the trade
    return `error-${log.timestamp}`;
  }
}

/**
 * Retrieve a reasoning log from Walrus by blob ID.
 * Handles local fallback blobs transparently.
 */
export async function retrieveReasoning(blobId: string): Promise<ReasoningLog | null> {
  // Handle local fallback blobs
  if (blobId.startsWith('local-')) {
    return retrieveLocalReasoning(blobId);
  }

  // Skip error blobs
  if (blobId.startsWith('error-')) {
    console.warn(`[WalrusLogger] Skipping error blob: ${blobId}`);
    return null;
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`${config.walrusAggregatorUrl}/v1/blobs/${blobId}`, {
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new Error(`Walrus fetch failed: ${response.status}`);
      }

      const data = await response.json();
      return data as ReasoningLog;
    } catch (error) {
      if (attempt === 0) {
        console.warn(`[WalrusLogger] Fetch attempt 1 failed for ${blobId}, retrying...`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        console.error(`[WalrusLogger] Failed to retrieve blob ${blobId}:`, error);
        return null;
      }
    }
  }

  return null;
}

/**
 * Retrieve a reasoning log from local fallback storage.
 */
function retrieveLocalReasoning(localId: string): ReasoningLog | null {
  try {
    const filePath = path.join(LOCAL_FALLBACK_DIR, `${localId}.json`);
    if (!existsSync(filePath)) {
      console.warn(`[WalrusLogger] Local blob not found: ${localId}`);
      return null;
    }

    const { readFileSync } = require('fs');
    const data = readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as ReasoningLog;
  } catch (error) {
    console.error(`[WalrusLogger] Failed to read local blob ${localId}:`, error);
    return null;
  }
}
