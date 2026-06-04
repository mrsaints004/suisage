import { config } from './config.js';
import { agentAddress } from './client.js';
import { readMarketState } from './market-reader.js';
import { readVaultState } from './vault-manager.js';
import { makeDecision } from './reasoner.js';
import {
  executeTrade,
  recordTradeOnChain,
  getDeepBookPosition,
  depositToDeepBook,
} from './executor.js';
import { storeReasoning } from './walrus-logger.js';
import { REASONING_LOG_VERSION, MIST_PER_SUI } from '@suisage/shared';
import type { TradeDecision, ReasoningLog } from '@suisage/shared';

const recentDecisions: TradeDecision[] = [];
let cycleCount = 0;
let tradingPoolId: string | null = null;

async function runCycle() {
  cycleCount++;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[SuiSage] Cycle #${cycleCount} starting at ${new Date().toISOString()}`);
  console.log(`${'='.repeat(60)}`);

  try {
    // Step 1: Read market state (also resolves pool ID)
    console.log('[1/7] Reading market state from DeepBook...');
    const market = await readMarketState();
    console.log(`  Pool: ${market.pool}`);
    console.log(`  Mid price: $${market.midPrice.toFixed(4)} | Spread: ${market.spreadBps.toFixed(1)}bps`);
    console.log(`  Bid depth: ${market.bidDepth.toFixed(2)} | Ask depth: ${market.askDepth.toFixed(2)}`);

    // Cache pool ID for executor
    if (market.pool !== 'simulated') {
      tradingPoolId = market.pool;
    }

    // Step 2: Read vault state
    console.log('[2/7] Reading vault state...');
    const vault = await readVaultState();
    const balanceSui = Number(vault.balance) / Number(MIST_PER_SUI);
    console.log(`  Balance: ${balanceSui.toFixed(4)} SUI | Deployed: ${vault.deployedAmount} MIST`);

    // Step 3: Check DeepBook position (if pool is real)
    if (tradingPoolId) {
      console.log('[3/7] Checking DeepBook position...');
      try {
        const position = await getDeepBookPosition(tradingPoolId);
        console.log(
          `  Available base: ${position.availableBaseAmount} | Available quote: ${position.availableQuoteAmount}`,
        );
      } catch (e) {
        console.warn('  Could not read DeepBook position (AccountCap may not be set)');
      }
    } else {
      console.log('[3/7] No live pool - skipping DeepBook position check');
    }

    // Step 4: Call Claude for decision
    console.log('[4/7] Consulting Claude for trading decision...');
    const decision = await makeDecision(market, vault, recentDecisions);
    console.log(`  Action: ${decision.action} | Confidence: ${decision.confidence}%`);
    console.log(`  Reasoning: ${decision.reasoning.substring(0, 120)}...`);

    // Step 5: Execute trade on DeepBook if not HOLD
    let executionResult;
    if (decision.action !== 'HOLD' && tradingPoolId) {
      console.log('[5/7] Executing trade on DeepBook...');
      executionResult = await executeTrade(decision, tradingPoolId);
      console.log(
        `  Result: ${executionResult.success ? 'SUCCESS' : 'FAILED'}${executionResult.txDigest ? ` (tx: ${executionResult.txDigest})` : ''}`,
      );
    } else if (decision.action !== 'HOLD') {
      console.log('[5/7] No live pool - trade simulated');
      executionResult = { success: true, filledQuantity: decision.quantity, filledPrice: decision.price };
    } else {
      console.log('[5/7] HOLD - no trade needed');
      executionResult = { success: true, filledQuantity: 0, filledPrice: 0 };
    }

    // Step 6: Store reasoning on Walrus
    console.log('[6/7] Storing reasoning on Walrus...');
    const reasoningLog: ReasoningLog = {
      version: REASONING_LOG_VERSION,
      agentId: agentAddress,
      timestamp: Date.now(),
      marketSnapshot: market,
      vaultState: {
        balance: vault.balance.toString(),
        deployed: vault.deployedAmount.toString(),
        totalShares: vault.totalShares.toString(),
        totalValue: vault.totalValue.toString(),
      },
      decision,
      executionResult,
    };

    const walrusBlobId = await storeReasoning(reasoningLog);
    console.log(`  Walrus blob ID: ${walrusBlobId}`);

    // Step 7: Record on-chain (only for non-HOLD actions)
    if (decision.action !== 'HOLD') {
      console.log('[7/7] Recording trade on-chain with Walrus reference...');
      const txDigest = await recordTradeOnChain(decision, walrusBlobId, executionResult);
      if (txDigest) {
        console.log(`  On-chain tx: ${txDigest}`);
      }
    } else {
      console.log('[7/7] HOLD decision - skipping on-chain recording');
    }

    // Track recent decisions
    recentDecisions.push(decision);
    if (recentDecisions.length > 10) {
      recentDecisions.shift();
    }

    console.log(`\n[SuiSage] Cycle #${cycleCount} complete.`);
  } catch (error) {
    console.error(`[SuiSage] Cycle #${cycleCount} error:`, error);
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║         SuiSage Trading Agent            ║');
  console.log('║   Autonomous DeFi with Verifiable AI     ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`Agent: ${agentAddress}`);
  console.log(`Loop interval: ${config.loopIntervalMs}ms`);
  console.log(`Network: ${config.suiNetwork}`);
  console.log(`DeepBook pool: ${config.deepbookPoolId || '(auto-discover)'}`);
  console.log(`AccountCap: ${config.accountCapId || '(will create on first trade)'}`);
  console.log('');

  // Run first cycle immediately
  await runCycle();

  // Then run on interval
  setInterval(runCycle, config.loopIntervalMs);
}

main().catch(console.error);
