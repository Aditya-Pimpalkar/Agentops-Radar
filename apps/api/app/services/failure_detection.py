import logging
from uuid import UUID
from sqlalchemy.orm import Session
from app.models.run import Run
from app.models.trace_event import TraceEvent
from app.models.alert import Alert

logger = logging.getLogger(__name__)

LATENCY_HIGH_MS = 15000
RETRY_EXCESSIVE = 3


def detect_failures(run_id: str, db: Session) -> list[Alert]:
    run = db.query(Run).filter(Run.id == UUID(run_id)).first()
    if not run:
        return []
    events = db.query(TraceEvent).filter(TraceEvent.run_id == run.id).all()
    alerts = []

    # tool_error / tool_timeout
    for e in events:
        if e.event_type == "tool_call" and e.status == "error":
            msg = e.error_message or "Tool call failed"
            atype = "tool_timeout" if "timeout" in msg.lower() else "tool_error"
            alerts.append(_make_alert(run.id, "high", atype, f"Tool '{e.name}' failed: {msg}"))

    # excessive_retries
    retries = [e for e in events if e.event_type == "retry"]
    if len(retries) >= RETRY_EXCESSIVE:
        alerts.append(_make_alert(run.id, "medium", "excessive_retries", f"{len(retries)} retries detected in run"))

    # high_latency
    if run.total_latency_ms and run.total_latency_ms > LATENCY_HIGH_MS:
        alerts.append(_make_alert(run.id, "medium", "high_latency", f"Run latency {run.total_latency_ms}ms exceeds threshold"))

    # low_confidence
    if run.confidence_score is not None and run.confidence_score < 0.5:
        alerts.append(_make_alert(run.id, "high", "low_confidence", f"Confidence score {run.confidence_score:.2f} is below threshold"))

    # guardrail violations
    guardrail_errors = [e for e in events if e.event_type == "guardrail_check" and e.status == "error"]
    for e in guardrail_errors:
        alerts.append(_make_alert(run.id, "critical", "unsafe_output", f"Guardrail '{e.name}' violated"))

    # schema / format violations
    error_events = [e for e in events if e.event_type == "error"]
    for e in error_events:
        if e.error_message and "schema" in e.error_message.lower():
            alerts.append(_make_alert(run.id, "medium", "format_violation", f"Schema violation: {e.error_message}"))

    for a in alerts:
        db.add(a)
    db.commit()
    return alerts


def _make_alert(run_id, severity: str, alert_type: str, message: str) -> Alert:
    return Alert(
        run_id=run_id,
        severity=severity,
        alert_type=alert_type,
        message=message,
    )
