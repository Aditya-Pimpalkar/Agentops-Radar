import type { Evaluation } from "@/types";
import { ScoreBar } from "./StatusBadge";

const EVAL_META: Record<string, { label: string; description: string }> = {
  groundedness:       { label: "Groundedness",     description: "Evidence quality × confidence" },
  relevance:          { label: "Relevance",         description: "Output completeness" },
  safety:             { label: "Safety",            description: "Guardrail violations" },
  tool_call_correctness: { label: "Tool correctness", description: "Tool error rate" },
  latency:            { label: "Latency",           description: "Run speed vs. SLA" },
  format_compliance:  { label: "Format",            description: "Output structure" },
  retry_loop:         { label: "Retry loop",        description: "Retry count" },
  evidence:           { label: "Evidence",          description: "Retrieval hit count" },
  llm_judge:          { label: "LLM Judge",         description: "GPT-4o-mini quality score" },
};

export function EvaluationScorecard({ evaluations }: { evaluations: Evaluation[] }) {
  if (!evaluations.length) {
    return (
      <div className="py-6 text-center text-sm" style={{ color: "var(--muted)" }}>
        No evaluations available for this run.
      </div>
    );
  }

  const scored = evaluations.filter((e) => e.score !== null);
  const overall = scored.length > 0
    ? scored.reduce((s, e) => s + (e.score ?? 0), 0) / scored.length
    : null;
  const passed = evaluations.filter((e) => e.passed === true).length;
  const total = evaluations.length;

  return (
    <div className="space-y-5">
      {/* Overall summary */}
      <div className="flex items-center gap-5 pb-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <div>
          <div className="section-label mb-1">Overall score</div>
          <ScoreBar score={overall} />
        </div>
        <div
          className="h-8 w-px"
          style={{ background: "var(--border)" }}
        />
        <div>
          <div className="section-label mb-1">Evaluators passed</div>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold mono" style={{ color: passed === total ? "#4ade80" : passed > total / 2 ? "#fbbf24" : "#f87171" }}>
              {passed}
            </span>
            <span className="text-sm" style={{ color: "var(--muted)" }}>/ {total}</span>
          </div>
        </div>
      </div>

      {/* Individual evaluators */}
      <div className="space-y-3">
        {evaluations.map((e) => {
          const meta = EVAL_META[e.evaluator_name];
          const passed = e.passed === true;
          const failed = e.passed === false;
          return (
            <div key={e.id} className="flex items-center gap-3">
              {/* Pass/fail indicator */}
              <div
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: passed ? "#4ade80" : failed ? "#f87171" : "#6b7280" }}
              />

              {/* Name + description */}
              <div className="w-40 shrink-0">
                <div className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.85)" }}>
                  {meta?.label ?? e.evaluator_name}
                </div>
                {meta?.description && (
                  <div className="text-xs" style={{ color: "var(--muted)" }}>
                    {meta.description}
                  </div>
                )}
              </div>

              {/* Score bar */}
              <div className="flex-1">
                <ScoreBar score={e.score} />
              </div>

              {/* Pass/fail badge */}
              <span className={`badge shrink-0 ${passed ? "badge-success" : failed ? "badge-failed" : "badge-warning"}`}>
                {e.passed === true ? "pass" : e.passed === false ? "fail" : "—"}
              </span>

              {/* Reason tooltip-style text */}
              {e.reason && (
                <span
                  className="text-xs truncate max-w-40"
                  style={{ color: "var(--muted)" }}
                  title={e.reason}
                >
                  {e.reason}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
