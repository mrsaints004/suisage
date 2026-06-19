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
      const rawBalance = fields.balance;
      const balance = typeof rawBalance === 'object' && rawBalance !== null && 'value' in (rawBalance as any)
        ? BigInt(String((rawBalance as any).value))
        : BigInt(String(rawBalance ?? '0'));
      const totalShares = BigInt(String(fields.total_shares ?? '0'));
      const deployed = BigInt(String(fields.deployed_amount ?? '0'));
      const paused = Boolean(fields.paused);

      const balanceSui = Number(balance) / Number(MIST_PER_SUI);
      const deployedSui = Number(deployed) / Number(MIST_PER_SUI);
      const totalSui = balanceSui + deployedSui;

      const totalProfit = Number(String(fields.total_profit ?? '0')) / Number(MIST_PER_SUI);
      const totalLoss = Number(String(fields.total_loss ?? '0')) / Number(MIST_PER_SUI);
      const performanceFeeBps = Number(String(fields.performance_fee_bps ?? '1000'));
      const rawFees = fields.accrued_fees;
      const accruedFees = typeof rawFees === 'object' && rawFees !== null && 'value' in (rawFees as any)
        ? Number(String((rawFees as any).value)) / Number(MIST_PER_SUI)
        : Number(String(rawFees ?? '0')) / Number(MIST_PER_SUI);

      const navPerShare = totalShares > 0n
        ? Number((balance + deployed) * 1_000_000_000n / totalShares) / 1e9
        : 1.0;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            vaultId: vaultObjectId,
            balanceSui: balanceSui.toFixed(4),
            deployedSui: deployedSui.toFixed(4),
            totalValueSui: totalSui.toFixed(4),
            totalShares: totalShares.toString(),
            navPerShare: navPerShare.toFixed(6),
            performanceFeePct: (performanceFeeBps / 100).toFixed(1) + '%',
            totalProfitSui: totalProfit.toFixed(4),
            totalLossSui: totalLoss.toFixed(4),
            netPnlSui: (totalProfit - totalLoss).toFixed(4),
            accruedFeesSui: accruedFees.toFixed(4),
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

        // Decode walrus blob ID
        let walrusBlobId = '';
        try {
          walrusBlobId = new TextDecoder().decode(
            new Uint8Array(fields.walrus_blob_id as number[]),
          );
        } catch { /* ignore decode errors */ }

        // Decode reasoning hash
        let reasoningHash = '';
        try {
          const hashBytes = fields.reasoning_hash as number[];
          if (Array.isArray(hashBytes)) {
            reasoningHash = hashBytes.map(b => b.toString(16).padStart(2, '0')).join('');
          }
        } catch { /* ignore */ }

        return {
          action: tradeTypes[Number(fields.trade_type)] || 'UNKNOWN',
          amount: String(fields.amount),
          price: String(fields.price),
          walrusBlobId,
          reasoningHash: reasoningHash || undefined,
          guardianApproved: fields.guardian_approved !== undefined ? Boolean(fields.guardian_approved) : undefined,
          confidence: fields.confidence !== undefined ? Number(fields.confidence) : undefined,
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

// Tool: get_agent_architecture
server.tool(
  'get_agent_architecture',
  'Explain how SuiSage works — its architecture, guardian risk layer, Walrus memory, and on-chain enforcement',
  {},
  async () => {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          overview: 'SuiSage is an autonomous AI trading agent on Sui with Move-enforced guardrails and verifiable reasoning. Trades SUI/USDC on DeepBook with dual-layer guardian (TypeScript + Move on-chain).',
          cycle: [
            '1. Read live orderbook from DeepBook (price, spread, depth)',
            '2. Read vault state including NAV, performance data, agent cap limits',
            '3. Load agent memory from Walrus (past decisions, performance, patterns)',
            '4. Claude AI analyzes market + memory and outputs a TradeDecision',
            '5. TypeScript guardian runs 8 risk checks (spread, depth, slippage, budget, cooldown, concentration, confidence, vault health)',
            '6. Store full reasoning on Walrus, compute SHA-256 hash',
            '7. Execute trade via atomic PTB — Move contract enforces 7 on-chain checks (budget, cooldown via Clock, concentration, deployment, active status)',
            '8. TradeRecordEvent emitted with Walrus blob ID + reasoning hash + guardian status',
          ],
          dualLayerGuardian: {
            typeScriptLayer: '8 pre-flight checks for fast feedback and detailed error messages',
            moveLayer: '7 on-chain checks (budget ceiling, cooldown via Clock, position concentration, deployment limit, agent/strategy/vault active) — cannot be bypassed even if agent code is forked',
          },
          reasoningVerification: {
            description: 'SHA-256 hash of reasoning JSON committed on-chain in TradeRecordEvent',
            flow: 'Agent computes hash → stores on-chain → anyone can fetch Walrus blob, re-hash, and verify match',
          },
          performanceFees: {
            description: 'ERC-4626 style vault with high-water mark NAV tracking',
            defaultFee: '10% of profits above high-water mark',
          },
          suiPrimitives: {
            moveObjects: 'AgentCap enforces budget ceiling at type level, AdminCap enables instant revocation',
            ptbs: 'Withdraw + trade + record in a single atomic Programmable Transaction Block',
            clock: 'sui::clock::Clock used for on-chain cooldown enforcement',
            walrus: 'Reasoning stored immutably with SHA-256 hash on-chain for verification',
            deepbook: 'Real limit orders on DeepBook central limit orderbook',
          },
          track: 'Agentic Web — Sub-track 2: Autonomous Agent Wallet',
          moveTests: '19 unit tests (10 vault, 9 agent auth)',
        }, null, 2),
      }],
    };
  },
);

// Tool: get_guardian_config
server.tool(
  'get_guardian_config',
  'Get the current guardian risk check configuration and thresholds',
  {},
  async () => {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          typeScriptChecks: {
            maxSpreadBps: 50,
            maxPositionPct: 30,
            minBidDepth: 100,
            minAskDepth: 100,
            maxSlippageBps: 100,
            minConfidence: 30,
            cooldownMs: 30000,
          },
          moveOnChainChecks: {
            EExceedsMaxTradeSize: 'Trade amount > AgentCap.max_trade_size',
            EExceedsDeploymentLimit: 'Total deployed > max_deployment_bps of vault',
            EPositionTooConcentrated: 'Trade > max_position_bps of vault value (StrategyConfig)',
            ECooldownNotMet: 'Clock time - last_trade_timestamp < min_trade_interval_sec',
            EAgentNotActive: 'AgentCap.active is false',
            EStrategyNotActive: 'StrategyConfig.active is false',
            EVaultPaused: 'Vault.paused is true',
          },
          description: 'DUAL-LAYER: TypeScript pre-flight checks for detailed feedback + Move on-chain enforcement that cannot be bypassed. Even a forked agent hitting the contract directly will be blocked by Move assertions.',
        }, null, 2),
      }],
    };
  },
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP] SuiSage MCP server running on stdio');
}

main().catch(console.error);
