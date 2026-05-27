"use client";
import { useState } from "react";
import type { TraceEvent } from "@/types";

const EVENT_META: Record<string, { label: string; color: string; dot: string }> = {
  agent_start:      { label: "Agent start",     color: "#6366f1", dot: "#818cf8" },
  agent_end:        { label: "Agent end",       color: "#6366f1", dot: "#818cf8" },
  planner_decision: { label: "Plan",            color: "#a78bfa", dot: "#a78bfa" },
  model_call:       { label: "Model call",      color: "#60a5fa", dot: "#60a5fa" },
  tool_call:        { label: "Tool call",       color: "#34d399", dot: "#34d399" },
  retrieval:        { label: "Retrieval",       color: "#4ade80", dot: "#4ade80" },
  guardrail_check:  { label: "Guardrail",       color: "#f59e0b", dot: "#fbbf24" },
  guardrail:        { label: "Guardrail",       color: "#f59e0b", dot: "#fbbf24" },
  retry:            { label: "Retry",           color: "#f97316", dot: "#fb923c" },
  error:            { label: "Error",           color: "#ef4444", dot: "#f87171" },
  evaluator_result: { label: "Eval result",     color: "#4ade80", dot: "#4ade80" },
};

const DEFAULT_META = { label: "Event", color: "#6b7280", dot: "#9ca3af" };

function fmt(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (typeof val === "string") return val;
  return JSON.stringify(val, null, 2);
}

export function TraceTimeline({ events }: { events: TraceEvent[] }) {
  const [selected, setSelected] = useState<TraceEvent | null>(null);

  if (!events.length) {
    return (
      <div className="py-8 text-center text-sm" style={{ color: "var(--muted)" }}>
        No trace events recorded for this run.
      </div>
    );
  }

  return (
    <div className="flex gap-5">
      {/* Event list */}
      <div className="flex-1 space-y-0.5 overflow-y-auto" style={{ maxHeight: 420 }}>
        {events.map((e, i) => {
          const meta = EVENT_META[e.event_type] ?? DEFAULT_META;
          const isError = e.status === "error";
          const isSelected = selected?.id === e.id;

          return (
            <button
              key={e.id}
              onClick={() => setSelected(isSelected ? null : e)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors"
              style={{
                background: isSelected ? "rgba(99,102,241,0.08)" : "transparent",
                border: isSelected
                  ? "1px solid rgba(99,102,241,0.25)"
                  : isError
                  ? "1px solid rgba(239,68,68,0.2)"
                  : "1px solid transparent",
              }}
            >
              {/* Step number */}
              <span className="mono text-xs w-5 text-right shrink-0" style={{ color: "var(--muted)" }}>
                {i + 1}
              </span>

              {/* Colored dot */}
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: isError ? "#ef4444" : meta.dot }}
              />

              {/* Event type label */}
              <span className="text-xs font-medium shrink-0 w-24" style={{ color: meta.color }}>
                {meta.label}
              </span>

              {/* Event name */}
              <span className="text-sm truncate flex-1" style={{ color: "rgba(255,255,255,0.75)" }}>
                {e.name || "—"}
              </span>

              {/* Latency */}
              {e.latency_ms != null && (
                <span className="mono text-xs shrink-0" style={{ color: "var(--muted)" }}>
                  {e.latency_ms}ms
                </span>
              )}

              {/* Error badge */}
              {isError && (
                <span className="badge badge-failed text-[10px] shrink-0">error</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Detail panel */}
      {selected && (
        <div
          className="w-72 shrink-0 rounded-lg p-4 overflow-y-auto space-y-4"
          style={{
            maxHeight: 420,
            background: "rgba(0,0,0,0.25)",
            border: "1px solid var(--border-bright)",
          }}
        >
          <div>
            <div className="section-label mb-2">Event detail</div>
            <div className="space-y-2">
              <Row label="Type" value={(EVENT_META[selected.event_type]?.label ?? selected.event_type)} />
              <Row label="Name" value={selected.name ?? "—"} />
              <Row label="Status" value={selected.status} highlight={selected.status === "error" ? "red" : selected.status === "success" ? "green" : undefined} />
              {selected.latency_ms != null && (
                <Row label="Latency" value={`${selected.latency_ms}ms`} mono />
              )}
            </div>
          </div>

          {selected.error_message && (
            <div>
              <div className="text-xs font-medium mb-1.5 text-red-400">Error message</div>
              <div
                className="text-xs mono p-2.5 rounded-lg break-all leading-relaxed"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#fca5a5" }}
              >
                {selected.error_message}
              </div>
            </div>
          )}

          {selected.input != null && (
            <div>
              <div className="section-label mb-1.5">Input</div>
              <pre
                className="text-xs mono overflow-auto rounded-lg p-2.5 leading-relaxed"
                style={{ maxHeight: 120, background: "rgba(0,0,0,0.3)", color: "rgba(255,255,255,0.65)", border: "1px solid var(--border)" }}
              >
                {fmt(selected.input)}
              </pre>
            </div>
          )}

          {selected.output != null && (
            <div>
              <div className="section-label mb-1.5">Output</div>
              <pre
                className="text-xs mono overflow-auto rounded-lg p-2.5 leading-relaxed"
                style={{ maxHeight: 120, background: "rgba(0,0,0,0.3)", color: "rgba(255,255,255,0.65)", border: "1px solid var(--border)" }}
              >
                {fmt(selected.output)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  label, value, highlight, mono,
}: {
  label: string; value: string; highlight?: "red" | "green"; mono?: boolean;
}) {
  const valueColor =
    highlight === "red" ? "#f87171"
    : highlight === "green" ? "#4ade80"
    : "rgba(255,255,255,0.75)";

  return (
    <div className="flex gap-2 text-xs">
      <span className="w-14 shrink-0" style={{ color: "var(--muted)" }}>{label}</span>
      <span className={mono ? "mono" : ""} style={{ color: valueColor }}>{value}</span>
    </div>
  );
}
