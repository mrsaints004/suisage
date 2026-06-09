'use client';

import { useState, useEffect } from 'react';
import { useSuiClient } from '@mysten/dapp-kit';
import { Tooltip } from '../components/Tooltip';
import type { ReasoningLog, TradeAction } from '@suisage/shared';

const VAULT_PACKAGE_ID = process.env.NEXT_PUBLIC_VAULT_PACKAGE_ID || '';
const WALRUS_AGGREGATOR_URL = process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL || 'https://aggregator.walrus-testnet.walrus.space';
const SUI_NETWORK = process.env.NEXT_PUBLIC_SUI_NETWORK || 'mainnet';

interface TradeRecord {
  tradeType: number;
  amount: string;
  price: string;
  walrusBlobId: string;
  reasoningHash: string;
  timestampMs: string;
  txDigest: string;
  guardianApproved: boolean;
  confidence: number;
}

const ACTION_COLORS: Record<string, string> = {
  BUY: 'border-green-500 bg-green-500/10',
  SELL: 'border-red-500 bg-red-500/10',
  HOLD: 'border-gray-500 bg-gray-500/10',
  REBALANCE: 'border-blue-500 bg-blue-500/10',
};

const ACTION_DOT_COLORS: Record<string, string> = {
  BUY: 'bg-green-500',
  SELL: 'bg-red-500',
  HOLD: 'bg-gray-500',
  REBALANCE: 'bg-blue-500',
};

const TRADE_TYPE_MAP: Record<number, TradeAction> = {
  0: 'BUY',
  1: 'SELL',
  2: 'REBALANCE',
};

export default function ReasoningPage() {
  const suiClient = useSuiClient();
  const [records, setRecords] = useState<TradeRecord[]>([]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [reasoningData, setReasoningData] = useState<Record<string, ReasoningLog>>({});
  const [loadingReasoning, setLoadingReasoning] = useState<string | null>(null);
  const [hashVerification, setHashVerification] = useState<Record<string, 'verified' | 'mismatch' | 'pending'>>({});
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);

  // Fetch trade events from chain
  useEffect(() => {
    async function fetchTradeEvents() {
      if (!VAULT_PACKAGE_ID) {
        setRecords(getSampleRecords());
        setIsDemo(true);
        setLoading(false);
        return;
      }

      try {
        const events = await suiClient.queryEvents({
          query: {
            MoveEventType: `${VAULT_PACKAGE_ID}::agent_auth::TradeRecordEvent`,
          },
          limit: 50,
          order: 'descending',
        });

        const parsed: TradeRecord[] = events.data.map((ev) => {
          const fields = ev.parsedJson as Record<string, unknown>;
          return {
            tradeType: Number(fields.trade_type),
            amount: String(fields.amount),
            price: String(fields.price),
            walrusBlobId: decodeBytes(fields.walrus_blob_id as number[]),
            reasoningHash: bytesToHex(fields.reasoning_hash as number[]),
            timestampMs: String(fields.timestamp_ms),
            txDigest: ev.id.txDigest,
            guardianApproved: Boolean(fields.guardian_approved),
            confidence: Number(fields.confidence ?? 0),
          };
        });

        if (parsed.length === 0) {
          setRecords(getSampleRecords());
          setIsDemo(true);
        } else {
          setRecords(parsed);
        }
      } catch (error) {
        console.error('Error fetching events:', error);
        setRecords(getSampleRecords());
        setIsDemo(true);
      }
      setLoading(false);
    }

    fetchTradeEvents();
  }, [suiClient]);

  // Verify reasoning hash against Walrus blob
  async function verifyReasoningHash(blobId: string, expectedHash: string) {
    if (!expectedHash || blobId.startsWith('sample-')) return;

    try {
      const res = await fetch(`${WALRUS_AGGREGATOR_URL}/v1/blobs/${blobId}`);
      if (!res.ok) return;

      const text = await res.text();
      // Compute SHA-256 of the blob content
      const encoder = new TextEncoder();
      const data = encoder.encode(text);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const computedHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      setHashVerification((prev) => ({
        ...prev,
        [blobId]: computedHash === expectedHash ? 'verified' : 'mismatch',
      }));
    } catch {
      // Leave as pending
    }
  }

  // Fetch reasoning from Walrus when a card is expanded
  async function loadReasoning(blobId: string, reasoningHash: string) {
    if (reasoningData[blobId]) {
      // Already loaded, just verify hash if not done
      if (!hashVerification[blobId]) {
        verifyReasoningHash(blobId, reasoningHash);
      }
      return;
    }
    if (blobId.startsWith('sample-')) {
      setReasoningData((prev) => ({
        ...prev,
        [blobId]: getSampleReasoning(blobId),
      }));
      return;
    }

    setLoadingReasoning(blobId);
    try {
      const res = await fetch(`${WALRUS_AGGREGATOR_URL}/v1/blobs/${blobId}`);
      if (res.ok) {
        const data = await res.json();
        setReasoningData((prev) => ({ ...prev, [blobId]: data as ReasoningLog }));
        // Verify hash
        verifyReasoningHash(blobId, reasoningHash);
      }
    } catch (error) {
      console.error('Error fetching reasoning:', error);
    }
    setLoadingReasoning(null);
  }

  function handleExpand(index: number, record: TradeRecord) {
    if (expandedIndex === index) {
      setExpandedIndex(null);
    } else {
      setExpandedIndex(index);
      loadReasoning(record.walrusBlobId, record.reasoningHash);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Reasoning Timeline</h1>
        <p className="text-gray-400 mt-2">
          Every decision is stored on{' '}
          <Tooltip term="Walrus" explanation="Walrus is decentralized blob storage on Sui. Data stored here is immutable and publicly accessible." />{' '}
          with a SHA-256 hash committed on-chain for verification.
          Click any entry to see the full reasoning chain.
        </p>
      </div>

      {/* Demo mode banner */}
      {isDemo && !loading && (
        <div className="bg-blue-900/20 border border-blue-800/50 rounded-xl p-4 flex items-center gap-3">
          <span className="text-blue-400 text-xl">i</span>
          <div>
            <p className="text-sm text-blue-300 font-medium">Demo Mode</p>
            <p className="text-xs text-gray-400">
              Showing sample data. Once the agent starts trading and contracts are deployed, real decisions will appear here with verifiable Walrus links and hash verification.
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-16">
          <div className="w-8 h-8 border-2 border-sage-500/30 border-t-sage-500 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading trade history from chain...</p>
        </div>
      ) : records.length === 0 ? (
        <div className="text-center py-16 bg-gray-900 rounded-xl border border-gray-800">
          <span className="text-4xl mb-4 block">&#x1F50D;</span>
          <h2 className="text-xl font-semibold mb-2">No Trades Yet</h2>
          <p className="text-gray-400 text-sm max-w-md mx-auto mb-6">
            The agent hasn&apos;t recorded any trades on-chain yet. Once it starts its 60-second cycle, decisions will appear here with full AI reasoning.
          </p>
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-6 top-0 bottom-0 w-px bg-gray-800" />

          <div className="space-y-4">
            {records.map((record, index) => {
              const action = TRADE_TYPE_MAP[record.tradeType] || 'HOLD';
              const isExpanded = expandedIndex === index;
              const reasoning = reasoningData[record.walrusBlobId];
              const isLoadingThis = loadingReasoning === record.walrusBlobId;
              const amountSui = (Number(record.amount) / 1e9).toFixed(4);
              const priceSui = (Number(record.price) / 1e9).toFixed(4);
              const time = new Date(Number(record.timestampMs)).toLocaleString();
              const verification = hashVerification[record.walrusBlobId];

              return (
                <div key={index} className="relative pl-14">
                  {/* Timeline dot */}
                  <div
                    className={`absolute left-4 top-4 w-4 h-4 rounded-full border-2 border-gray-950 ${ACTION_DOT_COLORS[action]}`}
                  />

                  <div
                    className={`rounded-xl border p-4 cursor-pointer transition-all ${
                      ACTION_COLORS[action]
                    } ${isExpanded ? 'ring-1 ring-white/10' : 'hover:ring-1 hover:ring-white/5'}`}
                    onClick={() => handleExpand(index, record)}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                          action === 'BUY' ? 'bg-green-500/20 text-green-400' :
                          action === 'SELL' ? 'bg-red-500/20 text-red-400' :
                          action === 'REBALANCE' ? 'bg-blue-500/20 text-blue-400' :
                          'bg-gray-500/20 text-gray-400'
                        }`}>
                          {action}
                        </span>
                        <span className="text-sm">
                          {amountSui} SUI @ ${priceSui}
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          record.guardianApproved
                            ? 'bg-sage-500/20 text-sage-400'
                            : 'bg-yellow-500/20 text-yellow-400'
                        }`}>
                          {record.guardianApproved ? 'Approved' : 'Blocked'}
                        </span>
                        <span className="text-xs text-gray-500">
                          {record.confidence}% conf
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-500">{time}</span>
                        <span className={`text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                          &#x25BC;
                        </span>
                      </div>
                    </div>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="mt-4 space-y-4 border-t border-gray-700/50 pt-4">
                        {isLoadingThis ? (
                          <div className="flex items-center gap-3 py-4">
                            <div className="w-5 h-5 border-2 border-sage-500/30 border-t-sage-500 rounded-full animate-spin" />
                            <p className="text-sm text-gray-400">Fetching reasoning from Walrus...</p>
                          </div>
                        ) : reasoning ? (
                          <>
                            {/* Reasoning */}
                            <div>
                              <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">
                                AI Reasoning
                              </h4>
                              <p className="text-sm text-gray-300 leading-relaxed">{reasoning.decision.reasoning}</p>
                            </div>

                            <div className="grid sm:grid-cols-2 gap-4">
                              <div>
                                <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">
                                  <Tooltip term="Confidence" explanation="How confident the AI is in this decision (0-100%). Higher = more certain." />
                                </h4>
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-sage-500 rounded-full transition-all"
                                      style={{ width: `${reasoning.decision.confidence}%` }}
                                    />
                                  </div>
                                  <span className="text-sm font-mono">{reasoning.decision.confidence}%</span>
                                </div>
                              </div>
                              <div>
                                <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">
                                  <Tooltip term="Market Condition" explanation="The AI's assessment of overall market sentiment at decision time." />
                                </h4>
                                <p className="text-sm">{reasoning.decision.marketCondition}</p>
                              </div>
                            </div>

                            <div>
                              <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Risk Assessment</h4>
                              <p className="text-sm text-gray-300">{reasoning.decision.riskAssessment}</p>
                            </div>

                            {/* Guardian Checks */}
                            {reasoning.guardianCheck && (
                              <div>
                                <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">
                                  <Tooltip term="Guardian Checks" explanation="8 automated risk checks run before every trade. All must pass for execution. Budget, spread, concentration, depth, confidence, cooldown, slippage, and vault health." />
                                </h4>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                  {reasoning.guardianCheck.checks.map((check, i) => (
                                    <div
                                      key={i}
                                      className={`rounded-lg p-2 text-xs ${
                                        check.passed
                                          ? 'bg-sage-500/10 border border-sage-500/20'
                                          : 'bg-red-500/10 border border-red-500/20'
                                      }`}
                                    >
                                      <div className="flex items-center gap-1 mb-0.5">
                                        <span className={check.passed ? 'text-sage-400' : 'text-red-400'}>
                                          {check.passed ? '\u2713' : '\u2717'}
                                        </span>
                                        <span className="font-medium truncate">{check.name}</span>
                                      </div>
                                      <p className="text-gray-500 truncate">{check.value}</p>
                                    </div>
                                  ))}
                                </div>
                                <p className={`text-xs mt-2 ${
                                  reasoning.guardianCheck.approved ? 'text-sage-400' : 'text-red-400'
                                }`}>
                                  {reasoning.guardianCheck.overallReason}
                                </p>
                              </div>
                            )}

                            {/* Market Snapshot */}
                            <div>
                              <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Market Snapshot at Decision Time</h4>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <MiniStat label="Mid Price" value={`$${reasoning.marketSnapshot.midPrice.toFixed(4)}`} />
                                <MiniStat label="Spread" value={`${reasoning.marketSnapshot.spreadBps.toFixed(1)} bps`} />
                                <MiniStat label="Bid Depth" value={reasoning.marketSnapshot.bidDepth.toFixed(1)} />
                                <MiniStat label="Ask Depth" value={reasoning.marketSnapshot.askDepth.toFixed(1)} />
                              </div>
                            </div>

                            {/* Verification + Links */}
                            <div className="space-y-2 pt-2 border-t border-gray-700/30">
                              {/* Hash Verification */}
                              {record.reasoningHash && (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-gray-500">Hash Verification:</span>
                                  {verification === 'verified' ? (
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-sage-500/20 text-sage-400">
                                      Verified - blob matches on-chain hash
                                    </span>
                                  ) : verification === 'mismatch' ? (
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
                                      Mismatch - blob does not match
                                    </span>
                                  ) : (
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-400">
                                      Checking...
                                    </span>
                                  )}
                                </div>
                              )}

                              <div className="flex items-center justify-between">
                                <div className="text-xs text-gray-500 font-mono truncate max-w-[60%]">
                                  Walrus: {record.walrusBlobId}
                                </div>
                                {!record.walrusBlobId.startsWith('sample-') && (
                                  <a
                                    href={`https://suiscan.xyz/${SUI_NETWORK}/tx/${record.txDigest}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-xs text-sage-400 hover:text-sage-300 transition-colors"
                                  >
                                    View TX &#x2192;
                                  </a>
                                )}
                              </div>

                              {record.reasoningHash && (
                                <div className="text-xs text-gray-600 font-mono truncate">
                                  SHA-256: {record.reasoningHash}
                                </div>
                              )}
                            </div>
                          </>
                        ) : (
                          <p className="text-sm text-gray-400 py-2">
                            Could not load reasoning data. The Walrus blob might not be available yet.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-800/50 rounded-lg p-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-mono">{value}</p>
    </div>
  );
}

function decodeBytes(bytes: number[]): string {
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function bytesToHex(bytes: number[]): string {
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Sample data for demo mode
function getSampleRecords(): TradeRecord[] {
  const now = Date.now();
  return [
    {
      tradeType: 0,
      amount: '5000000000',
      price: '1550000000',
      walrusBlobId: 'sample-1',
      reasoningHash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      timestampMs: String(now - 60000),
      txDigest: '0xabc123',
      guardianApproved: true,
      confidence: 72,
    },
    {
      tradeType: 1,
      amount: '3000000000',
      price: '1580000000',
      walrusBlobId: 'sample-2',
      reasoningHash: 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3',
      timestampMs: String(now - 120000),
      txDigest: '0xdef456',
      guardianApproved: true,
      confidence: 65,
    },
    {
      tradeType: 0,
      amount: '7000000000',
      price: '1520000000',
      walrusBlobId: 'sample-3',
      reasoningHash: 'c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
      timestampMs: String(now - 180000),
      txDigest: '0xghi789',
      guardianApproved: false,
      confidence: 28,
    },
  ];
}

function getSampleReasoning(blobId: string): ReasoningLog {
  const samples: Record<string, ReasoningLog> = {
    'sample-1': {
      version: '2.0.0',
      agentId: '0xagent',
      timestamp: Date.now() - 60000,
      marketSnapshot: {
        pool: 'SUI/USDC',
        baseAsset: 'SUI',
        quoteAsset: 'USDC',
        midPrice: 1.55,
        bestBid: 1.549,
        bestAsk: 1.551,
        spread: 0.002,
        spreadBps: 13,
        bidDepth: 12500,
        askDepth: 11800,
        volume24h: 650000,
        timestamp: Date.now() - 60000,
      },
      vaultState: {
        balance: '50000000000',
        deployed: '10000000000',
        totalShares: '50000000000',
        totalValue: '60000000000',
      },
      decision: {
        action: 'BUY',
        reasoning: 'The SUI/USDC pair shows strengthening bid depth with a 5.9% increase over the last hour. The tight spread of 13bps indicates healthy liquidity. My Walrus memory shows I performed well in similar BULLISH conditions (3/4 profitable). Risk-reward is favorable for a 5 SUI position.',
        confidence: 72,
        quantity: 5,
        price: 1.55,
        orderType: 'MARKET',
        riskAssessment: 'Moderate risk. Position size is 8.3% of vault (within 30% Move-enforced limit). My AgentCap allows max 10 SUI per trade. Stop-loss at $1.48 would cap downside at ~4.5%.',
        marketCondition: 'BULLISH',
        timestamp: Date.now() - 60000,
      },
      guardianCheck: {
        approved: true,
        riskLevel: 'LOW',
        checks: [
          { name: 'Budget Ceiling', passed: true, value: '5 SUI', threshold: '10 SUI (on-chain)', message: 'Within AgentCap limit' },
          { name: 'Spread Check', passed: true, value: '13 bps', threshold: '50 bps', message: 'Spread acceptable' },
          { name: 'Position Conc.', passed: true, value: '8.3%', threshold: '30% (on-chain)', message: 'Within limit' },
          { name: 'Liquidity Depth', passed: true, value: '11800', threshold: '100', message: 'Sufficient' },
          { name: 'Confidence Floor', passed: true, value: '72%', threshold: '30%', message: 'Above minimum' },
          { name: 'Trade Cooldown', passed: true, value: 'First trade', threshold: '30s (on-chain)', message: 'Cooldown met' },
          { name: 'Slippage Est.', passed: true, value: '0.4 bps', threshold: '100 bps', message: 'Acceptable' },
          { name: 'Vault Health', passed: true, value: 'Active', threshold: 'Active + balance', message: 'Healthy' },
        ],
        overallReason: 'All 8 guardian checks passed. Risk level: LOW. On-chain enforcement active.',
        timestamp: Date.now() - 60000,
      },
      executionResult: { success: true, filledQuantity: 5, filledPrice: 1.551 },
    },
    'sample-2': {
      version: '2.0.0',
      agentId: '0xagent',
      timestamp: Date.now() - 120000,
      marketSnapshot: {
        pool: 'SUI/USDC', baseAsset: 'SUI', quoteAsset: 'USDC',
        midPrice: 1.58, bestBid: 1.579, bestAsk: 1.581, spread: 0.002,
        spreadBps: 13, bidDepth: 10200, askDepth: 13100, volume24h: 720000,
        timestamp: Date.now() - 120000,
      },
      vaultState: { balance: '45000000000', deployed: '15000000000', totalShares: '50000000000', totalValue: '60000000000' },
      decision: {
        action: 'SELL',
        reasoning: 'Ask depth increased 11% while bid depth decreased 18%, suggesting selling pressure. Taking profit on 3 SUI position entered at $1.55. The 1.9% gain is a clean exit before potential reversal. Walrus memory shows my sells in SIDEWAYS conditions have 60% success rate.',
        confidence: 65, quantity: 3, price: 1.58, orderType: 'MARKET',
        riskAssessment: 'Low risk — taking profit on existing position.', marketCondition: 'SIDEWAYS',
        timestamp: Date.now() - 120000,
      },
      guardianCheck: {
        approved: true, riskLevel: 'LOW',
        checks: [
          { name: 'Budget Ceiling', passed: true, value: '3 SUI', threshold: '10 SUI (on-chain)', message: 'OK' },
          { name: 'Spread Check', passed: true, value: '13 bps', threshold: '50 bps', message: 'OK' },
          { name: 'Position Conc.', passed: true, value: '5.0%', threshold: '30% (on-chain)', message: 'OK' },
          { name: 'Liquidity Depth', passed: true, value: '10200', threshold: '100', message: 'OK' },
          { name: 'Confidence Floor', passed: true, value: '65%', threshold: '30%', message: 'OK' },
          { name: 'Trade Cooldown', passed: true, value: '63s ago', threshold: '30s (on-chain)', message: 'OK' },
          { name: 'Slippage Est.', passed: true, value: '0.3 bps', threshold: '100 bps', message: 'OK' },
          { name: 'Vault Health', passed: true, value: 'Active', threshold: 'Active + balance', message: 'OK' },
        ],
        overallReason: 'All 8 guardian checks passed. Risk level: LOW.',
        timestamp: Date.now() - 120000,
      },
      executionResult: { success: true, filledQuantity: 3, filledPrice: 1.579 },
    },
    'sample-3': {
      version: '2.0.0',
      agentId: '0xagent',
      timestamp: Date.now() - 180000,
      marketSnapshot: {
        pool: 'SUI/USDC', baseAsset: 'SUI', quoteAsset: 'USDC',
        midPrice: 1.52, bestBid: 1.519, bestAsk: 1.521, spread: 0.002,
        spreadBps: 13, bidDepth: 14200, askDepth: 9800, volume24h: 580000,
        timestamp: Date.now() - 180000,
      },
      vaultState: { balance: '50000000000', deployed: '0', totalShares: '50000000000', totalValue: '50000000000' },
      decision: {
        action: 'BUY',
        reasoning: 'Strong bid support at $1.52. 7 SUI would be 14% of vault — but my AgentCap only allows 10 SUI max and Move enforces 30% position limit, so 7 SUI is safe. However, confidence is only 28% due to low volume.',
        confidence: 28, quantity: 7, price: 1.52, orderType: 'MARKET',
        riskAssessment: 'High risk due to low confidence score.',
        marketCondition: 'BULLISH',
        timestamp: Date.now() - 180000,
      },
      guardianCheck: {
        approved: false, riskLevel: 'HIGH',
        checks: [
          { name: 'Budget Ceiling', passed: true, value: '7 SUI', threshold: '10 SUI (on-chain)', message: 'OK' },
          { name: 'Spread Check', passed: true, value: '13 bps', threshold: '50 bps', message: 'OK' },
          { name: 'Position Conc.', passed: true, value: '14%', threshold: '30% (on-chain)', message: 'OK' },
          { name: 'Liquidity Depth', passed: true, value: '9800', threshold: '100', message: 'OK' },
          { name: 'Confidence Floor', passed: false, value: '28%', threshold: '30%', message: 'BLOCKED: Below minimum confidence' },
          { name: 'Trade Cooldown', passed: true, value: '45s ago', threshold: '30s (on-chain)', message: 'OK' },
          { name: 'Slippage Est.', passed: true, value: '0.7 bps', threshold: '100 bps', message: 'OK' },
          { name: 'Vault Health', passed: true, value: 'Active', threshold: 'Active + balance', message: 'OK' },
        ],
        overallReason: 'BLOCKED: 1 check failed — Confidence Floor. AI confidence 28% is below 30% minimum.',
        timestamp: Date.now() - 180000,
      },
      executionResult: { success: false, error: 'Guardian blocked: Confidence below minimum' },
    },
  };

  return samples[blobId] || samples['sample-1'];
}
