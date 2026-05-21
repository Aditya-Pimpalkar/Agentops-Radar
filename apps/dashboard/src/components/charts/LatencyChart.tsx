"use client";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

interface Point { run_id: string; latency_ms: number; started_at: string; }

export function LatencyChart({ data }: { data: Point[] }) {
  if (!data.length) return <div className="text-radar-muted text-sm text-center py-8">No data yet</div>;
  const chartData = data.slice(-30).map((d, i) => ({
    i: i + 1,
    latency: d.latency_ms,
    label: new Date(d.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3a" />
        <XAxis dataKey="label" tick={{ fill: "#6b7280", fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} unit="ms" />
        <Tooltip
          contentStyle={{ background: "#1a1d27", border: "1px solid #2a2d3a", borderRadius: 6 }}
          labelStyle={{ color: "#e2e8f0" }}
          itemStyle={{ color: "#6366f1" }}
        />
        <Line type="monotone" dataKey="latency" stroke="#6366f1" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
