import logging
from sqlalchemy.orm import Session
from sqlalchemy import text

logger = logging.getLogger(__name__)

LATENCY_HIGH_MS = 15000
RETRY_EXCESSIVE = 3


def detect_run_failures(run_id: str, db: Session) -> list[dict]:
    run = db.execute(text("SELECT * FROM runs WHERE id = :id"), {"id": run_id}).fetchone()
    if not run:
        return []
    events = db.execute(
        text("SELECT * FROM trace_events WHERE run_id = :id"), {"id": run_id}
    ).fetchall()
    alerts = []

    for e in events:
        if e.event_type == "tool_call" and e.status == "error":
            msg = e.error_message or "Tool call failed"
            atype = "tool_timeout" if "timeout" in msg.lower() else "tool_error"
            alerts.append({"type": atype, "severity": "high", "message": f"Tool '{e.name}' failed: {msg}"})

    retries = [e for e in events if e.event_type == "retry"]
    if len(retries) >= RETRY_EXCESSIVE:
        alerts.append({"type": "excessive_retries", "severity": "medium", "message": f"{len(retries)} retries"})

    if run.total_latency_ms and run.total_latency_ms > LATENCY_HIGH_MS:
        alerts.append({"type": "high_latency", "severity": "medium", "message": f"{run.total_latency_ms}ms latency"})

    if run.confidence_score is not None and run.confidence_score < 0.5:
        alerts.append({"type": "low_confidence", "severity": "high", "message": f"Score {run.confidence_score:.2f}"})

    for e in events:
        if e.event_type == "guardrail_check" and e.status == "error":
            alerts.append({"type": "unsafe_output", "severity": "critical", "message": f"Guardrail '{e.name}' violated"})

    for a in alerts:
        db.execute(
            text("""
                INSERT INTO alerts (id, run_id, severity, alert_type, message, resolved, created_at)
                VALUES (gen_random_uuid(), :rid, :sev, :atype, :msg, false, NOW())
            """),
            {"rid": run_id, "sev": a["severity"], "atype": a["type"], "msg": a["message"]},
        )
    db.commit()
    return alerts
