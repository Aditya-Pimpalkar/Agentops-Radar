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

export default async function RunsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const runs = await getRuns(searchParams.status);
  const statuses = ["", "success", "failed", "running", "replayed"];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Runs</h1>
          <p className="text-radar-muted text-sm mt-1">{runs.length} runs</p>
        </div>
        <div className="flex gap-2">
          {statuses.map((s) => (
            <Link
              key={s}
              href={s ? `/runs?status=${s}` : "/runs"}
              className={[
                "px-3 py-1 rounded text-xs border transition-colors",
                searchParams.status === s || (!searchParams.status && !s)
                  ? "border-radar-accent text-radar-accent bg-radar-accent/10"
                  : "border-radar-border text-radar-muted hover:border-white/30",
              ].join(" ")}
            >
              {s || "All"}
            </Link>
          ))}
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-radar-border text-radar-muted text-xs uppercase tracking-widest">
              <th className="px-4 py-3 text-left">Run ID</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Quality</th>
              <th className="px-4 py-3 text-left">Latency</th>
              <th className="px-4 py-3 text-left">Failures</th>
              <th className="px-4 py-3 text-left">Started</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-radar-muted">
                  No runs yet. Start the demo agent to generate data.
                </td>
              </tr>
            ) : (
              runs.map((run) => (
                <tr
                  key={run.id}
                  className="border-b border-radar-border/50 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/runs/${run.id}`}
                      className="text-radar-accent hover:underline font-mono text-xs"
                    >
                      {run.id.slice(0, 8)}…
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="px-4 py-3">
                    <ScoreBar score={run.confidence_score} />
                  </td>
                  <td className="px-4 py-3 tabular-nums text-radar-muted">
                    {run.total_latency_ms ? `${run.total_latency_ms.toLocaleString()}ms` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {run.failure_count > 0 ? (
                      <span className="badge badge-failed">{run.failure_count}</span>
                    ) : (
                      <span className="text-radar-muted">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-radar-muted text-xs">
                    {new Date(run.started_at).toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
