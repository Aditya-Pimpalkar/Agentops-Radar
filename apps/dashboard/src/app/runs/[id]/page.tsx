import Link from "next/link";
import { api } from "@/lib/api";
import type { Run, TraceEvent, Evaluation, Alert, ReplayComparison } from "@/types";
import { StatusBadge, SeverityBadge, ScoreBar } from "@/components/ui/StatusBadge";
import { TraceTimeline } from "@/components/ui/TraceTimeline";
import { EvaluationScorecard } from "@/components/ui/EvaluationScorecard";
import { ReplayPanel } from "@/components/ui/ReplayPanel";
import { SimilarFailures } from "@/components/ui/SimilarFailures";

async function getAll(id: string) {
  const [run, trace, evals, alerts] = await Promise.all([
    api.get<Run>(`/api/runs/${id}`).catch(() => null),
    api.get<TraceEvent[]>(`/api/runs/${id}/trace`).catch(() => []),
    api.get<Evaluation[]>(`/api/runs/${id}/evaluations`).catch(() => []),
    api.get<Alert[]>(`/api/alerts`).catch(() => [] as Alert[]),
  ]);
  const runAlerts = (alerts as Alert[]).filter((a) => a.run_id === id);
  let comparison: ReplayComparison | null = null;
  if (run?.status === "replayed" || runAlerts.length > 0) {
    comparison = await api.get<ReplayComparison>(`/api/runs/${id}/replay/comparison`).catch(() => null);
  }
  return { run, trace: trace as TraceEvent[], evals: evals as Evaluation[], alerts: runAlerts, comparison };
}

export default async function RunDetailPage({ params }: { params: { id: string } }) {
  const { run, trace, evals, alerts, comparison } = await getAll(params.id);

  if (!run) {
    return (
      <div className="text-center py-20 text-radar-muted">
        Run not found.{" "}
        <Link href="/runs" className="text-radar-accent hover:underline">Back to runs</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/runs" className="text-radar-muted text-xs hover:text-white">← Runs</Link>
          <h1 className="text-xl font-bold text-white mt-1 font-mono">{run.id}</h1>
        </div>
        <StatusBadge status={run.status} />
      </div>

      {/* Run metadata */}
      <div className="card">
        <div className="text-xs text-radar-muted uppercase tracking-widest mb-3">Run Summary</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-radar-muted text-xs mb-1">Confidence</div>
            <ScoreBar score={run.confidence_score} />
          </div>
          <div>
            <div className="text-radar-muted text-xs mb-1">Latency</div>
            <div className="text-white">{run.total_latency_ms ? `${run.total_latency_ms.toLocaleString()}ms` : "—"}</div>
          </div>
          <div>
            <div className="text-radar-muted text-xs mb-1">Tokens</div>
            <div className="text-white">{run.total_tokens?.toLocaleString() ?? "—"}</div>
          </div>
          <div>
            <div className="text-radar-muted text-xs mb-1">Cost</div>
            <div className="text-white">{run.estimated_cost_usd ? `$${Number(run.estimated_cost_usd).toFixed(6)}` : "—"}</div>
          </div>
        </div>
        {run.input && (
          <div className="mt-4 pt-4 border-t border-radar-border">
            <div className="text-radar-muted text-xs mb-1">Input</div>
            <div className="text-sm text-white/80">{run.input}</div>
          </div>
        )}
        {run.final_output && (
          <div className="mt-3">
            <div className="text-radar-muted text-xs mb-1">Output</div>
            <div className="text-sm text-white/80">{run.final_output}</div>
          </div>
        )}
      </div>

      {/* Failure labels */}
      {alerts.length > 0 && (
        <div className="card border-red-900/40">
          <div className="text-xs text-red-400 uppercase tracking-widest mb-3">
            Failure Labels ({alerts.length})
          </div>
          <div className="space-y-2">
            {alerts.map((a) => (
              <div key={a.id} className="flex items-center gap-3 text-sm">
                <SeverityBadge severity={a.severity} />
                <span className="text-radar-muted font-mono text-xs">{a.alert_type}</span>
                <span className="text-white/70">{a.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trace timeline */}
      <div className="card">
        <div className="text-xs text-radar-muted uppercase tracking-widest mb-4">
          Trace Timeline ({trace.length} events)
        </div>
        <TraceTimeline events={trace} />
      </div>

      {/* Evaluation scorecard */}
      {evals.length > 0 && (
        <div className="card">
          <div className="text-xs text-radar-muted uppercase tracking-widest mb-4">
            Evaluation Scorecard
          </div>
          <EvaluationScorecard evaluations={evals} />
        </div>
      )}

      {/* Similar failures — pgvector semantic search */}
      <div className="card">
        <div className="text-xs text-radar-muted uppercase tracking-widest mb-4">
          Similar Failures{" "}
          <span className="normal-case text-radar-muted/60 font-normal text-[10px]">
            powered by pgvector · text-embedding-3-small
          </span>
        </div>
        <SimilarFailures runId={run.id} />
      </div>

      {/* Replay panel */}
      <div className="card">
        <div className="text-xs text-radar-muted uppercase tracking-widest mb-4">Replay</div>
        <ReplayPanel runId={run.id} comparison={comparison} />
      </div>
    </div>
  );
}
