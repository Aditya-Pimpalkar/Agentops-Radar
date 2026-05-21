export function StatusBadge({ status }: { status: string }) {
  const cls = {
    success: "badge-success",
    failed: "badge-failed",
    running: "badge-running",
    replayed: "badge-replayed",
    error: "badge-failed",
  }[status] ?? "badge-warning";
  return <span className={`badge ${cls}`}>{status}</span>;
}

export function SeverityBadge({ severity }: { severity: string }) {
  const cls = {
    critical: "badge-critical",
    high: "badge-high",
    medium: "badge-medium",
    low: "badge-low",
  }[severity] ?? "badge-medium";
  return <span className={`badge ${cls}`}>{severity}</span>;
}

export function ScoreBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-radar-muted text-xs">—</span>;
  const pct = Math.round(score * 100);
  const color = pct >= 70 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <div className="score-bar w-20">
        <div className="score-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs tabular-nums" style={{ color }}>{pct}%</span>
    </div>
  );
}
