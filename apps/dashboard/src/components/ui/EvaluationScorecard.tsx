import type { Evaluation } from "@/types";
import { ScoreBar } from "./StatusBadge";

const EVAL_LABELS: Record<string, string> = {
  groundedness: "Groundedness",
  relevance: "Relevance",
  safety: "Safety",
  tool_call_correctness: "Tool Correctness",
  latency: "Latency",
  format_compliance: "Format Compliance",
  retry_loop: "Retry Loop",
  evidence: "Evidence",
  llm_judge: "LLM Judge",
};

export function EvaluationScorecard({ evaluations }: { evaluations: Evaluation[] }) {
  if (!evaluations.length) {
    return <div className="text-radar-muted text-sm">No evaluations available.</div>;
  }

  const overall =
    evaluations.filter((e) => e.score !== null).reduce((s, e) => s + (e.score ?? 0), 0) /
    evaluations.filter((e) => e.score !== null).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 pb-3 border-b border-radar-border">
        <span className="text-sm text-radar-muted">Overall</span>
        <ScoreBar score={Number.isNaN(overall) ? null : overall} />
      </div>
      <div className="space-y-2">
        {evaluations.map((e) => (
          <div key={e.id} className="flex items-center gap-3 text-sm">
            <span className="text-white/70 w-36 shrink-0 text-xs">
              {EVAL_LABELS[e.evaluator_name] ?? e.evaluator_name}
            </span>
            <ScoreBar score={e.score} />
            <span
              className={[
                "text-xs badge",
                e.passed === true ? "badge-success" : e.passed === false ? "badge-failed" : "badge-warning",
              ].join(" ")}
            >
              {e.passed === true ? "pass" : e.passed === false ? "fail" : "—"}
            </span>
            <span className="text-radar-muted text-xs truncate flex-1">{e.reason}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
