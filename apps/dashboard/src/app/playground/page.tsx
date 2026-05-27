"use client";
import { useState } from "react";
import Link from "next/link";

const DEFAULT_INCIDENT =
  "Checkout latency increased from 200ms to 2.4s after deployment v42. Investigate the root cause.";

interface TraceEntry {
  id: number;
  event_type: string;
  name: string;
  status: "success" | "error" | "pending";
  latency_ms?: number;
}

interface EvalScore { name: string; score: number; passed: boolean }
interface RunResult { run_id: string; final_output: string; confidence: number; evals: EvalScore[] }

const EVENT_META: Record<string, { color: string; dot: string }> = {
  agent_start:      { color: "#818cf8", dot: "#6366f1" },
  planner_decision: { color: "#a78bfa", dot: "#8b5cf6" },
  retrieval:        { color: "#4ade80", dot: "#22c55e" },
  tool_call:        { color: "#34d399", dot: "#10b981" },
  guardrail_check:  { color: "#fbbf24", dot: "#f59e0b" },
  agent_end:        { color: "#4ade80", dot: "#22c55e" },
  model_call:       { color: "#60a5fa", dot: "#3b82f6" },
};

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export default function PlaygroundPage() {
  const [incident, setIncident] = useState(DEFAULT_INCIDENT);
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [phase, setPhase] = useState<"idle" | "running" | "evaluating" | "done" | "error">("idle");
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState("");
  const [counter, setCounter] = useState(0);

  function addEntry(entry: Omit<TraceEntry, "id">) {
    setCounter((c) => {
      const id = c + 1;
      setTrace((prev) => [...prev, { ...entry, id }]);
      return id;
    });
  }

  async function runDemo() {
    setPhase("running");
    setTrace([]);
    setResult(null);
    setError("");
    setCounter(0);

    const apiKey = process.env.NEXT_PUBLIC_API_KEY ?? "dev-api-key-change-in-production";
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    const headers = { "Content-Type": "application/json", "X-API-Key": apiKey };
    const post = (path: string, body: object) =>
      fetch(`${apiUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body) });

    try {
      const proj = await (await post("/api/projects", { name: "Playground", description: "Demo run" })).json();
      const agent = await (await post("/api/agents", {
        project_id: proj.id, name: "Playground Agent",
        framework: "Custom", model_provider: "Rule-based", model_name: "demo-v1",
      })).json();

      const run = await (await post("/api/runs/start", { project_id: proj.id, agent_id: agent.id, input: incident })).json();
      const runId: string = run.id;

      addEntry({ event_type: "agent_start", name: "run started", status: "success" });
      await sleep(350);

      type EventBody = { event_type: string; name: string; latency_ms?: number; status?: string; [key: string]: unknown };
      const sendEvent = async (body: EventBody) => {
        const res = await post(`/api/runs/${runId}/events`, body);
        if (!res.ok) throw new Error(await res.text());
        addEntry({
          event_type: body.event_type,
          name: body.name,
          status: (body.status as TraceEntry["status"]) ?? "success",
          latency_ms: body.latency_ms,
        });
        await sleep(480);
      };

      await sendEvent({ event_type: "agent_start", name: "incident_planner", latency_ms: 80 });
      await sendEvent({ event_type: "planner_decision", name: "plan", latency_ms: 120,
        output: { steps: ["search_logs", "check_metrics", "get_deployment_config", "verify_hypothesis"] } });
      await sendEvent({ event_type: "retrieval", name: "search_logs", latency_ms: 320,
        output: simulateFailure
          ? { hits: 0, query: "checkout latency error", total_searched: 150 }
          : { hits: 8, results: [{ level: "ERROR", message: "DB connection pool exhausted" }], total_searched: 150 } });
      await sendEvent({ event_type: "tool_call", name: "check_metrics", latency_ms: 150,
        output: { latest_latency_ms: 2450, trend: "increasing" } });
      await sendEvent({ event_type: "retrieval", name: "get_deployment_config", latency_ms: 90,
        output: { version: "v42", changes: [{ key: "db.connection_pool.max_size", old: 50, new: 10 }] } });
      await sendEvent({ event_type: "guardrail_check", name: "evidence_sufficiency", latency_ms: 30,
        output: { sufficient: !simulateFailure, evidence_items: simulateFailure ? 0 : 3 },
        status: simulateFailure ? "error" : "success",
        error_message: simulateFailure ? "Insufficient evidence" : null });
      await sendEvent({ event_type: "tool_call", name: "verify_hypothesis", latency_ms: 280,
        output: { confidence: simulateFailure ? 0.32 : 0.87, verdict: simulateFailure ? "weak" : "supported" } });
      await sendEvent({ event_type: "agent_end", name: "final_answer", latency_ms: 50 });

      const finalOutput = simulateFailure
        ? "Investigation inconclusive. Evidence insufficient to confirm root cause. Recommend gathering more log data."
        : "Root cause: DB connection pool exhaustion triggered by deployment v42. v42 reduced max_size from 50 to 10, causing connection timeouts under normal load. Recommendation: Increase pool size (>= 30) and revert timeout to 5000ms.";
      const confidence = simulateFailure ? 0.32 : 0.87;

      await post(`/api/runs/${runId}/end`, {
        final_output: finalOutput,
        status: simulateFailure ? "failed" : "success",
        confidence_score: confidence,
        total_tokens: simulateFailure ? 320 : 850,
        estimated_cost_usd: simulateFailure ? 0.0006 : 0.0017,
      });

      setPhase("evaluating");
      addEntry({ event_type: "model_call", name: "evaluating...", status: "pending" });
      await sleep(400);

      const evalRes = await post(`/api/runs/${runId}/evaluate`, {});
      const evals: Array<{ evaluator_name: string; score: number; passed: boolean }> = await evalRes.json();

      setTrace((prev) => prev.filter((e) => e.name !== "evaluating..."));
      setResult({
        run_id: runId,
        final_output: finalOutput,
        confidence,
        evals: evals.map((e) => ({ name: e.evaluator_name, score: e.score, passed: e.passed })),
      });
      setPhase("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setPhase("error");
    }
  }

  const isRunning = phase === "running" || phase === "evaluating";

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Playground</h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
          Run a live demo agent and watch AgentOps Radar capture every step in real time.
        </p>
      </div>

      {/* Controls */}
      <div className="card space-y-4">
        <div>
          <label className="section-label mb-2 block">Incident description</label>
          <textarea
            value={incident}
            onChange={(e) => setIncident(e.target.value)}
            rows={3}
            disabled={isRunning}
            className="field resize-none"
            placeholder="Describe the incident to investigate..."
          />
        </div>

        <label className="flex items-center gap-2.5 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={simulateFailure}
            onChange={(e) => setSimulateFailure(e.target.checked)}
            disabled={isRunning}
            className="accent-indigo-500 w-3.5 h-3.5"
          />
          <span style={{ color: "var(--muted-bright)" }}>
            Simulate failure path{" "}
            <span className="text-xs" style={{ color: "var(--muted)" }}>(weak evidence, low confidence)</span>
          </span>
        </label>

        <button onClick={runDemo} disabled={isRunning} className="btn-primary">
          {isRunning ? (
            <>
              <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
              {phase === "evaluating" ? "Evaluating..." : "Running agent..."}
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <polygon points="2,1 11,6 2,11" fill="white"/>
              </svg>
              Run demo agent
            </>
          )}
        </button>
      </div>

      {/* Live trace */}
      {trace.length > 0 && (
        <div className="card" style={{ background: "rgba(0,0,0,0.3)" }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="section-label">Live trace</div>
            {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />}
          </div>
          <div className="space-y-1.5">
            {trace.map((entry) => {
              const meta = EVENT_META[entry.event_type] ?? { color: "rgba(255,255,255,0.5)", dot: "#6b7280" };
              return (
                <div key={entry.id} className="flex items-center gap-3 text-xs">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{
                    background: entry.status === "error" ? "#ef4444"
                      : entry.status === "pending" ? "#4b5563"
                      : meta.dot,
                  }} />
                  <span className="w-28 shrink-0 font-medium" style={{ color: meta.color }}>
                    {entry.event_type}
                  </span>
                  <span className="flex-1 mono" style={{ color: "rgba(255,255,255,0.7)" }}>
                    {entry.name}
                  </span>
                  {entry.latency_ms != null && (
                    <span className="mono" style={{ color: "var(--muted)" }}>{entry.latency_ms}ms</span>
                  )}
                  <span style={{
                    color: entry.status === "success" ? "#4ade80"
                      : entry.status === "error" ? "#f87171"
                      : "var(--muted)",
                  }}>
                    {entry.status === "success" ? "✓" : entry.status === "error" ? "✗" : "..."}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Result */}
      {phase === "done" && result && (
        <div className="card space-y-4" style={{ borderColor: "rgba(99,102,241,0.3)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-sm font-semibold text-white">Run complete</span>
            </div>
            <Link href={`/runs/${result.run_id}`} className="text-xs hover:underline" style={{ color: "var(--accent)" }}>
              View full trace →
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="section-label mb-1">Run ID</div>
              <div className="mono text-xs" style={{ color: "rgba(255,255,255,0.65)" }}>{result.run_id.slice(0, 18)}...</div>
            </div>
            <div>
              <div className="section-label mb-1">Confidence</div>
              <div className={`mono font-bold text-lg ${result.confidence >= 0.6 ? "text-green-400" : "text-red-400"}`}>
                {(result.confidence * 100).toFixed(0)}%
              </div>
            </div>
          </div>

          <div>
            <div className="section-label mb-1.5">Agent output</div>
            <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.8)" }}>{result.final_output}</p>
          </div>

          {result.evals.length > 0 && (
            <div>
              <div className="section-label mb-3">Evaluation scores</div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                {result.evals.map((ev) => (
                  <div key={ev.name} className="flex items-center gap-2 text-xs">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: ev.passed ? "#4ade80" : "#f87171" }} />
                    <span className="flex-1 capitalize" style={{ color: "rgba(255,255,255,0.65)" }}>
                      {ev.name.replace(/_/g, " ")}
                    </span>
                    <span className="mono" style={{ color: ev.passed ? "#4ade80" : "#f87171" }}>
                      {(ev.score * 100).toFixed(0)}%
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{
                      background: ev.passed ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                      color: ev.passed ? "#4ade80" : "#f87171",
                    }}>
                      {ev.passed ? "PASS" : "FAIL"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {phase === "error" && (
        <div className="card" style={{ borderColor: "rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.05)" }}>
          <div className="text-red-400 font-medium text-sm mb-1">Error</div>
          <div className="text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>{error}</div>
          <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            Make sure the API is running at {process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}
          </div>
        </div>
      )}
    </div>
  );
}
