import { config } from './config.js';
import { agentAddress } from './client.js';
import { readMarketState } from './market-reader.js';
import { readVaultState } from './vault-manager.js';
import { makeDecision } from './reasoner.js';
import { executeTrade, recordTradeOnChain } from './executor.js';
import { storeReasoning } from './walrus-logger.js';
import { REASONING_LOG_VERSION } from '@suisage/shared';
import type { TradeDecision, ReasoningLog } from '@suisage/shared';

const recentDecisions: TradeDecision[] = [];
let cycleCount = 0;

async function runCycle() {
  cycleCount++;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[SuiSage] Cycle #${cycleCount} starting at ${new Date().toISOString()}`);
  console.log(`${'='.repeat(60)}`);

  try {
    // Step 1: Read market state
    console.log('[1/6] Reading market state...');
    const market = await readMarketState();
    console.log(`  Mid price: $${market.midPrice.toFixed(4)} | Spread: ${market.spreadBps.toFixed(1)}bps`);

    // Step 2: Read vault state
    console.log('[2/6] Reading vault state...');
    const vault = await readVaultState();
    console.log(`  Balance: ${vault.balance} MIST | Deployed: ${vault.deployedAmount} MIST`);

    // Step 3: Call Claude for decision
    console.log('[3/6] Consulting Claude for trading decision...');
    const decision = await makeDecision(market, vault, recentDecisions);
    console.log(`  Action: ${decision.action} | Confidence: ${decision.confidence}%`);
    console.log(`  Reasoning: ${decision.reasoning.substring(0, 100)}...`);

    // Step 4: Execute trade if not HOLD
    console.log('[4/6] Executing trade...');
    const executionResult = await executeTrade(decision);
    console.log(`  Result: ${executionResult.success ? 'SUCCESS' : 'FAILED'}`);

    // Step 5: Store reasoning on Walrus
    console.log('[5/6] Storing reasoning on Walrus...');
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

    // Step 6: Record on-chain (only for non-HOLD actions)
    if (decision.action !== 'HOLD') {
      console.log('[6/6] Recording trade on-chain...');
      const txDigest = await recordTradeOnChain(decision, walrusBlobId, executionResult);
      if (txDigest) {
        console.log(`  On-chain tx: ${txDigest}`);
      }
    } else {
      console.log('[6/6] HOLD decision - skipping on-chain recording');
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
  console.log('');

  // Run first cycle immediately
  await runCycle();

  // Then run on interval
  setInterval(runCycle, config.loopIntervalMs);
}

main().catch(console.error);
