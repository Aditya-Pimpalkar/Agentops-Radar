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

function SectionHeader({
  title, description, count,
}: {
  title: string; description?: string; count?: number;
}) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {count !== undefined && (
          <span
            className="mono text-xs px-1.5 py-0.5 rounded"
            style={{ background: "var(--border-bright)", color: "var(--muted-bright)" }}
          >
            {count}
          </span>
        )}
      </div>
      {description && (
        <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
          {description}
        </p>
      )}
    </div>
  );
}

export default async function RunDetailPage({ params }: { params: { id: string } }) {
  const { run, trace, evals, alerts, comparison } = await getAll(params.id);

  if (!run) {
    return (
      <div className="text-center py-20" style={{ color: "var(--muted)" }}>
        <div className="text-4xl mb-4">🔍</div>
        <div className="text-white font-medium mb-1">Run not found</div>
        <Link href="/runs" style={{ color: "var(--accent)" }} className="text-sm hover:underline">← Back to runs</Link>
      </div>
    );
  }

  const isFailure = run.status === "failed" || run.status === "error";

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Breadcrumb + title */}
      <div>
        <Link href="/runs" className="text-xs hover:underline" style={{ color: "var(--muted)" }}>← All runs</Link>
        <div className="flex items-center justify-between mt-2 gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold text-white truncate">
              {run.input ?? "Untitled run"}
            </h1>
            <div className="mono text-xs mt-0.5" style={{ color: "var(--muted)" }}>{run.id}</div>
          </div>
          <StatusBadge status={run.status} />
        </div>
      </div>

      {/* Run summary card */}
      <div className="card">
        <SectionHeader
          title="Run summary"
          description="Key metrics for this agent execution"
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-5">
          <div>
            <div className="section-label mb-2">Confidence</div>
            <ScoreBar score={run.confidence_score} />
          </div>
          <div>
            <div className="section-label mb-1">Latency</div>
            <div className="mono text-base font-semibold text-white">
              {run.total_latency_ms ? `${run.total_latency_ms.toLocaleString()}ms` : "—"}
            </div>
          </div>
          <div>
            <div className="section-label mb-1">Tokens</div>
            <div className="mono text-base font-semibold text-white">
              {run.total_tokens?.toLocaleString() ?? "—"}
            </div>
          </div>
          <div>
            <div className="section-label mb-1">Cost</div>
            <div className="mono text-base font-semibold text-white">
              {run.estimated_cost_usd ? `$${Number(run.estimated_cost_usd).toFixed(6)}` : "—"}
            </div>
          </div>
        </div>

        {/* Input / output */}
        {(run.input || run.final_output) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
            {run.input && (
              <div>
                <div className="section-label mb-2">Input</div>
                <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.8)" }}>{run.input}</p>
              </div>
            )}
            {run.final_output && (
              <div>
                <div className="section-label mb-2">Final output</div>
                <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.8)" }}>{run.final_output}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Failure alerts */}
      {alerts.length > 0 && (
        <div className="card" style={{ borderColor: "rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.04)" }}>
          <SectionHeader
            title="Detected issues"
            description="Automated failure labels triggered by evaluation rules"
            count={alerts.length}
          />
          <div className="space-y-2.5">
            {alerts.map((a) => (
              <div key={a.id} className="flex items-start gap-3 text-sm">
                <SeverityBadge severity={a.severity} />
                <div>
                  <span className="mono text-xs" style={{ color: "var(--muted)" }}>{a.alert_type}</span>
                  <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.75)" }}>{a.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trace timeline */}
      <div className="card">
        <SectionHeader
          title="Trace timeline"
          description="Every step the agent took, in order. Click a step to inspect its inputs and outputs."
          count={trace.length}
        />
        <TraceTimeline events={trace} />
      </div>

      {/* Evaluation scorecard */}
      {evals.length > 0 && (
        <div className="card">
          <SectionHeader
            title="Evaluation scores"
            description="Automated quality checks run after the agent completed. Each evaluator tests a different aspect of the output."
            count={evals.length}
          />
          <EvaluationScorecard evaluations={evals} />
        </div>
      )}

      {/* Similar failures */}
      {isFailure && (
        <div className="card">
          <SectionHeader
            title="Similar past failures"
            description="Semantically similar runs found using pgvector cosine search on the trace embedding. High similarity means the agent failed in the same way before."
          />
          <SimilarFailures runId={run.id} />
        </div>
      )}

      {/* Replay */}
      <div className="card">
        <SectionHeader
          title="Replay"
          description="Re-evaluate this run with different settings to see how scores would change. Use this to test whether a fix improves outcomes before deploying."
        />
        <ReplayPanel runId={run.id} comparison={comparison} />
      </div>
    </div>
  );
}
