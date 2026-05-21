"use client";
import { useState } from "react";
import type { TraceEvent } from "@/types";

const EVENT_ICONS: Record<string, string> = {
  agent_start: "▶",
  agent_end: "■",
  planner_decision: "⋮",
  model_call: "◇",
  tool_call: "⚙",
  retrieval: "⊕",
  guardrail_check: "⊗",
  retry: "↺",
  error: "✕",
  evaluator_result: "✓",
};

const EVENT_COLORS: Record<string, string> = {
  agent_start: "#6366f1",
  agent_end: "#6366f1",
  planner_decision: "#a78bfa",
  model_call: "#60a5fa",
  tool_call: "#34d399",
  retrieval: "#22c55e",
  guardrail_check: "#f59e0b",
  retry: "#f97316",
  error: "#ef4444",
  evaluator_result: "#4ade80",
};

export function TraceTimeline({ events }: { events: TraceEvent[] }) {
  const [selected, setSelected] = useState<TraceEvent | null>(null);

  if (!events.length) {
    return <div className="text-radar-muted text-sm text-center py-6">No trace events</div>;
  }

  return (
    <div className="flex gap-4">
      <div className="flex-1 space-y-1 overflow-y-auto max-h-[400px]">
        {events.map((e, i) => {
          const color = EVENT_COLORS[e.event_type] ?? "#6b7280";
          const icon = EVENT_ICONS[e.event_type] ?? "·";
          const isError = e.status === "error";
          return (
            <button
              key={e.id}
              onClick={() => setSelected(selected?.id === e.id ? null : e)}
              className={[
                "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm transition-colors",
                selected?.id === e.id ? "bg-radar-accent/10 border border-radar-accent/30" : "hover:bg-white/[0.03]",
                isError ? "border border-red-900/40" : "",
              ].join(" ")}
            >
              <span className="text-xs w-6 shrink-0" style={{ color }}>{icon}</span>
              <span className="text-xs font-mono text-radar-muted w-4">{i + 1}</span>
              <span className="text-xs uppercase tracking-wider shrink-0" style={{ color, minWidth: 100 }}>
                {e.event_type}
              </span>
              <span className="text-white/70 truncate flex-1">{e.name || "—"}</span>
              {e.latency_ms && (
                <span className="text-radar-muted text-xs tabular-nums">{e.latency_ms}ms</span>
              )}
              {isError && <span className="badge badge-failed text-[10px]">error</span>}
            </button>
          );
        })}
      </div>
      {selected && (
        <div className="w-64 shrink-0 card border-radar-accent/20 max-h-[400px] overflow-y-auto">
          <div className="text-xs text-radar-muted uppercase tracking-widest mb-3">
            Event Detail
          </div>
          <div className="space-y-3 text-xs">
            <Row label="Type" value={selected.event_type} />
            <Row label="Name" value={selected.name ?? "—"} />
            <Row label="Status" value={selected.status} />
            {selected.latency_ms && <Row label="Latency" value={`${selected.latency_ms}ms`} />}
            {selected.error_message && (
              <div>
                <div className="text-red-400 mb-1">Error</div>
                <div className="text-red-300 bg-red-900/20 p-2 rounded font-mono break-all">
                  {selected.error_message}
                </div>
              </div>
            )}
            {selected.input && (
              <div>
                <div className="text-radar-muted mb-1">Input</div>
                <pre className="text-white/70 bg-black/30 p-2 rounded overflow-auto max-h-32 text-[10px]">
                  {JSON.stringify(selected.input, null, 2)}
                </pre>
              </div>
            )}
            {selected.output && (
              <div>
                <div className="text-radar-muted mb-1">Output</div>
                <pre className="text-white/70 bg-black/30 p-2 rounded overflow-auto max-h-32 text-[10px]">
                  {JSON.stringify(selected.output, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-radar-muted w-16 shrink-0">{label}</span>
      <span className="text-white/80 break-all">{value}</span>
    </div>
  );
}
