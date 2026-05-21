import { api } from "@/lib/api";
import type { AnalyticsOverview, Alert } from "@/types";
import { LatencyChart } from "@/components/charts/LatencyChart";
import { FailureChart } from "@/components/charts/FailureChart";

async function getOverview(): Promise<AnalyticsOverview> {
  try {
    return await api.get<AnalyticsOverview>("/api/analytics/overview");
  } catch {
    return { total_runs: 0, failed_runs: 0, failure_rate: 0, avg_latency_ms: 0, avg_quality_score: 0, estimated_cost_usd: 0 };
  }
}

async function getLatencyTrend() {
  try {
    return await api.get<{ run_id: string; latency_ms: number; started_at: string }[]>("/api/analytics/latency-trend");
  } catch { return []; }
}

async function getFailureBreakdown() {
  try {
    const data = await api.get<{ failure_types: { type: string; count: number }[] }>("/api/analytics/failures");
    return data.failure_types;
  } catch { return []; }
}

async function getRecentAlerts() {
  try {
    return await api.get<Alert[]>("/api/alerts?resolved=false");
  } catch { return []; }
}

function MetricCard({ label, value, sub, color = "text-white" }: {
  label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div className="card">
      <div className="text-radar-muted text-xs uppercase tracking-widest mb-2">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-radar-muted text-xs mt-1">{sub}</div>}
    </div>
  );
}

export default async function DashboardPage() {
  const [overview, latency, failures, alerts] = await Promise.all([
    getOverview(), getLatencyTrend(), getFailureBreakdown(), getRecentAlerts(),
  ]);

  const failureRateColor = overview.failure_rate > 0.15 ? "text-red-400"
    : overview.failure_rate > 0.05 ? "text-yellow-400" : "text-green-400";
  const scoreColor = overview.avg_quality_score >= 0.7 ? "text-green-400"
    : overview.avg_quality_score >= 0.5 ? "text-yellow-400" : "text-red-400";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Dashboard</h1>
        <p className="text-radar-muted text-sm mt-1">Agent observability overview</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <MetricCard label="Total Runs" value={overview.total_runs.toLocaleString()} />
        <MetricCard label="Failed Runs" value={overview.failed_runs.toLocaleString()} color="text-red-400" />
        <MetricCard
          label="Failure Rate"
          value={`${(overview.failure_rate * 100).toFixed(1)}%`}
          color={failureRateColor}
        />
        <MetricCard
          label="Avg Latency"
          value={`${overview.avg_latency_ms.toLocaleString()}ms`}
          sub="p50 estimate"
        />
        <MetricCard
          label="Avg Quality"
          value={`${(overview.avg_quality_score * 100).toFixed(0)}%`}
          color={scoreColor}
        />
        <MetricCard
          label="Est. Cost"
          value={`$${overview.estimated_cost_usd.toFixed(4)}`}
          sub="total"
        />
      </div>

      {alerts.length > 0 && (
        <div className="card border-red-900/50">
          <div className="text-xs text-red-400 uppercase tracking-widest mb-3">
            Active Alerts ({alerts.length})
          </div>
          <div className="space-y-2">
            {alerts.slice(0, 5).map((a) => (
              <div key={a.id} className="flex items-start gap-3 text-sm">
                <span className={`badge badge-${a.severity} shrink-0`}>{a.severity}</span>
                <span className="text-radar-muted">{a.alert_type}</span>
                <span className="text-white/80 truncate">{a.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="text-sm font-medium text-white mb-4">Latency Trend (ms)</div>
          <LatencyChart data={latency} />
        </div>
        <div className="card">
          <div className="text-sm font-medium text-white mb-4">Failure Distribution</div>
          <FailureChart data={failures} />
        </div>
      </div>
    </div>
  );
}
