import { api } from "@/lib/api";
import type { Alert } from "@/types";
import { SeverityBadge } from "@/components/ui/StatusBadge";
import Link from "next/link";
import { ResolveAlertButton } from "@/components/ui/ResolveAlertButton";

async function getAlerts(): Promise<Alert[]> {
  try { return await api.get<Alert[]>("/api/alerts"); } catch { return []; }
}

export default async function AlertsPage() {
  const alerts = await getAlerts();
  const active = alerts.filter((a) => !a.resolved);
  const resolved = alerts.filter((a) => a.resolved);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Alerts</h1>
        <p className="text-radar-muted text-sm mt-1">
          {active.length} active · {resolved.length} resolved
        </p>
      </div>

      {active.length > 0 && (
        <section>
          <div className="text-xs text-radar-muted uppercase tracking-widest mb-3">Active</div>
          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-radar-border text-radar-muted text-xs uppercase tracking-widest">
                  <th className="px-4 py-3 text-left">Severity</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Message</th>
                  <th className="px-4 py-3 text-left">Run</th>
                  <th className="px-4 py-3 text-left">Time</th>
                  <th className="px-4 py-3 text-left"></th>
                </tr>
              </thead>
              <tbody>
                {active.map((a) => (
                  <tr key={a.id} className="border-b border-radar-border/50 hover:bg-white/[0.02]">
                    <td className="px-4 py-3"><SeverityBadge severity={a.severity} /></td>
                    <td className="px-4 py-3 font-mono text-xs text-radar-muted">{a.alert_type}</td>
                    <td className="px-4 py-3 text-white/80">{a.message}</td>
                    <td className="px-4 py-3">
                      {a.run_id ? (
                        <Link href={`/runs/${a.run_id}`} className="text-radar-accent hover:underline text-xs font-mono">
                          {a.run_id.slice(0, 8)}…
                        </Link>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-radar-muted text-xs">
                      {new Date(a.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <ResolveAlertButton alertId={a.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {active.length === 0 && (
        <div className="card text-center py-10 text-radar-muted">
          No active alerts. System is healthy.
        </div>
      )}

      {resolved.length > 0 && (
        <section>
          <div className="text-xs text-radar-muted uppercase tracking-widest mb-3">Resolved</div>
          <div className="card p-0 overflow-hidden opacity-60">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-radar-border text-radar-muted text-xs uppercase tracking-widest">
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Message</th>
                  <th className="px-4 py-3 text-left">Time</th>
                </tr>
              </thead>
              <tbody>
                {resolved.slice(0, 10).map((a) => (
                  <tr key={a.id} className="border-b border-radar-border/50">
                    <td className="px-4 py-3 font-mono text-xs text-radar-muted">{a.alert_type}</td>
                    <td className="px-4 py-3 text-white/50">{a.message}</td>
                    <td className="px-4 py-3 text-radar-muted text-xs">{new Date(a.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
