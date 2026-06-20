'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSuiClient } from '@mysten/dapp-kit';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Scatter,
  ComposedChart,
} from 'recharts';

interface PerformanceChartProps {
  vaultId: string;
  packageId: string;
}

type TimeRange = '24h' | '7d' | '30d' | 'all';

interface NavDataPoint {
  timestamp: number;
  time: string;
  navPerShare: number;
  tradeType?: 'buy' | 'sell';
  buyMarker?: number;
  sellMarker?: number;
}

interface TradeEvent {
  timestamp: number;
  tradeType: number; // 0 = BUY, 1 = SELL
  price: number;
  amount: number;
  profit: number;
  loss: number;
}

interface PerformanceEvent {
  timestamp: number;
  navPerShare: number;
  totalValue: number;
}

const TIME_RANGES: { label: string; value: TimeRange }[] = [
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: 'All', value: 'all' },
];

function getTimeRangeMs(range: TimeRange): number {
  switch (range) {
    case '24h': return 24 * 60 * 60 * 1000;
    case '7d': return 7 * 24 * 60 * 60 * 1000;
    case '30d': return 30 * 24 * 60 * 60 * 1000;
    case 'all': return Infinity;
  }
}

function formatTimestamp(ts: number, range: TimeRange): string {
  const d = new Date(ts);
  if (range === '24h') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (range === '7d') {
    return d.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function PerformanceChart({ vaultId, packageId }: PerformanceChartProps) {
  const suiClient = useSuiClient();
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const [loading, setLoading] = useState(true);
  const [tradeEvents, setTradeEvents] = useState<TradeEvent[]>([]);
  const [performanceEvents, setPerformanceEvents] = useState<PerformanceEvent[]>([]);
  const [volumeDeposit, setVolumeDeposit] = useState(0);
  const [volumeWithdraw, setVolumeWithdraw] = useState(0);

  // Fetch all event data
  useEffect(() => {
    if (!packageId || !vaultId) {
      setLoading(false);
      return;
    }

    async function fetchAllEvents() {
      setLoading(true);

      try {
        // Fetch trade record events
        const tradeEventsRes = await suiClient.queryEvents({
          query: {
            MoveEventType: `${packageId}::agent_auth::TradeRecordEvent`,
          },
          limit: 200,
          order: 'ascending',
        });

        const trades: TradeEvent[] = tradeEventsRes.data
          .map((ev) => {
            const fields = ev.parsedJson as Record<string, unknown>;
            const eventVaultId = String(fields.vault_id || '');
            if (eventVaultId && eventVaultId !== vaultId) return null;
            return {
              timestamp: Number(fields.timestamp_ms || ev.timestampMs || '0'),
              tradeType: Number(fields.trade_type ?? 0),
              price: Number(String(fields.price || '0')) / 1e9,
              amount: Number(String(fields.amount || '0')) / 1e9,
              profit: Number(String(fields.profit || '0')) / 1e9,
              loss: Number(String(fields.loss || '0')) / 1e9,
            };
          })
          .filter(Boolean) as TradeEvent[];

        setTradeEvents(trades);

        // Fetch performance events
        const perfEventsRes = await suiClient.queryEvents({
          query: {
            MoveEventType: `${packageId}::agent_auth::PerformanceEvent`,
          },
          limit: 200,
          order: 'ascending',
        });

        const perfs: PerformanceEvent[] = perfEventsRes.data
          .map((ev) => {
            const fields = ev.parsedJson as Record<string, unknown>;
            const eventVaultId = String(fields.vault_id || '');
            if (eventVaultId && eventVaultId !== vaultId) return null;
            return {
              timestamp: Number(fields.timestamp_ms || ev.timestampMs || '0'),
              navPerShare: Number(String(fields.nav_per_share || '0')) / 1e9,
              totalValue: Number(String(fields.total_value || '0')) / 1e9,
            };
          })
          .filter(Boolean) as PerformanceEvent[];

        setPerformanceEvents(perfs);

        // Fetch deposit events for volume
        const depositEventsRes = await suiClient.queryEvents({
          query: {
            MoveEventType: `${packageId}::vault::DepositEvent`,
          },
          limit: 200,
          order: 'ascending',
        });

        let totalDeposit = 0;
        for (const ev of depositEventsRes.data) {
          const fields = ev.parsedJson as Record<string, unknown>;
          const eventVaultId = String(fields.vault_id || '');
          if (eventVaultId && eventVaultId !== vaultId) continue;
          totalDeposit += Number(String(fields.amount || '0')) / 1e9;
        }
        setVolumeDeposit(totalDeposit);

        // Fetch withdraw events for volume
        const withdrawEventsRes = await suiClient.queryEvents({
          query: {
            MoveEventType: `${packageId}::vault::WithdrawEvent`,
          },
          limit: 200,
          order: 'ascending',
        });

        let totalWithdraw = 0;
        for (const ev of withdrawEventsRes.data) {
          const fields = ev.parsedJson as Record<string, unknown>;
          const eventVaultId = String(fields.vault_id || '');
          if (eventVaultId && eventVaultId !== vaultId) continue;
          totalWithdraw += Number(String(fields.amount || '0')) / 1e9;
        }
        setVolumeWithdraw(totalWithdraw);
      } catch (err) {
        console.error('Failed to fetch performance events:', err);
      }

      setLoading(false);
    }

    fetchAllEvents();
  }, [suiClient, packageId, vaultId]);

  // Build chart data from events, applying time range filter
  const chartData = useMemo<NavDataPoint[]>(() => {
    const now = Date.now();
    const cutoff = timeRange === 'all' ? 0 : now - getTimeRangeMs(timeRange);

    // Merge performance events and trade events into a timeline
    const allPoints = new Map<number, NavDataPoint>();

    // Add performance events as NAV data points
    for (const p of performanceEvents) {
      if (p.timestamp < cutoff) continue;
      allPoints.set(p.timestamp, {
        timestamp: p.timestamp,
        time: formatTimestamp(p.timestamp, timeRange),
        navPerShare: p.navPerShare,
      });
    }

    // Overlay trade events - compute synthetic NAV if no performance events exist
    if (performanceEvents.length === 0 && tradeEvents.length > 0) {
      // Build NAV from trades: start at 1.0 and adjust by profits/losses
      let nav = 1.0;
      for (const t of tradeEvents) {
        if (t.timestamp < cutoff) continue;
        nav += t.profit - t.loss;
        const point: NavDataPoint = {
          timestamp: t.timestamp,
          time: formatTimestamp(t.timestamp, timeRange),
          navPerShare: parseFloat(nav.toFixed(6)),
          tradeType: t.tradeType === 0 ? 'buy' : 'sell',
        };
        if (t.tradeType === 0) point.buyMarker = nav;
        else point.sellMarker = nav;
        allPoints.set(t.timestamp, point);
      }
    } else {
      // Add trade markers to existing performance data
      for (const t of tradeEvents) {
        if (t.timestamp < cutoff) continue;
        const existing = allPoints.get(t.timestamp);
        if (existing) {
          existing.tradeType = t.tradeType === 0 ? 'buy' : 'sell';
          if (t.tradeType === 0) existing.buyMarker = existing.navPerShare;
          else existing.sellMarker = existing.navPerShare;
        } else {
          // Find nearest NAV value
          let closestNav = 1.0;
          let closestDist = Infinity;
          for (const p of performanceEvents) {
            const dist = Math.abs(p.timestamp - t.timestamp);
            if (dist < closestDist) {
              closestDist = dist;
              closestNav = p.navPerShare;
            }
          }
          const point: NavDataPoint = {
            timestamp: t.timestamp,
            time: formatTimestamp(t.timestamp, timeRange),
            navPerShare: closestNav,
            tradeType: t.tradeType === 0 ? 'buy' : 'sell',
          };
          if (t.tradeType === 0) point.buyMarker = closestNav;
          else point.sellMarker = closestNav;
          allPoints.set(t.timestamp, point);
        }
      }
    }

    const sorted = Array.from(allPoints.values()).sort((a, b) => a.timestamp - b.timestamp);

    return sorted;
  }, [tradeEvents, performanceEvents, timeRange]);

  // Compute summary stats
  const stats = useMemo(() => {
    const totalTrades = tradeEvents.length;
    const wins = tradeEvents.filter((t) => t.profit > 0).length;
    const losses = tradeEvents.filter((t) => t.loss > 0).length;
    const winRate = totalTrades > 0 ? ((wins / (wins + losses || 1)) * 100).toFixed(1) : '0.0';

    const currentNav = chartData.length > 0 ? chartData[chartData.length - 1].navPerShare : 1.0;
    const firstNav = chartData.length > 0 ? chartData[0].navPerShare : 1.0;
    const totalReturn = firstNav > 0 ? ((currentNav - firstNav) / firstNav) * 100 : 0;

    return {
      currentNav: currentNav.toFixed(4),
      totalReturn: totalReturn.toFixed(2),
      totalTrades,
      winRate,
      totalVolume: (volumeDeposit + volumeWithdraw).toFixed(2),
    };
  }, [chartData, tradeEvents, volumeDeposit, volumeWithdraw]);

  if (!vaultId || !packageId) {
    return null;
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-lg font-semibold text-white">Vault Performance</h3>
        <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
          {TIME_RANGES.map((tr) => (
            <button
              key={tr.value}
              onClick={() => setTimeRange(tr.value)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                timeRange === tr.value
                  ? 'bg-sage-600 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {tr.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <MiniStat label="NAV / Share" value={stats.currentNav} />
        <MiniStat
          label="Total Return"
          value={`${Number(stats.totalReturn) >= 0 ? '+' : ''}${stats.totalReturn}%`}
          color={
            Number(stats.totalReturn) > 0
              ? 'text-green-400'
              : Number(stats.totalReturn) < 0
              ? 'text-red-400'
              : 'text-white'
          }
        />
        <MiniStat label="Total Trades" value={String(stats.totalTrades)} />
        <MiniStat label="Win Rate" value={`${stats.winRate}%`} />
      </div>

      {/* Chart */}
      {loading ? (
        <div className="h-64 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-sage-500/30 border-t-sage-500 rounded-full animate-spin" />
        </div>
      ) : chartData.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-gray-500 text-sm">
          No performance data available yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData}>
            <defs>
              <linearGradient id="navGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis
              dataKey="time"
              stroke="#6b7280"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              stroke="#6b7280"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              domain={['auto', 'auto']}
              tickFormatter={(v: number) => v.toFixed(2)}
            />
            <ReferenceLine
              y={1.0}
              stroke="#6b7280"
              strokeDasharray="4 4"
              strokeWidth={1}
              label={{
                value: 'Par (1.0)',
                position: 'insideTopRight',
                fill: '#6b7280',
                fontSize: 10,
              }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#111827',
                border: '1px solid #374151',
                borderRadius: '8px',
                fontSize: '12px',
              }}
              labelStyle={{ color: '#9ca3af' }}
              formatter={(value: number, name: string) => {
                if (name === 'buyMarker') return [value.toFixed(4), 'Buy'];
                if (name === 'sellMarker') return [value.toFixed(4), 'Sell'];
                return [value.toFixed(4), 'NAV/Share'];
              }}
            />
            <Area
              type="monotone"
              dataKey="navPerShare"
              stroke="#22c55e"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#navGradient)"
              dot={false}
              activeDot={{ r: 4, fill: '#22c55e' }}
            />
            <Scatter
              dataKey="buyMarker"
              fill="#4ade80"
              stroke="#166534"
              strokeWidth={1}
              r={5}
              shape="circle"
              name="buyMarker"
            />
            <Scatter
              dataKey="sellMarker"
              fill="#f87171"
              stroke="#991b1b"
              strokeWidth={1}
              r={5}
              shape="circle"
              name="sellMarker"
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      {/* Legend */}
      <div className="flex items-center gap-6 mt-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-sage-500 inline-block rounded" />
          NAV / Share
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 bg-green-400 rounded-full inline-block" />
          Buy
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 bg-red-400 rounded-full inline-block" />
          Sell
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-6 h-0 border-t border-dashed border-gray-500 inline-block" />
          Par Value
        </span>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="bg-gray-800/50 rounded-lg px-4 py-3">
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className={`text-sm font-bold ${color ?? 'text-white'}`}>{value}</p>
    </div>
  );
}

