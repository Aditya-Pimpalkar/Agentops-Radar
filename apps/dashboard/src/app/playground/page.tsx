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
  detail?: string;
}

interface EvalScore {
  name: string;
  score: number;
  passed: boolean;
}

interface RunResult {
  run_id: string;
  final_output: string;
  confidence: number;
  evals: EvalScore[];
}

const EVENT_TYPE_ICON: Record<string, string> = {
  agent_start: "🤖",
  planner_decision: "🗺",
  retrieval: "🔍",
  tool_call: "🔧",
  guardrail_check: "🛡",
  agent_end: "✅",
  model_call: "💬",
};

const EVENT_TYPE_COLOR: Record<string, string> = {
  agent_start: "text-blue-400",
  planner_decision: "text-purple-400",
  retrieval: "text-yellow-400",
  tool_call: "text-cyan-400",
  guardrail_check: "text-orange-400",
  agent_end: "text-green-400",
  model_call: "text-indigo-400",
};

export default function PlaygroundPage() {
  const [incident, setIncident] = useState(DEFAULT_INCIDENT);
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [phase, setPhase] = useState<"idle" | "running" | "evaluating" | "done" | "error">("idle");
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState("");
  const [entryCounter, setEntryCounter] = useState(0);

  function addEntry(entry: Omit<TraceEntry, "id">) {
    setEntryCounter((c) => {
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
    setEntryCounter(0);

    const apiKey = process.env.NEXT_PUBLIC_API_KEY ?? "dev-api-key-change-in-production";
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

    const headers = { "Content-Type": "application/json", "X-API-Key": apiKey };
    const post = (path: string, body: object) =>
      fetch(`${apiUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body) });

    try {
      // Bootstrap project + agent
      const proj = await (await post("/api/projects", { name: "Playground", description: "Demo run" })).json();
      const agent = await (
        await post("/api/agents", {
          project_id: proj.id,
          name: "Playground Agent",
          framework: "Custom",
          model_provider: "Rule-based",
          model_name: "demo-v1",
        })
      ).json();

      // Start run
      const run = await (
        await post("/api/runs/start", { project_id: proj.id, agent_id: agent.id, input: incident })
      ).json();
      const runId: string = run.id;

      addEntry({ event_type: "agent_start", name: "run started", status: "success", detail: `run_id: ${runId.slice(0, 8)}…` });
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
        await sleep(480);  // ≤500ms between events — live feel
      };

      await sendEvent({ event_type: "agent_start", name: "incident_planner", latency_ms: 80, status: "success" });

      await sendEvent({
        event_type: "planner_decision",
        name: "plan",
        output: { steps: ["search_logs", "check_metrics", "get_deployment_config", "verify_hypothesis"] },
        latency_ms: 120,
        status: "success",
      });

      await sendEvent({
        event_type: "retrieval",
        name: "search_logs",
        output: simulateFailure
          ? { hits: 0, results: [], query: "checkout latency error", total_searched: 150 }
          : { hits: 8, results: [{ level: "ERROR", message: "DB connection pool exhausted" }], total_searched: 150 },
        latency_ms: 320,
        status: "success",
      });

      await sendEvent({
        event_type: "tool_call",
        name: "check_metrics",
        output: { latest_latency_ms: 2450, trend: "increasing" },
        latency_ms: 150,
        status: "success",
      });

      await sendEvent({
        event_type: "retrieval",
        name: "get_deployment_config",
        output: { version: "v42", changes: [{ key: "db.connection_pool.max_size", old: 50, new: 10 }] },
        latency_ms: 90,
        status: "success",
      });

      await sendEvent({
        event_type: "guardrail_check",
        name: "evidence_sufficiency",
        output: { sufficient: !simulateFailure, evidence_items: simulateFailure ? 0 : 3 },
        latency_ms: 30,
        status: simulateFailure ? "error" : "success",
        error_message: simulateFailure ? "Insufficient evidence" : null,
      });

      await sendEvent({
        event_type: "tool_call",
        name: "verify_hypothesis",
        output: {
          confidence: simulateFailure ? 0.32 : 0.87,
          verdict: simulateFailure ? "weak" : "supported",
        },
        latency_ms: 280,
        status: "success",
      });

      await sendEvent({ event_type: "agent_end", name: "final_answer", latency_ms: 50, status: "success" });

      // End run
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

      // Evaluate
      setPhase("evaluating");
      addEntry({ event_type: "model_call", name: "evaluating…", status: "pending" });
      await sleep(400);

      const evalRes = await post(`/api/runs/${runId}/evaluate`, {});
      const evals: Array<{ evaluator_name: string; score: number; passed: boolean }> = await evalRes.json();

      setTrace((prev) => prev.filter((e) => e.name !== "evaluating…"));

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
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Playground</h1>
        <p className="text-radar-muted text-sm mt-1">
          Run the demo incident investigation agent and watch AgentOps Radar capture every event in real time.
        </p>
      </div>

      {/* Controls */}
      <div className="card space-y-4">
        <div>
          <label className="text-xs text-radar-muted mb-2 block uppercase tracking-widest">Incident Input</label>
          <textarea
            value={incident}
            onChange={(e) => setIncident(e.target.value)}
            rows={3}
            disabled={isRunning}
            className="w-full bg-black/30 border border-radar-border rounded px-3 py-2 text-sm text-white placeholder-radar-muted focus:outline-none focus:border-radar-accent resize-none disabled:opacity-50"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-radar-muted cursor-pointer">
          <input
            type="checkbox"
            checked={simulateFailure}
            onChange={(e) => setSimulateFailure(e.target.checked)}
            disabled={isRunning}
            className="accent-radar-accent"
          />
          Simulate failure path (weak evidence, low confidence)
        </label>

        <button
          onClick={runDemo}
          disabled={isRunning}
          className="flex items-center gap-2 px-5 py-2 bg-radar-accent text-white rounded text-sm hover:bg-radar-accent/80 disabled:opacity-50 transition-colors"
        >
          {isRunning ? (
            <><span className="animate-spin inline-block">↺</span> {phase === "evaluating" ? "Evaluating…" : "Running agent…"}</>
          ) : (
            "▷ Run Demo Agent"
          )}
        </button>
      </div>

      {/* Live trace */}
      {trace.length > 0 && (
        <div className="card bg-black/40 space-y-0.5">
          <div className="text-xs text-radar-muted uppercase tracking-widest mb-3 flex items-center gap-2">
            Live Trace
            {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-radar-accent animate-pulse inline-block" />}
          </div>
          <div className="space-y-1">
            {trace.map((entry) => (
              <div
                key={entry.id}
                className="flex items-start gap-2 font-mono text-xs py-0.5 transition-opacity duration-200"
              >
                <span className="w-5 flex-shrink-0 text-center">
                  {EVENT_TYPE_ICON[entry.event_type] ?? "◆"}
                </span>
                <span className={`font-semibold flex-shrink-0 w-32 ${EVENT_TYPE_COLOR[entry.event_type] ?? "text-white/60"}`}>
                  {entry.event_type}
                </span>
                <span className="text-white/80 flex-1">{entry.name}</span>
                {entry.latency_ms !== undefined && (
                  <span className="text-radar-muted">{entry.latency_ms}ms</span>
                )}
                <span
                  className={
                    entry.status === "success"
                      ? "text-green-400"
                      : entry.status === "error"
                      ? "text-red-400"
                      : "text-radar-muted animate-pulse"
                  }
                >
                  {entry.status === "success" ? "✓" : entry.status === "error" ? "✗" : "…"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {phase === "done" && result && (
        <div className="card border-green-900/40 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs text-green-400 uppercase tracking-widest">Run Complete</div>
            <Link
              href={`/runs/${result.run_id}`}
              className="text-radar-accent text-xs hover:underline"
            >
              View full trace →
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-radar-muted block mb-0.5">Run ID</span>
              <span className="font-mono text-white/70">{result.run_id.slice(0, 16)}…</span>
            </div>
            <div>
              <span className="text-radar-muted block mb-0.5">Confidence</span>
              <span className={result.confidence >= 0.6 ? "text-green-400 font-bold" : "text-red-400 font-bold"}>
                {(result.confidence * 100).toFixed(0)}%
              </span>
            </div>
          </div>

          <div>
            <span className="text-radar-muted text-xs block mb-1">Final Output</span>
            <p className="text-white/80 text-sm leading-relaxed">{result.final_output}</p>
          </div>

          {result.evals.length > 0 && (
            <div>
              <div className="text-xs text-radar-muted uppercase tracking-widest mb-2">Evaluation Scores</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {result.evals.map((ev) => (
                  <div key={ev.name} className="flex items-center gap-2 text-xs">
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${ev.passed ? "bg-green-400" : "bg-red-400"}`}
                    />
                    <span className="text-white/60 flex-1 capitalize">{ev.name}</span>
                    <span className={ev.passed ? "text-green-400 tabular-nums" : "text-red-400 tabular-nums"}>
                      {(ev.score * 100).toFixed(0)}%
                    </span>
                    <span className={`text-[10px] px-1 rounded ${ev.passed ? "bg-green-900/40 text-green-400" : "bg-red-900/40 text-red-400"}`}>
                      {ev.passed ? "PASS" : "FAIL"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {phase === "error" && (
        <div className="card border-red-900/40">
          <div className="text-red-400 text-sm">Error: {error}</div>
          <div className="text-radar-muted text-xs mt-1">Make sure the API is running at {process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}</div>
        </div>
      )}
    </div>
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
