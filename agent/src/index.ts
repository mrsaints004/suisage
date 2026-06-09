import { config } from './config.js';
import { agentAddress } from './client.js';
import { readMarketState } from './market-reader.js';
import { readVaultState, readAgentCapState, readStrategyConfig } from './vault-manager.js';
import { makeDecision } from './reasoner.js';
import {
  executeTrade,
  executeAtomicTradePTB,
  executeVaultTradePTB,
  returnFundsToVault,
  recordTradeOnChain,
  getDeepBookPosition,
  computeReasoningHash,
} from './executor.js';
import type { VaultIds } from './executor.js';
import { storeReasoning } from './walrus-logger.js';
import { loadMemory, addToMemory, formatMemoryForPrompt } from './memory-manager.js';
import { runGuardianChecks, recordTradeExecution, validateOnChain, formatGuardianReport } from './guardian.js';
import { isPredictEnabled, getAvailableMarkets, formatPredictStatus } from './predict.js';
import { startTelegramBot, notifyTrade, stopTelegramBot, updateTelegramCache } from './telegram.js';
import {
  initMemWal,
  isMemWalEnabled,
  rememberTrade,
  rememberPattern,
  shareWithAgents,
  buildMemWalContext,
} from './memwal-client.js';
import { initSeal, isSealEnabled, getSealStatus } from './seal-client.js';
import { discoverManagedVaults } from './vault-discovery.js';
import { REASONING_LOG_VERSION, MIST_PER_SUI } from '@suisage/shared';
import type { TradeDecision, ReasoningLog, GuardianCheck, OnChainConfig, ManagedVault } from '@suisage/shared';

const recentDecisionsMap = new Map<string, TradeDecision[]>();

function getRecentDecisions(vaultId: string): TradeDecision[] {
  if (!recentDecisionsMap.has(vaultId)) {
    recentDecisionsMap.set(vaultId, []);
  }
  return recentDecisionsMap.get(vaultId)!;
}
let cycleCount = 0;
let managedVaults: ManagedVault[] = [];
let lastDiscoveryTime = 0;

/**
 * Run a trading cycle for a single vault.
 */
async function runVaultCycle(vault_info: ManagedVault, vaultIndex: number, totalVaults: number) {
  const vaultLabel = `[Vault ${vaultIndex + 1}/${totalVaults} ${vault_info.vaultId.slice(0, 12)}...]`;
  const vaultIds: VaultIds = {
    vaultObjectId: vault_info.vaultId,
    agentCapId: vault_info.agentCapId,
    strategyConfigId: vault_info.strategyConfigId || undefined,
  };

  try {
    // Step 1: Read market state from DeepBook
    console.log(`${vaultLabel} [1/9] Reading market state from DeepBook...`);
    const market = await readMarketState();
    console.log(`  Mid price: $${market.midPrice.toFixed(4)} | Spread: ${market.spreadBps.toFixed(1)}bps`);
    console.log(`  Bid depth: ${market.bidDepth.toFixed(2)} | Ask depth: ${market.askDepth.toFixed(2)}`);

    // Step 2: Read vault state + on-chain config
    console.log(`${vaultLabel} [2/9] Reading vault state + on-chain config...`);
    const vaultState = await readVaultState(vault_info.vaultId);
    const balanceSui = Number(vaultState.balance) / Number(MIST_PER_SUI);
    console.log(`  Balance: ${balanceSui.toFixed(4)} SUI | Deployed: ${vaultState.deployedAmount} MIST`);

    // Read on-chain AgentCap and StrategyConfig (used by guardian for limits)
    const onChainConfig: OnChainConfig = {};
    const agentCapState = await readAgentCapState(vault_info.agentCapId);
    if (agentCapState) {
      onChainConfig.agentCap = agentCapState;
      console.log(`  AgentCap: maxTrade=${Number(agentCapState.maxTradeSize) / 1e9} SUI, active=${agentCapState.active}, trades=${agentCapState.totalTrades}, vol=${agentCapState.totalVolume}`);
    } else {
      console.warn('  AgentCap: could not read (using config fallbacks)');
    }

    if (vault_info.strategyConfigId) {
      const strategyState = await readStrategyConfig(vault_info.strategyConfigId);
      if (strategyState) {
        onChainConfig.strategyConfig = strategyState;
        console.log(`  StrategyConfig: maxPos=${strategyState.maxPositionBps}bps, stopLoss=${strategyState.stopLossBps}bps, cooldown=${strategyState.minTradeIntervalSec}s, active=${strategyState.active}`);
      } else {
        console.warn('  StrategyConfig: could not read (using guardian defaults)');
      }
    }

    // Feed live data to Telegram bot cache
    updateTelegramCache(market, vaultState);

    // Step 3: Check DeepBook position
    console.log(`${vaultLabel} [3/9] Checking DeepBook position...`);
    try {
      const position = await getDeepBookPosition(config.deepbookPoolId);
      console.log(
        `  Available base: ${position.availableBaseAmount} | Available quote: ${position.availableQuoteAmount}`,
      );
    } catch (e) {
      console.warn('  Could not read DeepBook position (AccountCap may not be set)');
    }

    // Step 4: Load memory from Walrus + MemWal
    console.log(`${vaultLabel} [4/9] Loading agent memory from Walrus + MemWal...`);
    const memory = await loadMemory();
    console.log(`  Memory: ${memory.recentDecisions.length} past decisions | Win rate: ${(memory.performance.winRate * 100).toFixed(0)}%`);
    if (memory.patterns.length > 0) {
      console.log(`  Patterns: ${memory.patterns.slice(0, 2).join(' | ')}`);
    }

    // MemWal: Build persistent memory context (semantic recall from Walrus-backed memory)
    let memwalContext = '';
    if (isMemWalEnabled()) {
      const marketCondition = memory.recentDecisions.length > 0
        ? memory.recentDecisions[memory.recentDecisions.length - 1].marketCondition
        : 'UNKNOWN';
      memwalContext = await buildMemWalContext(market.midPrice, market.spreadBps, marketCondition);
      console.log('  MemWal: Persistent memory loaded (semantic recall active)');
    }

    // Step 5: Call Claude for decision (with memory + MemWal context)
    console.log(`${vaultLabel} [5/9] Consulting Claude for trading decision (with Walrus + MemWal memory)...`);
    const recentDecisions = getRecentDecisions(vault_info.vaultId);
    const decision = await makeDecision(market, vaultState, recentDecisions, memory, memwalContext);
    console.log(`  Action: ${decision.action} | Confidence: ${decision.confidence}%`);
    console.log(`  Reasoning: ${decision.reasoning.substring(0, 120)}...`);

    // Step 6: Guardian risk validation (TypeScript layer — on-chain enforcement happens in PTB)
    console.log(`${vaultLabel} [6/9] Running Guardian risk checks (off-chain + on-chain enforced)...`);
    const guardianCheck = runGuardianChecks(decision, market, vaultState, onChainConfig);
    console.log(formatGuardianReport(guardianCheck));

    // Also validate on-chain if trading (pass per-vault IDs)
    if (decision.action !== 'HOLD' && guardianCheck.approved) {
      const onChainCheck = await validateOnChain(decision, vault_info.agentCapId, vault_info.vaultId);
      if (!onChainCheck.valid) {
        console.log(`  On-chain validation FAILED: ${onChainCheck.error}`);
        guardianCheck.approved = false;
        guardianCheck.overallReason += ` On-chain: ${onChainCheck.error}`;
      }
    }

    // Step 7: Store reasoning on Walrus (BEFORE executing — for atomic PTB)
    console.log(`${vaultLabel} [7/9] Storing reasoning on Walrus...`);
    const reasoningLog: ReasoningLog = {
      version: REASONING_LOG_VERSION,
      agentId: agentAddress,
      timestamp: Date.now(),
      marketSnapshot: market,
      vaultState: {
        balance: vaultState.balance.toString(),
        deployed: vaultState.deployedAmount.toString(),
        totalShares: vaultState.totalShares.toString(),
        totalValue: vaultState.totalValue.toString(),
      },
      decision,
      guardianCheck,
      memoryContext: {
        recentTradeCount: memory.recentDecisions.length,
        winRate: memory.performance.winRate,
        patterns: memory.patterns,
        lastAction: memory.recentDecisions.length > 0
          ? memory.recentDecisions[memory.recentDecisions.length - 1].action
          : null,
      },
      executionResult: undefined, // filled after execution
    };

    let walrusBlobId: string;
    try {
      walrusBlobId = await storeReasoning(reasoningLog);
      console.log(`  Walrus blob ID: ${walrusBlobId}`);
    } catch (walrusError) {
      console.error(`${vaultLabel} Walrus storage failed — skipping trade (no verifiable reasoning):`, walrusError);
      return;
    }

    // Compute reasoning hash for on-chain verification
    const reasoningJson = JSON.stringify(reasoningLog, null, 2);
    const reasoningHash = computeReasoningHash(reasoningJson);
    console.log(`  Reasoning hash (SHA-256): ${Buffer.from(reasoningHash).toString('hex').slice(0, 16)}...`);

    // Step 8: Execute trade on DeepBook (if approved by guardian)
    let executionResult;
    let txDigest: string | undefined;

    if (decision.action !== 'HOLD' && guardianCheck.approved) {
      console.log(`${vaultLabel} [8/9] Executing vault-funded PTB: withdraw(+on-chain guardian) -> trade -> record...`);

      // Use vault-funded PTB (withdraw from vault → deposit to DeepBook → trade → record)
      // The withdraw_for_trading call now enforces Guardian checks ON-CHAIN via Move
      executionResult = await executeVaultTradePTB(
        decision,
        config.deepbookPoolId,
        walrusBlobId,
        reasoningHash,
        guardianCheck.approved,
        vaultIds,
      );

      txDigest = executionResult.txDigest;
      recordTradeExecution();

      // After IOC trades, return remaining funds to vault
      if (executionResult.success && decision.orderType === 'MARKET') {
        try {
          const filledMist = BigInt(Math.floor((executionResult.filledQuantity ?? 0) * Number(MIST_PER_SUI)));
          const requestedMist = BigInt(Math.floor(decision.quantity * Number(MIST_PER_SUI)));
          const remainingMist = requestedMist - filledMist;
          if (remainingMist > 0n) {
            console.log(`${vaultLabel} [8b/9] Returning ${remainingMist} MIST unfilled funds to vault...`);
            await returnFundsToVault(config.deepbookPoolId, remainingMist, vaultIds);
          }
        } catch (returnError) {
          console.warn(`${vaultLabel} Failed to return unfilled funds to vault:`, returnError);
        }
      }

      console.log(
        `  Result: ${executionResult.success ? 'SUCCESS' : 'FAILED'}${txDigest ? ` (tx: ${txDigest})` : ''}`,
      );

      // Add to local memory
      addToMemory({
        blobId: walrusBlobId,
        timestamp: Date.now(),
        action: decision.action,
        price: decision.price,
        quantity: decision.quantity,
        confidence: decision.confidence,
        marketCondition: decision.marketCondition,
        outcome: 'PENDING',
      });

      // MemWal: Remember trade decision persistently (encrypted, on Walrus)
      if (isMemWalEnabled()) {
        await rememberTrade(
          decision.action,
          decision.quantity,
          decision.price,
          decision.confidence,
          decision.reasoning,
          decision.marketCondition,
          executionResult.success ? 'EXECUTED' : 'FAILED',
        );

        // Share notable trades with other SuiSage agents
        if (decision.confidence >= 70) {
          await shareWithAgents(
            `High-confidence ${decision.action} at $${decision.price.toFixed(4)} ` +
            `(${decision.confidence}% confidence). Market: ${decision.marketCondition}. ` +
            `Spread: ${market.spreadBps.toFixed(1)}bps. ` +
            `Result: ${executionResult.success ? 'SUCCESS' : 'FAILED'}`,
          );
        }
      }
    } else if (decision.action !== 'HOLD' && !guardianCheck.approved) {
      console.log(`${vaultLabel} [8/9] BLOCKED by Guardian — trade not executed`);
      executionResult = {
        success: false,
        error: `Guardian blocked: ${guardianCheck.overallReason}`,
      };

      // Still record the BLOCKED decision on-chain for transparency
      console.log(`${vaultLabel} [8b/9] Recording blocked decision on-chain (with reasoning hash)...`);
      txDigest = (await recordTradeOnChain(decision, walrusBlobId, reasoningHash, executionResult, false, vaultIds)) ?? undefined;
    } else {
      console.log(`${vaultLabel} [8/9] HOLD - no trade needed`);
      executionResult = { success: true, filledQuantity: 0, filledPrice: 0 };
    }

    // Step 9: DeepBook Predict status (if configured)
    if (isPredictEnabled()) {
      console.log(`${vaultLabel} [9/9] Checking DeepBook Predict markets (testnet)...`);
      const markets = await getAvailableMarkets();
      console.log(formatPredictStatus(markets, []));
    } else {
      console.log(`${vaultLabel} [9/9] DeepBook Predict not configured (optional testnet feature)`);
    }

    // Notify via Telegram
    await notifyTrade(decision, walrusBlobId, txDigest);

    // Track recent decisions
    recentDecisions.push(decision);
    if (recentDecisions.length > 10) recentDecisions.shift();

    console.log(`${vaultLabel} Cycle complete.`);
  } catch (error) {
    console.error(`${vaultLabel} Cycle error:`, error);
  }
}

async function runCycle() {
  cycleCount++;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[SuiSage] Cycle #${cycleCount} starting at ${new Date().toISOString()}`);
  console.log(`${'='.repeat(60)}`);

  // Refresh vault discovery periodically
  const now = Date.now();
  if (now - lastDiscoveryTime > config.discoveryRefreshMs) {
    console.log('[SuiSage] Refreshing vault discovery...');
    try {
      managedVaults = await discoverManagedVaults();
      lastDiscoveryTime = now;
    } catch (error) {
      console.error('[SuiSage] Discovery refresh failed:', error);
    }
  }

  if (managedVaults.length === 0) {
    console.log('[SuiSage] No managed vaults found. Waiting for new AgentCap assignments...');
    return;
  }

  console.log(`[SuiSage] Running cycle for ${managedVaults.length} vault(s) (sequential)...`);

  // Run each vault cycle sequentially to avoid nonce conflicts
  for (let i = 0; i < managedVaults.length; i++) {
    await runVaultCycle(managedVaults[i], i, managedVaults.length);
  }

  console.log(`\n[SuiSage] Cycle #${cycleCount} complete (${managedVaults.length} vaults).`);
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║           SuiSage Trading Agent v4.0                    ║');
  console.log('║   Autonomous DeFi with Verifiable AI Reasoning          ║');
  console.log('║                                                         ║');
  console.log('║   Multi-Vault | On-Chain Guardian | Auto-Discovery      ║');
  console.log('║   Memory: Walrus+MemWal  Guard: Move-Enforced          ║');
  console.log('║   Trade: DeepBook  Privacy: Seal  Chat: Telegram       ║');
  console.log('║   Verification: SHA-256 reasoning hash on-chain        ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`Agent: ${agentAddress}`);
  console.log(`Network: ${config.suiNetwork}`);
  console.log(`DeepBook pool: ${config.deepbookPoolId}`);
  console.log(`Loop interval: ${config.loopIntervalMs}ms`);
  console.log(`Max trade: ${config.maxTradeSizeSui} SUI`);
  console.log(`Discovery refresh: ${config.discoveryRefreshMs}ms`);
  console.log(`Predict: ${isPredictEnabled() ? 'ENABLED (testnet)' : 'not configured'}`);

  // Initialize MemWal (persistent, encrypted agent memory on Walrus)
  const memwalReady = await initMemWal();
  console.log(`MemWal: ${memwalReady ? 'CONNECTED (persistent memory active)' : 'not configured'}`);

  // Initialize Seal (encrypted reasoning)
  const sealReady = await initSeal();
  const sealStatus = getSealStatus();
  console.log(`Seal: ${sealReady ? 'ENABLED (encrypted reasoning)' : 'not configured'}`);
  console.log('');

  // Discover managed vaults at startup
  console.log('[SuiSage] Discovering managed vaults...');
  try {
    managedVaults = await discoverManagedVaults();
    lastDiscoveryTime = Date.now();
  } catch (error) {
    console.error('[SuiSage] Initial vault discovery failed:', error);
  }

  // Fallback: if env vars specify a single vault and discovery found nothing, use them
  if (managedVaults.length === 0 && config.vaultObjectId && config.agentCapId) {
    console.log('[SuiSage] No vaults discovered, falling back to env var single-vault config');
    managedVaults = [{
      vaultId: config.vaultObjectId,
      agentCapId: config.agentCapId,
      strategyConfigId: config.strategyConfigId || null,
    }];
  }

  console.log(`[SuiSage] Managing ${managedVaults.length} vault(s)`);

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
