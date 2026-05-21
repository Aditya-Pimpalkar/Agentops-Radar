"use client";
import { useState } from "react";
import Link from "next/link";
import type { ReplayComparison } from "@/types";

interface Props {
  runId: string;
  comparison: ReplayComparison | null;
}

const PASS_THRESHOLDS: Record<string, number> = {
  groundedness: 0.7,
  relevance: 0.6,
  safety: 0.8,
  tool_call_correctness: 0.7,
  latency: 0.6,
  format_compliance: 0.8,
  retry_loop: 0.5,
  evidence: 0.6,
};

function isPassing(evaluator: string, score: number | undefined): boolean {
  if (score === undefined || score === null) return false;
  return score >= (PASS_THRESHOLDS[evaluator] ?? 0.5);
}

function ScoreBar({ score, evaluator }: { score: number | undefined; evaluator: string }) {
  if (score === undefined || score === null) {
    return <div className="text-radar-muted text-xs">—</div>;
  }
  const pct = Math.round(score * 100);
  const passing = isPassing(evaluator, score);
  const barColor = passing ? "bg-green-500" : "bg-red-500";
  const textColor = passing ? "text-green-400" : "text-red-400";
  const badgeClass = passing
    ? "bg-green-900/50 text-green-400 border border-green-800/50"
    : "bg-red-900/50 text-red-400 border border-red-800/50";

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className={`font-bold text-sm tabular-nums ${textColor}`}>{pct}%</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${badgeClass}`}>
          {passing ? "PASS" : "FAIL"}
        </span>
      </div>
      <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function DeltaBadge({ delta }: { delta: number | undefined }) {
  if (delta === undefined || delta === null) return <span className="text-radar-muted">—</span>;
  const pct = Math.round(delta * 100);
  if (pct === 0) return <span className="text-radar-muted text-xs">no change</span>;
  const positive = pct > 0;
  return (
    <span
      className={`font-bold text-base tabular-nums ${positive ? "text-green-400" : "text-red-400"}`}
    >
      {positive ? "↑" : "↓"} {positive ? "+" : ""}{pct}%
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
  const [error, setError] = useState("");

  const activeComparison = freshComparison ?? comparison;
  const apiKey = process.env.NEXT_PUBLIC_API_KEY ?? "dev-api-key-change-in-production";
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

  async function handleReplay() {
    setStatus("loading");
    setError("");
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

      // Fetch comparison immediately
      const cmpRes = await fetch(`${apiBase}/api/runs/${runId}/replay/comparison`, {
        headers: { "X-API-Key": apiKey },
      });
      if (cmpRes.ok) {
        setFreshComparison(await cmpRes.json());
      }
      setStatus("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Replay failed");
      setStatus("error");
    }
  }

  const evaluatorKeys = activeComparison
    ? Object.keys({ ...activeComparison.original_scores, ...activeComparison.replay_scores })
    : [];

  // Calculate overall improvement
  const improvements = evaluatorKeys.filter((k) => {
    const d = activeComparison?.score_delta?.[k];
    return d !== undefined && d > 0.05;
  }).length;
  const regressions = evaluatorKeys.filter((k) => {
    const d = activeComparison?.score_delta?.[k];
    return d !== undefined && d < -0.05;
  }).length;

  return (
    <div className="space-y-5">
      {/* Config row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-radar-muted mb-1 block">Model Override</label>
          <input
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            placeholder="e.g. gpt-4o"
            className="w-full bg-black/30 border border-radar-border rounded px-3 py-2 text-sm text-white placeholder-radar-muted focus:outline-none focus:border-radar-accent"
          />
        </div>
        <div>
          <label className="text-xs text-radar-muted mb-1 block">Guardrail Strictness</label>
          <select
            value={strictness}
            onChange={(e) => setStrictness(e.target.value)}
            className="w-full bg-black/30 border border-radar-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-radar-accent"
          >
            <option value="">Default</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-radar-muted mb-1 block">Prompt Override</label>
          <input
            value={promptOverride}
            onChange={(e) => setPromptOverride(e.target.value)}
            placeholder="Use strict evidence validation…"
            className="w-full bg-black/30 border border-radar-border rounded px-3 py-2 text-sm text-white placeholder-radar-muted focus:outline-none focus:border-radar-accent"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleReplay}
          disabled={status === "loading"}
          className="px-4 py-2 bg-radar-accent text-white rounded text-sm hover:bg-radar-accent/80 disabled:opacity-50 transition-colors"
        >
          {status === "loading" ? (
            <><span className="animate-spin inline-block mr-1">↺</span>Running replay…</>
          ) : (
            "▷ Replay Run"
          )}
        </button>
        {status === "done" && replayId && (
          <Link href={`/runs/${replayId}`} className="text-radar-accent text-sm hover:underline">
            View replay run →
          </Link>
        )}
        {status === "error" && <span className="text-red-400 text-sm">{error}</span>}
      </div>

      {/* Comparison table */}
      {activeComparison && evaluatorKeys.length > 0 && (
        <div className="mt-2 pt-4 border-t border-radar-border space-y-4">
          {/* Summary banner */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-xs text-radar-muted uppercase tracking-widest">Replay Comparison</div>
            <div className="ml-auto flex gap-2 text-xs">
              {improvements > 0 && (
                <span className="px-2 py-0.5 rounded bg-green-900/40 border border-green-800/40 text-green-400">
                  ↑ {improvements} improved
                </span>
              )}
              {regressions > 0 && (
                <span className="px-2 py-0.5 rounded bg-red-900/40 border border-red-800/40 text-red-400">
                  ↓ {regressions} regressed
                </span>
              )}
            </div>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-[1fr_140px_80px_140px] gap-x-3 text-[10px] text-radar-muted uppercase tracking-widest pb-1 border-b border-radar-border/50">
            <div>Evaluator</div>
            <div>Original</div>
            <div>Delta</div>
            <div>Replay</div>
          </div>

          {/* Rows */}
          <div className="space-y-3">
            {evaluatorKeys.map((k) => {
              const orig = activeComparison.original_scores[k];
              const rpl = activeComparison.replay_scores[k];
              const delta = activeComparison.score_delta[k];
              return (
                <div key={k} className="grid grid-cols-[1fr_140px_80px_140px] gap-x-3 items-center">
                  <div className="text-white/80 text-xs capitalize font-medium">{k.replace(/_/g, " ")}</div>
                  <ScoreBar score={orig} evaluator={k} />
                  <DeltaBadge delta={delta} />
                  <ScoreBar score={rpl} evaluator={k} />
                </div>
              );
            })}
          </div>

          {/* Latency row */}
          {activeComparison.latency_delta_ms !== null &&
            activeComparison.original_latency_ms !== null && (
            <div className="pt-3 border-t border-radar-border/50">
              <div className="grid grid-cols-[1fr_140px_80px_140px] gap-x-3 items-center">
                <div className="text-white/80 text-xs font-medium">latency</div>
                <div className="text-white/60 text-xs tabular-nums">{activeComparison.original_latency_ms}ms</div>
                <div>
                  {activeComparison.latency_delta_ms !== null && (
                    <span
                      className={`font-bold text-sm tabular-nums ${
                        activeComparison.latency_delta_ms < 0 ? "text-green-400" : "text-red-400"
                      }`}
                    >
                      {activeComparison.latency_delta_ms < 0 ? "↓" : "↑"}{" "}
                      {Math.abs(activeComparison.latency_delta_ms)}ms
                    </span>
                  )}
                </div>
                <div className="text-white/60 text-xs tabular-nums">{activeComparison.replay_latency_ms}ms</div>
              </div>
            </div>
          )}

          {/* Status row */}
          <div className="pt-3 border-t border-radar-border/50">
            <div className="grid grid-cols-[1fr_140px_80px_140px] gap-x-3 items-center">
              <div className="text-white/80 text-xs font-medium">status</div>
              <div>
                <span
                  className={`text-xs px-2 py-0.5 rounded font-medium ${
                    activeComparison.original_status === "success"
                      ? "bg-green-900/40 text-green-400"
                      : "bg-red-900/40 text-red-400"
                  }`}
                >
                  {activeComparison.original_status}
                </span>
              </div>
              <div className="text-radar-muted text-xs">→</div>
              <div>
                <span
                  className={`text-xs px-2 py-0.5 rounded font-medium ${
                    activeComparison.replay_status === "success" || activeComparison.replay_status === "replayed"
                      ? "bg-green-900/40 text-green-400"
                      : "bg-red-900/40 text-red-400"
                  }`}
                >
                  {activeComparison.replay_status}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
