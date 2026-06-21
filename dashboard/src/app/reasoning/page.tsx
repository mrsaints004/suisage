'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSuiClient } from '@mysten/dapp-kit';
import type { ReasoningLog, TradeAction } from '@suisage/shared';

const VAULT_PACKAGE_ID = process.env.NEXT_PUBLIC_VAULT_PACKAGE_ID || '';
const WALRUS_AGGREGATOR_URL = process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL || 'https://aggregator.walrus-testnet.walrus.space';
const SUI_NETWORK = process.env.NEXT_PUBLIC_SUI_NETWORK || 'testnet';

// Unified decision record (from on-chain events OR agent decisions log)
interface DecisionRecord {
  action: string;
  confidence: number;
  quantity: number;
  price: number;
  reasoning: string;
  marketCondition: string;
  riskAssessment: string;
  midPrice: number;
  spreadBps: number;
  walrusBlobId: string;
  reasoningHash: string;
  timestampMs: string;
  txDigest: string;
  guardianApproved: boolean;
  source: 'onchain' | 'agent';
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
  const [records, setRecords] = useState<DecisionRecord[]>([]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [reasoningData, setReasoningData] = useState<Record<string, ReasoningLog>>({});
  const [loadingReasoning, setLoadingReasoning] = useState<string | null>(null);
  const [hashVerification, setHashVerification] = useState<Record<string, 'verified' | 'mismatch' | 'pending'>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'ALL' | 'BUY' | 'SELL' | 'HOLD'>('ALL');

  // Fetch from both on-chain events and agent decisions log
  useEffect(() => {
    async function fetchAllDecisions() {
      const allRecords: DecisionRecord[] = [];

      // 1. On-chain TradeRecordEvent entries (BUY/SELL/REBALANCE)
      if (VAULT_PACKAGE_ID) {
        try {
          const events = await suiClient.queryEvents({
            query: {
              MoveEventType: `${VAULT_PACKAGE_ID}::agent_auth::TradeRecordEvent`,
            },
            limit: 50,
            order: 'descending',
          });

          for (const ev of events.data) {
            const fields = ev.parsedJson as Record<string, unknown>;
            const action = TRADE_TYPE_MAP[Number(fields.trade_type)] || 'BUY';
            allRecords.push({
              action,
              confidence: Number(fields.confidence ?? 0),
              quantity: Number(fields.amount) / 1e9,
              price: Number(fields.price) / 1e9,
              reasoning: '',
              marketCondition: '',
              riskAssessment: '',
              midPrice: 0,
              spreadBps: 0,
              walrusBlobId: decodeBytes(fields.walrus_blob_id as number[]),
              reasoningHash: bytesToHex(fields.reasoning_hash as number[]),
              timestampMs: String(fields.timestamp_ms),
              txDigest: ev.id.txDigest,
              guardianApproved: Boolean(fields.guardian_approved),
              source: 'onchain',
            });
          }
        } catch (error) {
          console.error('Error fetching on-chain events:', error);
        }
      }

      // 2. Agent decisions log (includes HOLDs)
      try {
        const res = await fetch('/api/decisions');
        if (res.ok) {
          const agentDecisions = await res.json() as Array<{
            timestamp: number;
            vaultId: string;
            action: string;
            confidence: number;
            quantity: number;
            price: number;
            reasoning: string;
            marketCondition: string;
            riskAssessment: string;
            midPrice: number;
            spreadBps: number;
            walrusBlobId: string;
            txDigest?: string;
            guardianApproved: boolean;
          }>;

          for (const d of agentDecisions) {
            // Skip if already captured from on-chain (by matching txDigest)
            if (d.txDigest && allRecords.some(r => r.txDigest === d.txDigest)) continue;

            allRecords.push({
              action: d.action,
              confidence: d.confidence,
              quantity: d.quantity,
              price: d.price,
              reasoning: d.reasoning,
              marketCondition: d.marketCondition,
              riskAssessment: d.riskAssessment,
              midPrice: d.midPrice,
              spreadBps: d.spreadBps,
              walrusBlobId: d.walrusBlobId,
              reasoningHash: '',
              timestampMs: String(d.timestamp),
              txDigest: d.txDigest || '',
              guardianApproved: d.guardianApproved,
              source: 'agent',
            });
          }
        }
      } catch {
        // Agent decisions endpoint not available (agent not running locally)
      }

      // Sort by timestamp descending
      allRecords.sort((a, b) => Number(b.timestampMs) - Number(a.timestampMs));
      setRecords(allRecords);
      setLoading(false);
    }

    fetchAllDecisions();
    const interval = setInterval(fetchAllDecisions, 15000);
    return () => clearInterval(interval);
  }, [suiClient]);

  // Verify reasoning hash against Walrus blob
  async function verifyReasoningHash(blobId: string, expectedHash: string) {
    if (!expectedHash) return;

    try {
      const res = await fetch(`${WALRUS_AGGREGATOR_URL}/v1/blobs/${blobId}`);
      if (!res.ok) return;

      const text = await res.text();
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
      setHashVerification((prev) => ({
        ...prev,
        [blobId]: 'mismatch',
      }));
    }
  }

  // Fetch reasoning from Walrus when a card is expanded
  async function loadReasoning(blobId: string, reasoningHash: string) {
    if (reasoningData[blobId]) {
      if (!hashVerification[blobId] && reasoningHash) {
        verifyReasoningHash(blobId, reasoningHash);
      }
      return;
    }

    // Skip local/error blobs
    if (blobId.startsWith('local-') || blobId.startsWith('error-') || blobId === 'hold-no-blob') return;

    setLoadingReasoning(blobId);
    try {
      const res = await fetch(`${WALRUS_AGGREGATOR_URL}/v1/blobs/${blobId}`);
      if (res.ok) {
        const data = await res.json();
        setReasoningData((prev) => ({ ...prev, [blobId]: data as ReasoningLog }));
        if (reasoningHash) verifyReasoningHash(blobId, reasoningHash);
      }
    } catch (error) {
      console.error('Error fetching reasoning:', error);
    }
    setLoadingReasoning(null);
  }

  function handleExpand(index: number, record: DecisionRecord) {
    if (expandedIndex === index) {
      setExpandedIndex(null);
    } else {
      setExpandedIndex(index);
      if (record.source === 'onchain') {
        loadReasoning(record.walrusBlobId, record.reasoningHash);
      }
    }
  }

  const filteredRecords = useMemo(() => {
    if (filter === 'ALL') return records;
    return records.filter((r) => r.action === filter);
  }, [records, filter]);

  const stats = useMemo(() => {
    const buys = records.filter((r) => r.action === 'BUY').length;
    const sells = records.filter((r) => r.action === 'SELL').length;
    const holds = records.filter((r) => r.action === 'HOLD').length;
    const avgConf = records.length > 0
      ? Math.round(records.reduce((sum, r) => sum + r.confidence, 0) / records.length)
      : 0;
    const approved = records.filter((r) => r.guardianApproved).length;
    return { total: records.length, buys, sells, holds, avgConf, approved };
  }, [records]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Reasoning Timeline</h1>
        <p className="text-gray-400 mt-2">
          Every trading decision is stored on Walrus. Trades include a SHA-256 hash on-chain for verification.
          Click any entry to see the full reasoning.
        </p>
      </div>

      {/* Stats Summary */}
      {!loading && records.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <p className="text-xs text-gray-500">Total Decisions</p>
            <p className="text-xl font-bold">{stats.total}</p>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <p className="text-xs text-gray-500">Buys</p>
            <p className="text-xl font-bold text-green-400">{stats.buys}</p>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <p className="text-xs text-gray-500">Sells</p>
            <p className="text-xl font-bold text-red-400">{stats.sells}</p>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <p className="text-xs text-gray-500">Holds</p>
            <p className="text-xl font-bold text-gray-400">{stats.holds}</p>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <p className="text-xs text-gray-500">Avg Confidence</p>
            <p className="text-xl font-bold">{stats.avgConf}%</p>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <p className="text-xs text-gray-500">Guardian Approved</p>
            <p className="text-xl font-bold text-sage-400">{stats.approved}</p>
          </div>
        </div>
      )}

      {/* Filter Buttons */}
      {!loading && records.length > 0 && (
        <div className="flex gap-2">
          {(['ALL', 'BUY', 'SELL', 'HOLD'] as const).map((f) => {
            const count = f === 'ALL' ? records.length : f === 'BUY' ? stats.buys : f === 'SELL' ? stats.sells : stats.holds;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filter === f
                    ? 'bg-sage-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {f} <span className="ml-1 opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="text-center py-16">
          <div className="w-8 h-8 border-2 border-sage-500/30 border-t-sage-500 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading decisions...</p>
        </div>
      ) : records.length === 0 ? (
        <div className="text-center py-16 bg-gray-900 rounded-xl border border-gray-800">
          <svg className="w-10 h-10 mx-auto mb-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>
          <h2 className="text-xl font-semibold mb-2">No Decisions Yet</h2>
          <p className="text-gray-400 text-sm max-w-md mx-auto mb-2">
            The agent hasn&apos;t made any decisions yet. Once it starts analyzing the market,
            every decision (including HOLDs) will appear here with full reasoning.
          </p>
          <p className="text-gray-500 text-xs max-w-sm mx-auto">
            Make sure the agent is running. Decisions refresh every 15 seconds.
          </p>
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-6 top-0 bottom-0 w-px bg-gray-800" />

          <div className="space-y-4">
            {filteredRecords.map((record, index) => {
              const action = record.action;
              const isExpanded = expandedIndex === index;
              const walrusReasoning = reasoningData[record.walrusBlobId];
              const isLoadingThis = loadingReasoning === record.walrusBlobId;
              const time = new Date(Number(record.timestampMs)).toLocaleString();
              const verification = hashVerification[record.walrusBlobId];

              // Use inline reasoning from agent log, or Walrus blob for on-chain entries
              const hasInlineReasoning = record.source === 'agent' && record.reasoning;

              return (
                <div key={`${record.timestampMs}-${index}`} className="relative pl-14">
                  {/* Timeline dot */}
                  <div
                    className={`absolute left-4 top-4 w-4 h-4 rounded-full border-2 border-gray-950 ${ACTION_DOT_COLORS[action] || 'bg-gray-500'}`}
                  />

                  <div
                    className={`rounded-xl border p-4 cursor-pointer transition-all ${
                      ACTION_COLORS[action] || 'border-gray-500 bg-gray-500/10'
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
                        {action !== 'HOLD' ? (
                          <span className="text-sm">
                            {record.quantity.toFixed(4)} SUI @ ${record.price.toFixed(4)}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-400">
                            Mid: ${record.midPrice.toFixed(4)} | Spread: {record.spreadBps.toFixed(1)}bps
                          </span>
                        )}
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          record.guardianApproved
                            ? 'bg-sage-500/20 text-sage-400'
                            : 'bg-yellow-500/20 text-yellow-400'
                        }`}>
                          {record.guardianApproved ? 'Approved' : 'Blocked'}
                        </span>
                        <span className="text-xs text-gray-500">
                          {record.confidence}% confidence
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        {record.source === 'onchain' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-sage-500/10 text-sage-500">on-chain</span>
                        )}
                        <span className="text-xs text-gray-500">{time}</span>
                        <span className={`text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                          &#x25BC;
                        </span>
                      </div>
                    </div>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="mt-4 space-y-4 border-t border-gray-700/50 pt-4">
                        {/* If we have inline reasoning from agent log, show it directly */}
                        {hasInlineReasoning ? (
                          <>
                            <div>
                              <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">
                                Why the agent made this decision
                              </h4>
                              <p className="text-sm text-gray-300 leading-relaxed">{record.reasoning}</p>
                            </div>

                            <div className="grid sm:grid-cols-2 gap-4">
                              <div>
                                <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Confidence</h4>
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-sage-500 rounded-full transition-all"
                                      style={{ width: `${record.confidence}%` }}
                                    />
                                  </div>
                                  <span className="text-sm font-mono">{record.confidence}%</span>
                                </div>
                              </div>
                              <div>
                                <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Market Condition</h4>
                                <p className="text-sm">{record.marketCondition || 'N/A'}</p>
                              </div>
                            </div>

                            {record.riskAssessment && (
                              <div>
                                <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Risk Assessment</h4>
                                <p className="text-sm text-gray-300">{record.riskAssessment}</p>
                              </div>
                            )}

                            {/* Market Snapshot */}
                            {record.midPrice > 0 && (
                              <div>
                                <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Market at Decision Time</h4>
                                <div className="grid grid-cols-2 gap-3">
                                  <MiniStat label="Mid Price" value={`$${record.midPrice.toFixed(4)}`} />
                                  <MiniStat label="Spread" value={`${record.spreadBps.toFixed(1)} bps`} />
                                </div>
                              </div>
                            )}

                            {/* Verification links */}
                            <div className="space-y-2 pt-2 border-t border-gray-700/30">
                              {record.walrusBlobId && !record.walrusBlobId.startsWith('local-') && !record.walrusBlobId.startsWith('error-') && record.walrusBlobId !== 'hold-no-blob' && (
                                <div className="flex items-center justify-between">
                                  <div className="text-xs text-gray-500 font-mono truncate max-w-[60%]">
                                    Walrus: {record.walrusBlobId}
                                  </div>
                                  <a
                                    href={`${WALRUS_AGGREGATOR_URL}/v1/blobs/${record.walrusBlobId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-xs text-sage-400 hover:text-sage-300 transition-colors"
                                  >
                                    View Blob &#x2192;
                                  </a>
                                </div>
                              )}
                              {record.txDigest && (
                                <div className="flex items-center justify-between">
                                  <div className="text-xs text-gray-500 font-mono truncate max-w-[60%]">
                                    TX: {record.txDigest}
                                  </div>
                                  <a
                                    href={`https://suiscan.xyz/${SUI_NETWORK}/tx/${record.txDigest}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-xs text-sage-400 hover:text-sage-300 transition-colors"
                                  >
                                    View TX &#x2192;
                                  </a>
                                </div>
                              )}
                            </div>
                          </>
                        ) : isLoadingThis ? (
                          <div className="flex items-center gap-3 py-4">
                            <div className="w-5 h-5 border-2 border-sage-500/30 border-t-sage-500 rounded-full animate-spin" />
                            <p className="text-sm text-gray-400">Fetching reasoning from Walrus...</p>
                          </div>
                        ) : walrusReasoning ? (
                          <>
                            <div>
                              <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">
                                Why the agent made this decision
                              </h4>
                              <p className="text-sm text-gray-300 leading-relaxed">{walrusReasoning.decision.reasoning}</p>
                            </div>

                            <div className="grid sm:grid-cols-2 gap-4">
                              <div>
                                <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Confidence</h4>
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-sage-500 rounded-full transition-all"
                                      style={{ width: `${walrusReasoning.decision.confidence}%` }}
                                    />
                                  </div>
                                  <span className="text-sm font-mono">{walrusReasoning.decision.confidence}%</span>
                                </div>
                              </div>
                              <div>
                                <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Market Condition</h4>
                                <p className="text-sm">{walrusReasoning.decision.marketCondition}</p>
                              </div>
                            </div>

                            <div>
                              <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Risk Assessment</h4>
                              <p className="text-sm text-gray-300">{walrusReasoning.decision.riskAssessment}</p>
                            </div>

                            {/* Guardian Checks */}
                            {walrusReasoning.guardianCheck && (
                              <div>
                                <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Safety Checks</h4>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                  {walrusReasoning.guardianCheck.checks.map((check, i) => (
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
                                  walrusReasoning.guardianCheck.approved ? 'text-sage-400' : 'text-red-400'
                                }`}>
                                  {walrusReasoning.guardianCheck.overallReason}
                                </p>
                              </div>
                            )}

                            {/* Market Snapshot */}
                            <div>
                              <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Market at Decision Time</h4>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <MiniStat label="Mid Price" value={`$${walrusReasoning.marketSnapshot.midPrice.toFixed(4)}`} />
                                <MiniStat label="Spread" value={`${walrusReasoning.marketSnapshot.spreadBps.toFixed(1)} bps`} />
                                <MiniStat label="Bid Depth" value={walrusReasoning.marketSnapshot.bidDepth.toFixed(1)} />
                                <MiniStat label="Ask Depth" value={walrusReasoning.marketSnapshot.askDepth.toFixed(1)} />
                              </div>
                            </div>

                            {/* Verification + Links */}
                            <div className="space-y-2 pt-2 border-t border-gray-700/30">
                              {record.reasoningHash && (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-gray-500">Integrity:</span>
                                  {verification === 'verified' ? (
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-sage-500/20 text-sage-400">
                                      Verified — blob matches on-chain hash
                                    </span>
                                  ) : verification === 'mismatch' ? (
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
                                      Mismatch — blob does not match
                                    </span>
                                  ) : (
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-400 flex items-center gap-1">
                                      <span className="w-3 h-3 border border-gray-500 border-t-gray-300 rounded-full animate-spin inline-block" />
                                      Verifying...
                                    </span>
                                  )}
                                </div>
                              )}

                              <div className="flex items-center justify-between">
                                <div className="text-xs text-gray-500 font-mono truncate max-w-[60%]">
                                  Walrus: {record.walrusBlobId}
                                </div>
                                {record.txDigest && (
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
