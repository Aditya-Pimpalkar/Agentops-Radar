"use client";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";

interface Item { type: string; count: number; }

const COLORS = ["#ef4444", "#f59e0b", "#f97316", "#ec4899", "#a78bfa", "#60a5fa", "#34d399", "#facc15"];

export function FailureChart({ data }: { data: Item[] }) {
  if (!data.length) return <div className="text-radar-muted text-sm text-center py-8">No failures recorded</div>;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical">
        <XAxis type="number" tick={{ fill: "#6b7280", fontSize: 10 }} />
        <YAxis dataKey="type" type="category" tick={{ fill: "#6b7280", fontSize: 10 }} width={120} />
        <Tooltip
          contentStyle={{ background: "#1a1d27", border: "1px solid #2a2d3a", borderRadius: 6 }}
          labelStyle={{ color: "#e2e8f0" }}
          cursor={{ fill: "rgba(255,255,255,0.03)" }}
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
