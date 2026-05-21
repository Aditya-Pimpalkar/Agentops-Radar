"""
Rule-based evaluators that run synchronously in the worker.
These mirror the logic in apps/api/app/services/evaluation_service.py
but run asynchronously via Celery.
"""
import json
import logging
from uuid import UUID
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

PASS_THRESHOLDS = {
    "groundedness": 0.7,
    "relevance": 0.6,
    "safety": 0.8,
    "tool_call_correctness": 0.7,
    "latency": 0.6,
    "format_compliance": 0.8,
    "retry_loop": 0.5,
    "evidence": 0.6,
}

ALL_EVALUATORS = list(PASS_THRESHOLDS.keys())


def run_all_evaluators(run_id: str, evaluator_names: list[str] | None, db: Session) -> list:
    from sqlalchemy import text
    names = evaluator_names or ALL_EVALUATORS

    run_row = db.execute(
        text("SELECT * FROM runs WHERE id = :id"), {"id": run_id}
    ).fetchone()
    if not run_row:
        return []

    events = db.execute(
        text("SELECT * FROM trace_events WHERE run_id = :id ORDER BY created_at"), {"id": run_id}
    ).fetchall()

    results = []
    for name in names:
        existing = db.execute(
            text("SELECT id FROM evaluations WHERE run_id = :rid AND evaluator_name = :name"),
            {"rid": run_id, "name": name},
        ).fetchone()
        if existing:
            continue

        score, reason = _score(name, run_row, events)
        threshold = PASS_THRESHOLDS.get(name, 0.5)
        passed = score >= threshold if score is not None else None

        db.execute(
            text("""
                INSERT INTO evaluations (id, run_id, evaluator_name, score, passed, reason, created_at)
                VALUES (gen_random_uuid(), :rid, :name, :score, :passed, :reason, NOW())
            """),
            {"rid": run_id, "name": name, "score": score, "passed": passed, "reason": reason},
        )
        results.append({"evaluator_name": name, "score": score, "passed": passed})

    db.commit()
    return results


def _get_output(event) -> dict:
    """Safely parse event output whether it's already a dict or a JSON string."""
    out = event.output
    if out is None:
        return {}
    if isinstance(out, dict):
        return out
    try:
        return json.loads(out)
    except Exception:
        return {}


def _retrieval_evidence_quality(output: dict) -> float:
    """Score evidence quality of a single retrieval output (0.0 – 1.0)."""
    if not output:
        return 0.0
    hits = output.get("hits", None)
    if hits is not None:
        if hits == 0:
            return 0.0
        return min(1.0, hits / 5)
    results = output.get("results", []) or []
    changes = output.get("changes", []) or []
    data_points = output.get("data_points", 0) or 0
    total_items = len(results) + len(changes) + data_points
    if total_items == 0:
        return 0.0
    return min(1.0, 0.6 + total_items * 0.1)  # 1 item → 0.7, 3+ → 0.9


def _score(name: str, run, events) -> tuple[float | None, str]:
    if name == "groundedness":
        return _groundedness(run, events)
    if name == "relevance":
        return _relevance(run, events)
    if name == "safety":
        return _safety(run, events)
    if name == "tool_call_correctness":
        return _tool_correctness(events)
    if name == "latency":
        return _latency(run)
    if name == "format_compliance":
        return _format_compliance(run)
    if name == "retry_loop":
        return _retry_loop(events)
    if name == "evidence":
        return _evidence(events)
    return None, f"Unknown evaluator: {name}"


def _groundedness(run, events):
    retrievals = [e for e in events if e.event_type == "retrieval"]
    if not retrievals:
        conf = run.confidence_score or 0.5
        return (0.65, "No retrievals but high confidence") if conf > 0.8 else (0.45, "No retrieval events")

    successful = [e for e in retrievals if e.status == "success"]
    if not successful:
        return 0.2, "All retrieval steps failed"

    qualities = [_retrieval_evidence_quality(_get_output(e)) for e in successful]
    avg_quality = sum(qualities) / len(qualities)
    confidence_boost = (run.confidence_score or 0.5) * 0.15
    score = min(0.95, avg_quality * 0.75 + confidence_boost)

    zero_count = sum(1 for q in qualities if q == 0.0)
    if zero_count:
        reason = f"{zero_count}/{len(successful)} retrieval(s) returned no evidence — answer lacks factual grounding"
    else:
        reason = f"{len(successful)}/{len(retrievals)} retrieval(s) with useful evidence (avg quality {avg_quality:.0%})"
    return round(score, 3), reason


def _relevance(run, events):
    confidence = run.confidence_score or 0.5
    final_output = run.final_output or ""
    if final_output:
        output_lower = final_output.lower()
        inconclusive = ["inconclusive", "insufficient", "unable to", "cannot determine", "recommend gathering"]
        if any(m in output_lower for m in inconclusive):
            return round(min(0.5, confidence * 0.8), 3), "Output indicates inconclusive result"
        if len(final_output) > 100 and confidence >= 0.6:
            return round(min(0.95, 0.6 + confidence * 0.35), 3), "Relevant and substantive output"
        return round(min(0.75, 0.4 + confidence * 0.4), 3), "Relevance estimated from output"
    return round(min(0.6, confidence * 0.8), 3), "Relevance estimated from confidence"


def _safety(run, events):
    violations = [e for e in events if e.event_type == "guardrail_check" and e.status == "error"]
    if violations:
        return 0.3, f"{len(violations)} guardrail violation(s) detected"
    guards = [e for e in events if e.event_type == "guardrail_check"]
    return (0.95, f"All {len(guards)} guardrail check(s) passed") if guards else (0.85, "No guardrail events")


def _tool_correctness(events):
    tools = [e for e in events if e.event_type == "tool_call"]
    if not tools:
        return 0.8, "No tool calls"
    errors = [e for e in tools if e.status == "error"]
    return round(1 - len(errors) / len(tools), 3), f"{len(tools)-len(errors)}/{len(tools)} succeeded"


def _latency(run):
    ms = run.total_latency_ms
    if not ms:
        return 0.7, "No latency data"
    if ms < 2000:
        return 1.0, f"{ms}ms — excellent"
    if ms < 5000:
        return 0.8, f"{ms}ms — good"
    if ms < 10000:
        return 0.6, f"{ms}ms — acceptable"
    if ms < 20000:
        return 0.4, f"{ms}ms — high"
    return 0.2, f"{ms}ms — very high"


def _format_compliance(run):
    out = (run.final_output or "").strip()
    if not out:
        return 0.5, "No final output"
    if len(out) < 20:
        return 0.4, "Output too short"
    out_lower = out.lower()
    inconclusive = ["inconclusive", "insufficient", "cannot", "unable"]
    if any(m in out_lower for m in inconclusive):
        return 0.55, "Output is inconclusive — not actionable"
    actionable = ["recommendation", "root cause", "recommend", "action", "fix", "revert", "increase", "reduce", "change"]
    count = sum(1 for m in actionable if m in out_lower)
    if count >= 3:
        return min(0.95, 0.70 + count * 0.04), f"Output contains {count} actionable elements"
    if count >= 1:
        return 0.78, "Output has minimal actionable guidance"
    return 0.65, "Output present but lacks recommendations"


def _retry_loop(events):
    retries = [e for e in events if e.event_type == "retry"]
    if not retries:
        return 1.0, "No retries"
    if len(retries) >= 5:
        return 0.1, f"Excessive: {len(retries)} retries"
    if len(retries) >= 3:
        return 0.4, f"Multiple retries: {len(retries)}"
    return 0.7, f"Minor retries: {len(retries)}"


def _evidence(events):
    retrievals = [e for e in events if e.event_type == "retrieval" and e.status == "success"]
    if not retrievals:
        return 0.3, "No successful retrievals"

    with_hits = []
    for e in retrievals:
        out = _get_output(e)
        hits = out.get("hits", 0) or 0
        results = out.get("results", []) or []
        if hits > 0 or len(results) > 0:
            with_hits.append(e)

    total = len(retrievals)
    if not with_hits:
        return 0.35, f"0/{total} retrieval(s) returned any results — evidence absent"
    score = min(0.95, 0.5 + len(with_hits) * 0.2)
    return round(score, 3), f"{len(with_hits)}/{total} retrieval(s) returned relevant evidence"
