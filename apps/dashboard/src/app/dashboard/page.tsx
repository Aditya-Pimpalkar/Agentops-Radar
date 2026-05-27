import { api } from "@/lib/api";
import type { AnalyticsOverview, Alert } from "@/types";
import { LatencyChart } from "@/components/charts/LatencyChart";
import { FailureChart } from "@/components/charts/FailureChart";
import Link from "next/link";

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

function MetricCard({
  label, value, sub, color = "text-white", hint,
}: {
  label: string; value: string; sub?: string; color?: string; hint?: string;
}) {
  return (
    <div className="card flex flex-col gap-1">
      <div className="section-label">{label}</div>
      <div className={`text-2xl font-bold tabular-nums mono mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{sub}</div>}
      {hint && <div className="text-xs mt-1 leading-snug" style={{ color: "var(--muted)" }}>{hint}</div>}
    </div>
  );
}

export default async function DashboardPage() {
  const [overview, latency, failures, alerts] = await Promise.all([
    getOverview(), getLatencyTrend(), getFailureBreakdown(), getRecentAlerts(),
  ]);

  const failureRateColor =
    overview.failure_rate > 0.15 ? "text-red-400"
    : overview.failure_rate > 0.05 ? "text-yellow-400"
    : "text-green-400";

  const scoreColor =
    overview.avg_quality_score >= 0.7 ? "text-green-400"
    : overview.avg_quality_score >= 0.5 ? "text-yellow-400"
    : "text-red-400";

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-white">Overview</h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
          Health and performance across all agent runs
        </p>
      </div>

      {/* Active alerts banner */}
      {alerts.length > 0 && (
        <div className="card flex items-start gap-4" style={{ borderColor: "rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.05)" }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(239,68,68,0.15)" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 1.5L14 13.5H2L8 1.5Z" stroke="#f87171" strokeWidth="1.5" strokeLinejoin="round"/>
              <path d="M8 6v3.5" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="8" cy="11.5" r="0.75" fill="#f87171"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-red-400">{alerts.length} active alert{alerts.length !== 1 ? "s" : ""}</span>
              <Link href="/alerts" className="text-xs shrink-0" style={{ color: "var(--accent)" }}>View all →</Link>
            </div>
            <div className="mt-2 space-y-1">
              {alerts.slice(0, 3).map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-sm">
                  <span className={`badge badge-${a.severity} text-[10px]`}>{a.severity}</span>
                  <span className="truncate" style={{ color: "rgba(255,255,255,0.7)" }}>{a.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <MetricCard
          label="Total Runs"
          value={overview.total_runs.toLocaleString()}
          hint="All time"
        />
        <MetricCard
          label="Failed"
          value={overview.failed_runs.toLocaleString()}
          color="text-red-400"
          hint="Needs attention"
        />
        <MetricCard
          label="Failure Rate"
          value={`${(overview.failure_rate * 100).toFixed(1)}%`}
          color={failureRateColor}
          hint={overview.failure_rate > 0.05 ? "Above target" : "Within target"}
        />
        <MetricCard
          label="Avg Latency"
          value={`${overview.avg_latency_ms.toLocaleString()}ms`}
          hint="per run"
        />
        <MetricCard
          label="Avg Quality"
          value={`${(overview.avg_quality_score * 100).toFixed(0)}%`}
          color={scoreColor}
          hint="Eval score"
        />
        <MetricCard
          label="Est. Cost"
          value={`$${overview.estimated_cost_usd.toFixed(4)}`}
          hint="All tokens"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="mb-4">
            <div className="font-semibold text-white text-sm">Latency Trend</div>
            <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
              End-to-end run latency over time (ms)
            </div>
          </div>
          <LatencyChart data={latency} />
        </div>
        <div className="card">
          <div className="mb-4">
            <div className="font-semibold text-white text-sm">Failure Breakdown</div>
            <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
              Most common failure types across all runs
            </div>
          </div>
          <FailureChart data={failures} />
        </div>
      </div>
    </div>
  );
}
