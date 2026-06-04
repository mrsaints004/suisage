import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  MIST_PER_SUI,
  WALRUS_AGGREGATOR_URL,
  DEEPBOOK_SUI_USDC_POOL,
  FLOAT_SCALING_FACTOR,
} from '@suisage/shared';
import type { ReasoningLog } from '@suisage/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const network = (process.env.SUI_NETWORK || 'mainnet') as 'testnet' | 'mainnet';
const rpcUrl = process.env.SUI_RPC_URL || getFullnodeUrl(network);
const suiClient = new SuiClient({ url: rpcUrl });

const vaultPackageId = process.env.VAULT_PACKAGE_ID || '';
const vaultObjectId = process.env.VAULT_OBJECT_ID || '';
const walrusAggregator = process.env.WALRUS_AGGREGATOR_URL || WALRUS_AGGREGATOR_URL;
const poolId = process.env.DEEPBOOK_POOL_ID || DEEPBOOK_SUI_USDC_POOL;

// Create the MCP server
const server = new McpServer({
  name: 'suisage',
  version: '1.0.0',
});

// Tool: get_vault_state
server.tool(
  'get_vault_state',
  'Get the current state of the SuiSage vault including balance, shares, and deployed amount',
  {},
  async () => {
    if (!vaultObjectId) {
      return { content: [{ type: 'text', text: 'VAULT_OBJECT_ID not configured' }] };
    }

    try {
      const obj = await suiClient.getObject({
        id: vaultObjectId,
        options: { showContent: true },
      });

      if (!obj.data?.content || obj.data.content.dataType !== 'moveObject') {
        return { content: [{ type: 'text', text: 'Could not read vault object' }] };
      }

      const fields = obj.data.content.fields as Record<string, unknown>;
      const balance = BigInt(String(fields.balance ?? '0'));
      const totalShares = BigInt(String(fields.total_shares ?? '0'));
      const deployed = BigInt(String(fields.deployed_amount ?? '0'));
      const paused = Boolean(fields.paused);

      const balanceSui = Number(balance) / Number(MIST_PER_SUI);
      const deployedSui = Number(deployed) / Number(MIST_PER_SUI);
      const totalSui = balanceSui + deployedSui;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            vaultId: vaultObjectId,
            balanceSui: balanceSui.toFixed(4),
            deployedSui: deployedSui.toFixed(4),
            totalValueSui: totalSui.toFixed(4),
            totalShares: totalShares.toString(),
            paused,
            network,
          }, null, 2),
        }],
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }] };
    }
  },
);

// Tool: get_market_state
server.tool(
  'get_market_state',
  'Get current DeepBook orderbook state for the SUI/wUSDC pool including mid price, spread, and depth',
  {},
  async () => {
    try {
      // Import DeepBook client dynamically
      const { DeepBookClient } = await import('@mysten/deepbook');
      const dbClient = new DeepBookClient(suiClient);

      const marketPrice = await dbClient.getMarketPrice(poolId);

      const bestBid = marketPrice.bestBidPrice
        ? Number(marketPrice.bestBidPrice) / Number(FLOAT_SCALING_FACTOR)
        : null;
      const bestAsk = marketPrice.bestAskPrice
        ? Number(marketPrice.bestAskPrice) / Number(FLOAT_SCALING_FACTOR)
        : null;

      const midPrice = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk || 0;
      const spread = bestBid && bestAsk ? bestAsk - bestBid : 0;
      const spreadBps = midPrice > 0 ? (spread / midPrice) * 10000 : 0;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            pool: poolId,
            pair: 'SUI/wUSDC',
            midPrice: midPrice.toFixed(4),
            bestBid: bestBid?.toFixed(4) ?? 'N/A',
            bestAsk: bestAsk?.toFixed(4) ?? 'N/A',
            spreadBps: spreadBps.toFixed(1),
            network,
          }, null, 2),
        }],
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }] };
    }
  },
);

// Tool: get_reasoning
server.tool(
  'get_reasoning',
  'Fetch a full reasoning log from Walrus by blob ID. Returns the AI agent decision, market snapshot, and risk assessment.',
  { blob_id: z.string().describe('The Walrus blob ID to fetch') },
  async ({ blob_id }) => {
    try {
      const response = await fetch(`${walrusAggregator}/v1/blobs/${blob_id}`);
      if (!response.ok) {
        return { content: [{ type: 'text', text: `Walrus fetch failed: ${response.status}` }] };
      }

      const log = (await response.json()) as ReasoningLog;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            action: log.decision.action,
            quantity: log.decision.quantity,
            price: log.decision.price,
            confidence: log.decision.confidence,
            marketCondition: log.decision.marketCondition,
            reasoning: log.decision.reasoning,
            riskAssessment: log.decision.riskAssessment,
            marketSnapshot: {
              midPrice: log.marketSnapshot.midPrice,
              spreadBps: log.marketSnapshot.spreadBps,
              bidDepth: log.marketSnapshot.bidDepth,
              askDepth: log.marketSnapshot.askDepth,
            },
            vaultState: log.vaultState,
            timestamp: new Date(log.timestamp).toISOString(),
            executionResult: log.executionResult,
          }, null, 2),
        }],
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }] };
    }
  },
);

// Tool: get_recent_trades
server.tool(
  'get_recent_trades',
  'Get recent trade events from the SuiSage vault on-chain, including Walrus blob IDs for each decision',
  { limit: z.number().optional().default(10).describe('Number of recent trades to fetch') },
  async ({ limit }) => {
    if (!vaultPackageId) {
      return { content: [{ type: 'text', text: 'VAULT_PACKAGE_ID not configured' }] };
    }

    try {
      const events = await suiClient.queryEvents({
        query: {
          MoveEventType: `${vaultPackageId}::agent_auth::TradeRecordEvent`,
        },
        limit,
        order: 'descending',
      });

      const trades = events.data.map((ev) => {
        const fields = ev.parsedJson as Record<string, unknown>;
        const tradeTypes = ['BUY', 'SELL', 'REBALANCE'];
        return {
          action: tradeTypes[Number(fields.trade_type)] || 'UNKNOWN',
          amount: String(fields.amount),
          price: String(fields.price),
          walrusBlobId: new TextDecoder().decode(
            new Uint8Array(fields.walrus_blob_id as number[]),
          ),
          timestamp: new Date(Number(fields.timestamp_ms)).toISOString(),
          txDigest: ev.id.txDigest,
        };
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ trades, count: trades.length }, null, 2),
        }],
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }] };
    }
  },
);

// Tool: get_deposit_events
server.tool(
  'get_deposit_events',
  'Get recent deposit and withdraw events from the vault',
  { limit: z.number().optional().default(10).describe('Number of events to fetch') },
  async ({ limit }) => {
    if (!vaultPackageId) {
      return { content: [{ type: 'text', text: 'VAULT_PACKAGE_ID not configured' }] };
    }

    try {
      const events = await suiClient.queryEvents({
        query: {
          MoveModule: {
            package: vaultPackageId,
            module: 'vault',
          },
        },
        limit,
        order: 'descending',
      });

      const parsed = events.data.map((ev) => ({
        type: ev.type.includes('Deposit') ? 'DEPOSIT' : 'WITHDRAW',
        fields: ev.parsedJson,
        timestamp: ev.timestampMs,
        txDigest: ev.id.txDigest,
      }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ events: parsed, count: parsed.length }, null, 2),
        }],
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }] };
    }
  },
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP] SuiSage MCP server running on stdio');
}

main().catch(console.error);
