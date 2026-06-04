'use client';

import { useState, useEffect } from 'react';
import { useSuiClient } from '@mysten/dapp-kit';
import type { ReasoningLog, TradeAction } from '@suisage/shared';

const VAULT_PACKAGE_ID = process.env.NEXT_PUBLIC_VAULT_PACKAGE_ID || '';
const WALRUS_AGGREGATOR_URL = process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL || 'https://aggregator.walrus-testnet.walrus.space';

interface TradeRecord {
  tradeType: number;
  amount: string;
  price: string;
  walrusBlobId: string;
  timestampMs: string;
  txDigest: string;
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
  const [loading, setLoading] = useState(true);

  // Fetch trade events from chain
  useEffect(() => {
    async function fetchTradeEvents() {
      if (!VAULT_PACKAGE_ID) {
        // Demo mode: show sample data
        setRecords(getSampleRecords());
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
            timestampMs: String(fields.timestamp_ms),
            txDigest: ev.id.txDigest,
          };
        });

        setRecords(parsed);
      } catch (error) {
        console.error('Error fetching events:', error);
        setRecords(getSampleRecords());
      }
      setLoading(false);
    }

    fetchTradeEvents();
  }, [suiClient]);

  // Fetch reasoning from Walrus when a card is expanded
  async function loadReasoning(blobId: string) {
    if (reasoningData[blobId]) return;
    if (blobId.startsWith('sample-')) {
      // Demo mode
      setReasoningData((prev) => ({
        ...prev,
        [blobId]: getSampleReasoning(blobId),
      }));
      return;
    }

    try {
      const res = await fetch(`${WALRUS_AGGREGATOR_URL}/v1/blobs/${blobId}`);
      if (res.ok) {
        const data = await res.json();
        setReasoningData((prev) => ({ ...prev, [blobId]: data as ReasoningLog }));
      }
    } catch (error) {
      console.error('Error fetching reasoning:', error);
    }
  }

  function handleExpand(index: number, blobId: string) {
    if (expandedIndex === index) {
      setExpandedIndex(null);
    } else {
      setExpandedIndex(index);
      loadReasoning(blobId);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Reasoning Timeline</h1>
        <p className="text-gray-400 mt-2">
          Every decision the agent makes is stored on Walrus. Click any entry to see the full reasoning chain.
        </p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading trade history...</div>
      ) : records.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          No trades recorded yet. The agent will populate this timeline as it operates.
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
              const amountSui = (Number(record.amount) / 1e9).toFixed(4);
              const priceSui = (Number(record.price) / 1e9).toFixed(4);
              const time = new Date(Number(record.timestampMs)).toLocaleString();

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
                    onClick={() => handleExpand(index, record.walrusBlobId)}
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
                      </div>
                      <span className="text-xs text-gray-500">{time}</span>
                    </div>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="mt-4 space-y-4 border-t border-gray-700/50 pt-4">
                        {reasoning ? (
                          <>
                            {/* Decision */}
                            <div>
                              <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Reasoning</h4>
                              <p className="text-sm text-gray-300">{reasoning.decision.reasoning}</p>
                            </div>

                            <div className="grid sm:grid-cols-2 gap-4">
                              <div>
                                <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Confidence</h4>
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-sage-500 rounded-full"
                                      style={{ width: `${reasoning.decision.confidence}%` }}
                                    />
                                  </div>
                                  <span className="text-sm font-mono">{reasoning.decision.confidence}%</span>
                                </div>
                              </div>
                              <div>
                                <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Market Condition</h4>
                                <p className="text-sm">{reasoning.decision.marketCondition}</p>
                              </div>
                            </div>

                            <div>
                              <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Risk Assessment</h4>
                              <p className="text-sm text-gray-300">{reasoning.decision.riskAssessment}</p>
                            </div>

                            {/* Market Snapshot */}
                            <div>
                              <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Market Snapshot</h4>
                              <div className="grid grid-cols-3 gap-2 text-xs">
                                <div>
                                  <span className="text-gray-500">Mid:</span> ${reasoning.marketSnapshot.midPrice.toFixed(4)}
                                </div>
                                <div>
                                  <span className="text-gray-500">Spread:</span> {reasoning.marketSnapshot.spreadBps.toFixed(1)}bps
                                </div>
                                <div>
                                  <span className="text-gray-500">Vol:</span> ${reasoning.marketSnapshot.volume24h.toFixed(0)}
                                </div>
                              </div>
                            </div>

                            {/* Walrus reference */}
                            <div className="text-xs text-gray-500 font-mono break-all">
                              Walrus Blob: {record.walrusBlobId}
                            </div>
                          </>
                        ) : (
                          <p className="text-sm text-gray-400">Loading reasoning from Walrus...</p>
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

function decodeBytes(bytes: number[]): string {
  return new TextDecoder().decode(new Uint8Array(bytes));
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
      timestampMs: String(now - 60000),
      txDigest: '0xabc123',
    },
    {
      tradeType: 1,
      amount: '3000000000',
      price: '1580000000',
      walrusBlobId: 'sample-2',
      timestampMs: String(now - 120000),
      txDigest: '0xdef456',
    },
    {
      tradeType: 0,
      amount: '7000000000',
      price: '1520000000',
      walrusBlobId: 'sample-3',
      timestampMs: String(now - 180000),
      txDigest: '0xghi789',
    },
  ];
}

function getSampleReasoning(blobId: string): ReasoningLog {
  const samples: Record<string, ReasoningLog> = {
    'sample-1': {
      version: '1.0.0',
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
        reasoning: 'The SUI/USDC pair shows strengthening bid depth with a 5.9% increase over the last hour. The tight spread of 13bps indicates healthy liquidity. Volume is trending up at $650K/24h. The risk-reward for a small position is favorable given current momentum.',
        confidence: 72,
        quantity: 5,
        price: 1.55,
        orderType: 'MARKET',
        riskAssessment: 'Moderate risk. Position size is 8.3% of vault, within limits. Stop-loss at $1.48 would cap downside at ~4.5%.',
        marketCondition: 'BULLISH',
        timestamp: Date.now() - 60000,
      },
      executionResult: { success: true, filledQuantity: 5, filledPrice: 1.551 },
    },
    'sample-2': {
      version: '1.0.0',
      agentId: '0xagent',
      timestamp: Date.now() - 120000,
      marketSnapshot: {
        pool: 'SUI/USDC',
        baseAsset: 'SUI',
        quoteAsset: 'USDC',
        midPrice: 1.58,
        bestBid: 1.579,
        bestAsk: 1.581,
        spread: 0.002,
        spreadBps: 13,
        bidDepth: 10200,
        askDepth: 13100,
        volume24h: 720000,
        timestamp: Date.now() - 120000,
      },
      vaultState: {
        balance: '45000000000',
        deployed: '15000000000',
        totalShares: '50000000000',
        totalValue: '60000000000',
      },
      decision: {
        action: 'SELL',
        reasoning: 'Ask depth has increased 11% while bid depth decreased 18%, suggesting selling pressure building. Taking profit on the 3 SUI position entered at $1.55. The 1.9% gain over 60 seconds is a clean exit point before potential reversal.',
        confidence: 65,
        quantity: 3,
        price: 1.58,
        orderType: 'MARKET',
        riskAssessment: 'Low risk trade - taking profit on existing position. Leaving 2 SUI deployed for continued upside exposure.',
        marketCondition: 'SIDEWAYS',
        timestamp: Date.now() - 120000,
      },
      executionResult: { success: true, filledQuantity: 3, filledPrice: 1.579 },
    },
    'sample-3': {
      version: '1.0.0',
      agentId: '0xagent',
      timestamp: Date.now() - 180000,
      marketSnapshot: {
        pool: 'SUI/USDC',
        baseAsset: 'SUI',
        quoteAsset: 'USDC',
        midPrice: 1.52,
        bestBid: 1.519,
        bestAsk: 1.521,
        spread: 0.002,
        spreadBps: 13,
        bidDepth: 14200,
        askDepth: 9800,
        volume24h: 580000,
        timestamp: Date.now() - 180000,
      },
      vaultState: {
        balance: '50000000000',
        deployed: '0',
        totalShares: '50000000000',
        totalValue: '50000000000',
      },
      decision: {
        action: 'BUY',
        reasoning: 'Strong bid support at $1.52 with bid depth 45% higher than ask depth. This asymmetry often precedes upward movement. Starting a new position with 7 SUI (14% of vault) as a swing trade. Volume at $580K/24h is moderate but stable.',
        confidence: 68,
        quantity: 7,
        price: 1.52,
        orderType: 'MARKET',
        riskAssessment: 'Moderate risk. 14% of vault committed. Setting mental stop-loss at $1.46 (-3.9% downside). The strong bid wall at $1.52 provides natural support.',
        marketCondition: 'BULLISH',
        timestamp: Date.now() - 180000,
      },
      executionResult: { success: true, filledQuantity: 7, filledPrice: 1.521 },
    },
  };

  return samples[blobId] || samples['sample-1'];
}
