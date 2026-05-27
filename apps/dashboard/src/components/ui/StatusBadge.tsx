export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: "badge-success",
    failed: "badge-failed",
    running: "badge-running",
    replayed: "badge-replayed",
    error: "badge-failed",
  };
  const dot: Record<string, string> = {
    success: "bg-green-400",
    failed: "bg-red-400",
    running: "bg-blue-400",
    replayed: "bg-violet-400",
    error: "bg-red-400",
  };
  return (
    <span className={`badge ${map[status] ?? "badge-warning"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot[status] ?? "bg-yellow-400"}`} />
      {status}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const cls: Record<string, string> = {
    critical: "badge-critical",
    high: "badge-high",
    medium: "badge-medium",
    low: "badge-low",
  };
  return <span className={`badge ${cls[severity] ?? "badge-medium"}`}>{severity}</span>;
}

export function ScoreBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs" style={{ color: "var(--muted)" }}>—</span>;
  const pct = Math.round(score * 100);
  const color = pct >= 70 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <div className="score-bar w-16">
        <div className="score-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs tabular-nums mono" style={{ color }}>{pct}%</span>
    </div>
  );
}
