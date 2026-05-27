"use client";
import { useState } from "react";
import Link from "next/link";
import type { ReplayComparison } from "@/types";

interface Props {
  runId: string;
  comparison: ReplayComparison | null;
}

const PASS_THRESHOLDS: Record<string, number> = {
  groundedness: 0.7, relevance: 0.6, safety: 0.8,
  tool_call_correctness: 0.7, latency: 0.6, format_compliance: 0.8,
  retry_loop: 0.5, evidence: 0.6,
};

const EVAL_LABELS: Record<string, string> = {
  groundedness: "Groundedness", relevance: "Relevance", safety: "Safety",
  tool_call_correctness: "Tool correctness", latency: "Latency",
  format_compliance: "Format", retry_loop: "Retry loop",
  evidence: "Evidence", llm_judge: "LLM Judge",
};

function isPassing(evaluator: string, score: number | undefined): boolean {
  if (score == null) return false;
  return score >= (PASS_THRESHOLDS[evaluator] ?? 0.5);
}

function MiniScoreBar({ score, evaluator }: { score: number | undefined; evaluator: string }) {
  if (score == null) return <span className="text-xs" style={{ color: "var(--muted)" }}>—</span>;
  const pct = Math.round(score * 100);
  const passing = isPassing(evaluator, score);
  const barColor = passing ? "#22c55e" : "#ef4444";
  const textColor = passing ? "#4ade80" : "#f87171";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border-bright)" }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: barColor }} />
      </div>
      <span className="mono text-xs w-8" style={{ color: textColor }}>{pct}%</span>
      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{
        background: passing ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
        color: passing ? "#4ade80" : "#f87171",
        border: `1px solid ${passing ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
      }}>
        {passing ? "PASS" : "FAIL"}
      </span>
    </div>
  );
}

function DeltaBadge({ delta }: { delta: number | undefined }) {
  if (delta == null) return <span style={{ color: "var(--muted)" }} className="text-xs">—</span>;
  const pct = Math.round(delta * 100);
  if (Math.abs(pct) < 1) return <span className="text-xs" style={{ color: "var(--muted)" }}>no change</span>;
  return (
    <span className="mono font-bold text-sm" style={{ color: pct > 0 ? "#4ade80" : "#f87171" }}>
      {pct > 0 ? "↑ +" : "↓ "}{pct}%
    </span>
  );
}

export function ReplayPanel({ runId, comparison }: Props) {
  const [promptOverride, setPromptOverride] = useState("");
  const [modelName, setModelName] = useState("");
  const [strictness, setStrictness] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [replayId, setReplayId] = useState<string | null>(null);
  const [freshComparison, setFreshComparison] = useState<ReplayComparison | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const activeComparison = freshComparison ?? comparison;
  const apiKey = process.env.NEXT_PUBLIC_API_KEY ?? "dev-api-key-change-in-production";
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

  async function handleReplay() {
    setStatus("loading");
    setErrorMsg("");
    setFreshComparison(null);
    try {
      const res = await fetch(`${apiBase}/api/runs/${runId}/replay`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({
          model_name: modelName || undefined,
          prompt_override: promptOverride || undefined,
          guardrail_strictness: strictness || undefined,
          disabled_tools: [],
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setReplayId(data.replay_run_id);
      const cmpRes = await fetch(`${apiBase}/api/runs/${runId}/replay/comparison`, {
        headers: { "X-API-Key": apiKey },
      });
      if (cmpRes.ok) setFreshComparison(await cmpRes.json());
      setStatus("done");
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Replay failed");
      setStatus("error");
    }
  }

  const evaluatorKeys = activeComparison
    ? Object.keys({ ...activeComparison.original_scores, ...activeComparison.replay_scores })
    : [];

  const improvements = evaluatorKeys.filter((k) => (activeComparison?.score_delta?.[k] ?? 0) > 0.05).length;
  const regressions  = evaluatorKeys.filter((k) => (activeComparison?.score_delta?.[k] ?? 0) < -0.05).length;

  return (
    <div className="space-y-5">
      {/* Config inputs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="section-label mb-1.5 block">Model override</label>
          <input value={modelName} onChange={(e) => setModelName(e.target.value)}
            placeholder="e.g. gpt-4o" className="field" />
        </div>
        <div>
          <label className="section-label mb-1.5 block">Guardrail strictness</label>
          <select value={strictness} onChange={(e) => setStrictness(e.target.value)} className="field">
            <option value="">Default</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div>
          <label className="section-label mb-1.5 block">Prompt override</label>
          <input value={promptOverride} onChange={(e) => setPromptOverride(e.target.value)}
            placeholder="Require stricter evidence..." className="field" />
        </div>
      </div>

      {/* Action row */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={handleReplay} disabled={status === "loading"} className="btn-primary">
          {status === "loading" ? (
            <>
              <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
              Running replay...
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <polygon points="2,1 11,6 2,11" fill="white"/>
              </svg>
              Replay run
            </>
          )}
        </button>
        {status === "done" && replayId && (
          <Link href={`/runs/${replayId}`} className="text-sm hover:underline" style={{ color: "var(--accent)" }}>
            View replay run →
          </Link>
        )}
        {status === "error" && <span className="text-red-400 text-sm">{errorMsg}</span>}
      </div>

      {/* Comparison table */}
      {activeComparison && evaluatorKeys.length > 0 && (
        <div className="pt-4 space-y-4" style={{ borderTop: "1px solid var(--border)" }}>
          {/* Summary */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-semibold text-white">Score comparison</span>
            <div className="flex gap-2 ml-auto">
              {improvements > 0 && (
                <span className="text-xs px-2 py-0.5 rounded" style={{
                  background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)", color: "#4ade80",
                }}>
                  ↑ {improvements} improved
                </span>
              )}
              {regressions > 0 && (
                <span className="text-xs px-2 py-0.5 rounded" style={{
                  background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171",
                }}>
                  ↓ {regressions} regressed
                </span>
              )}
            </div>
          </div>

          {/* Column headers */}
          <div className="grid gap-x-4 text-xs pb-2" style={{
            gridTemplateColumns: "1fr 160px 80px 160px",
            color: "var(--muted)",
            borderBottom: "1px solid var(--border)",
          }}>
            <div className="section-label">Evaluator</div>
            <div className="section-label">Original</div>
            <div className="section-label">Delta</div>
            <div className="section-label">Replay</div>
          </div>

          {/* Evaluator rows */}
          <div className="space-y-3">
            {evaluatorKeys.map((k) => (
              <div key={k} className="grid gap-x-4 items-center" style={{ gridTemplateColumns: "1fr 160px 80px 160px" }}>
                <div className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.8)" }}>
                  {EVAL_LABELS[k] ?? k.replace(/_/g, " ")}
                </div>
                <MiniScoreBar score={activeComparison.original_scores[k]} evaluator={k} />
                <DeltaBadge delta={activeComparison.score_delta[k]} />
                <MiniScoreBar score={activeComparison.replay_scores[k]} evaluator={k} />
              </div>
            ))}
          </div>

          {/* Latency row */}
          {activeComparison.original_latency_ms != null && (
            <div className="pt-3" style={{ borderTop: "1px solid var(--border)" }}>
              <div className="grid gap-x-4 items-center" style={{ gridTemplateColumns: "1fr 160px 80px 160px" }}>
                <div className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.8)" }}>Latency</div>
                <div className="mono text-xs" style={{ color: "var(--muted-bright)" }}>{activeComparison.original_latency_ms}ms</div>
                <div>
                  {activeComparison.latency_delta_ms != null && (
                    <span className="mono font-bold text-sm" style={{
                      color: activeComparison.latency_delta_ms < 0 ? "#4ade80" : "#f87171",
                    }}>
                      {activeComparison.latency_delta_ms < 0 ? "↓ " : "↑ "}
                      {Math.abs(activeComparison.latency_delta_ms)}ms
                    </span>
                  )}
                </div>
                <div className="mono text-xs" style={{ color: "var(--muted-bright)" }}>{activeComparison.replay_latency_ms}ms</div>
              </div>
            </div>
          )}

          {/* Status row */}
          <div className="pt-3" style={{ borderTop: "1px solid var(--border)" }}>
            <div className="grid gap-x-4 items-center" style={{ gridTemplateColumns: "1fr 160px 80px 160px" }}>
              <div className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.8)" }}>Status</div>
              <span className="badge" style={{
                background: activeComparison.original_status === "success" ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                color: activeComparison.original_status === "success" ? "#4ade80" : "#f87171",
                border: `1px solid ${activeComparison.original_status === "success" ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
              }}>
                {activeComparison.original_status}
              </span>
              <span className="text-xs" style={{ color: "var(--muted)" }}>→</span>
              <span className="badge" style={{
                background: ["success","replayed"].includes(activeComparison.replay_status) ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                color: ["success","replayed"].includes(activeComparison.replay_status) ? "#4ade80" : "#f87171",
                border: `1px solid ${["success","replayed"].includes(activeComparison.replay_status) ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
              }}>
                {activeComparison.replay_status}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
