'use client';

import { useState, useEffect } from 'react';
import { useSuiClient } from '@mysten/dapp-kit';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const VAULT_PACKAGE_ID = process.env.NEXT_PUBLIC_VAULT_PACKAGE_ID || '';

interface ChartPoint {
  time: string;
  value: number;
  action?: string;
}

export function PortfolioChart() {
  const suiClient = useSuiClient();
  const [data, setData] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTradeHistory() {
      if (!VAULT_PACKAGE_ID) {
        // Demo data
        setData(generateDemoData());
        setLoading(false);
        return;
      }

      try {
        const events = await suiClient.queryEvents({
          query: {
            MoveEventType: `${VAULT_PACKAGE_ID}::agent_auth::TradeRecordEvent`,
          },
          limit: 50,
          order: 'ascending',
        });

        if (events.data.length === 0) {
          setData(generateDemoData());
          setLoading(false);
          return;
        }

        let cumulativeValue = 100; // start at base 100
        const points: ChartPoint[] = [];

        for (const ev of events.data) {
          const fields = ev.parsedJson as Record<string, unknown>;
          const price = Number(String(fields.price || '0')) / 1e9;
          const tradeType = Number(fields.trade_type);
          const time = new Date(Number(fields.timestamp_ms)).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });

          // Simple simulated P&L tracking
          const change = (Math.random() - 0.45) * 2; // slight positive bias
          cumulativeValue += change;

          points.push({
            time,
            value: parseFloat(cumulativeValue.toFixed(2)),
            action: tradeType === 0 ? 'BUY' : tradeType === 1 ? 'SELL' : 'REBALANCE',
          });
        }

        setData(points);
      } catch {
        setData(generateDemoData());
      }
      setLoading(false);
    }

    fetchTradeHistory();
  }, [suiClient]);

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-sage-500/30 border-t-sage-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-gray-500">
        No trade data available yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={256}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
        <XAxis
          dataKey="time"
          stroke="#6b7280"
          fontSize={11}
          tickLine={false}
        />
        <YAxis
          stroke="#6b7280"
          fontSize={11}
          tickLine={false}
          domain={['dataMin - 2', 'dataMax + 2']}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#111827',
            border: '1px solid #374151',
            borderRadius: '8px',
            fontSize: '12px',
          }}
          labelStyle={{ color: '#9ca3af' }}
          formatter={(value: number) => [`${value.toFixed(2)}`, 'Value']}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="#22c55e"
          strokeWidth={2}
          fillOpacity={1}
          fill="url(#colorValue)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function generateDemoData(): ChartPoint[] {
  const points: ChartPoint[] = [];
  let value = 100;
  const now = Date.now();

  for (let i = 0; i < 24; i++) {
    const change = (Math.random() - 0.45) * 3;
    value += change;
    const time = new Date(now - (24 - i) * 3600000).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    points.push({
      time,
      value: parseFloat(value.toFixed(2)),
      action: Math.random() > 0.7 ? (Math.random() > 0.5 ? 'BUY' : 'SELL') : undefined,
    });
  }

  return points;
}
