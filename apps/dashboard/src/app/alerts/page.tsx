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
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">Alerts</h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
          {active.length} active · {resolved.length} resolved
        </p>
      </div>

      {/* Active alerts */}
      {active.length === 0 ? (
        <div className="card text-center py-12 space-y-2">
          <div className="text-3xl">✅</div>
          <div className="text-sm font-medium text-white">No active alerts</div>
          <div className="text-xs" style={{ color: "var(--muted)" }}>All agent runs are within normal thresholds.</div>
        </div>
      ) : (
        <div>
          <div className="section-label mb-3">Active alerts</div>
          <div className="card p-0 overflow-hidden">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Type</th>
                  <th>Message</th>
                  <th>Run</th>
                  <th>Time</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {active.map((a) => (
                  <tr key={a.id}>
                    <td><SeverityBadge severity={a.severity} /></td>
                    <td className="mono text-xs" style={{ color: "var(--muted-bright)" }}>{a.alert_type}</td>
                    <td className="text-sm" style={{ color: "rgba(255,255,255,0.8)" }}>{a.message}</td>
                    <td>
                      {a.run_id ? (
                        <Link
                          href={`/runs/${a.run_id}`}
                          className="mono text-xs hover:underline"
                          style={{ color: "var(--accent)" }}
                        >
                          {a.run_id.slice(0, 8)}…
                        </Link>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    <td className="text-xs" style={{ color: "var(--muted)" }}>
                      {new Date(a.created_at).toLocaleString(undefined, {
                        month: "short", day: "numeric",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </td>
                    <td><ResolveAlertButton alertId={a.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Resolved alerts */}
      {resolved.length > 0 && (
        <div>
          <div className="section-label mb-3">Resolved</div>
          <div className="card p-0 overflow-hidden opacity-60">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Message</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {resolved.slice(0, 10).map((a) => (
                  <tr key={a.id}>
                    <td className="mono text-xs" style={{ color: "var(--muted-bright)" }}>{a.alert_type}</td>
                    <td className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>{a.message}</td>
                    <td className="text-xs" style={{ color: "var(--muted)" }}>
                      {new Date(a.created_at).toLocaleString(undefined, {
                        month: "short", day: "numeric",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
