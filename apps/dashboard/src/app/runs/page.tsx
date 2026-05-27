import Link from "next/link";
import { api } from "@/lib/api";
import type { Run } from "@/types";
import { StatusBadge, ScoreBar } from "@/components/ui/StatusBadge";

async function getRuns(status?: string): Promise<Run[]> {
  try {
    const qs = status ? `?status=${status}` : "";
    return await api.get<Run[]>(`/api/runs${qs}`);
  } catch { return []; }
}

const FILTER_LABELS: Record<string, string> = {
  "": "All",
  success: "Passed",
  failed: "Failed",
  running: "Running",
  replayed: "Replayed",
};

export default async function RunsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const runs = await getRuns(searchParams.status);
  const statuses = ["", "success", "failed", "running", "replayed"];
  const activeStatus = searchParams.status ?? "";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Runs</h1>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            {runs.length} run{runs.length !== 1 ? "s" : ""}{activeStatus ? ` · ${FILTER_LABELS[activeStatus] ?? activeStatus}` : ""}
          </p>
        </div>
        {/* Status filters */}
        <div className="flex gap-1.5">
          {statuses.map((s) => {
            const active = activeStatus === s;
            return (
              <Link
                key={s}
                href={s ? `/runs?status=${s}` : "/runs"}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{
                  background: active ? "var(--accent-soft)" : "transparent",
                  color: active ? "var(--accent)" : "var(--muted-bright)",
                  border: `1px solid ${active ? "rgba(99,102,241,0.3)" : "var(--border-bright)"}`,
                }}
              >
                {FILTER_LABELS[s] ?? s}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        {runs.length === 0 ? (
          <div className="py-16 text-center space-y-2">
            <div className="text-3xl">🤖</div>
            <div className="text-sm font-medium text-white">No runs yet</div>
            <div className="text-xs" style={{ color: "var(--muted)" }}>
              Start the demo agent or use the{" "}
              <Link href="/playground" style={{ color: "var(--accent)" }}>Playground</Link> to generate runs.
            </div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Run</th>
                <th>Status</th>
                <th>Quality score</th>
                <th>Latency</th>
                <th>Failures</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  {/* Run ID + input preview */}
                  <td>
                    <Link
                      href={`/runs/${run.id}`}
                      className="font-medium text-white hover:underline text-sm"
                    >
                      {run.input
                        ? run.input.length > 55
                          ? run.input.slice(0, 55) + "…"
                          : run.input
                        : "—"}
                    </Link>
                    <div className="mono text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                      {run.id.slice(0, 8)}…
                    </div>
                  </td>
                  <td><StatusBadge status={run.status} /></td>
                  <td><ScoreBar score={run.confidence_score} /></td>
                  <td className="mono text-xs" style={{ color: "var(--muted-bright)" }}>
                    {run.total_latency_ms ? `${run.total_latency_ms.toLocaleString()}ms` : "—"}
                  </td>
                  <td>
                    {run.failure_count > 0 ? (
                      <span className="badge badge-failed">{run.failure_count} issue{run.failure_count !== 1 ? "s" : ""}</span>
                    ) : (
                      <span className="text-xs" style={{ color: "var(--muted)" }}>none</span>
                    )}
                  </td>
                  <td className="text-xs" style={{ color: "var(--muted)" }}>
                    {new Date(run.started_at).toLocaleString(undefined, {
                      month: "short", day: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
