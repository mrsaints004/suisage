import { config } from './config.js';
import { agentAddress } from './client.js';
import { readMarketState } from './market-reader.js';
import { readVaultState } from './vault-manager.js';
import { makeDecision } from './reasoner.js';
import {
  executeTrade,
  recordTradeOnChain,
  getDeepBookPosition,
} from './executor.js';
import { storeReasoning } from './walrus-logger.js';
import { startTelegramBot, notifyTrade, stopTelegramBot, updateTelegramCache } from './telegram.js';
import { REASONING_LOG_VERSION, MIST_PER_SUI } from '@suisage/shared';
import type { TradeDecision, ReasoningLog } from '@suisage/shared';

const recentDecisions: TradeDecision[] = [];
let cycleCount = 0;

async function runCycle() {
  cycleCount++;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[SuiSage] Cycle #${cycleCount} starting at ${new Date().toISOString()}`);
  console.log(`${'='.repeat(60)}`);

  try {
    // Step 1: Read market state from DeepBook
    console.log('[1/7] Reading market state from DeepBook...');
    const market = await readMarketState();
    console.log(`  Mid price: $${market.midPrice.toFixed(4)} | Spread: ${market.spreadBps.toFixed(1)}bps`);
    console.log(`  Bid depth: ${market.bidDepth.toFixed(2)} | Ask depth: ${market.askDepth.toFixed(2)}`);

    // Step 2: Read vault state
    console.log('[2/7] Reading vault state...');
    const vault = await readVaultState();
    const balanceSui = Number(vault.balance) / Number(MIST_PER_SUI);
    console.log(`  Balance: ${balanceSui.toFixed(4)} SUI | Deployed: ${vault.deployedAmount} MIST`);

    // Feed live data to Telegram bot cache
    updateTelegramCache(market, vault);

    // Step 3: Check DeepBook position
    console.log('[3/7] Checking DeepBook position...');
    try {
      const position = await getDeepBookPosition(config.deepbookPoolId);
      console.log(
        `  Available base: ${position.availableBaseAmount} | Available quote: ${position.availableQuoteAmount}`,
      );
    } catch (e) {
      console.warn('  Could not read DeepBook position (AccountCap may not be set)');
    }

    // Step 4: Call Claude for decision
    console.log('[4/7] Consulting Claude for trading decision...');
    const decision = await makeDecision(market, vault, recentDecisions);
    console.log(`  Action: ${decision.action} | Confidence: ${decision.confidence}%`);
    console.log(`  Reasoning: ${decision.reasoning.substring(0, 120)}...`);

    // Step 5: Execute trade on DeepBook if not HOLD
    let executionResult;
    if (decision.action !== 'HOLD') {
      console.log('[5/7] Executing trade on DeepBook...');
      executionResult = await executeTrade(decision, config.deepbookPoolId);
      console.log(
        `  Result: ${executionResult.success ? 'SUCCESS' : 'FAILED'}${executionResult.txDigest ? ` (tx: ${executionResult.txDigest})` : ''}`,
      );
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

    // Step 7: Record on-chain with Walrus reference
    let txDigest: string | undefined;
    if (decision.action !== 'HOLD') {
      console.log('[7/7] Recording trade on-chain with Walrus reference...');
      const digest = await recordTradeOnChain(decision, walrusBlobId, executionResult);
      txDigest = digest ?? undefined;
      if (txDigest) {
        console.log(`  On-chain tx: ${txDigest}`);
      }
    } else {
      console.log('[7/7] HOLD decision - skipping on-chain recording');
    }

    // Notify via Telegram
    await notifyTrade(decision, walrusBlobId, txDigest);

    // Track recent decisions
    recentDecisions.push(decision);
    if (recentDecisions.length > 10) recentDecisions.shift();

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
  console.log(`Network: ${config.suiNetwork}`);
  console.log(`DeepBook pool: ${config.deepbookPoolId}`);
  console.log(`Loop interval: ${config.loopIntervalMs}ms`);
  console.log('');

  // Start Telegram bot
  await startTelegramBot();

  // Run first cycle immediately
  await runCycle();

  // Then run on interval
  setInterval(runCycle, config.loopIntervalMs);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[SuiSage] Shutting down...');
    stopTelegramBot();
    process.exit(0);
  });
}

main().catch(console.error);
