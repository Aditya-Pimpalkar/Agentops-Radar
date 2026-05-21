import logging
from uuid import UUID
from sqlalchemy.orm import Session
from app.models.run import Run
from app.models.trace_event import TraceEvent
from app.models.evaluation import Evaluation

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


def trigger_evaluation(run_id: str, evaluator_names: list[str], db: Session) -> list[Evaluation]:
    run = db.query(Run).filter(Run.id == UUID(run_id)).first()
    if not run:
        return []
    events = db.query(TraceEvent).filter(TraceEvent.run_id == run.id).all()
    results = []
    for name in evaluator_names:
        existing = db.query(Evaluation).filter(
            Evaluation.run_id == run.id,
            Evaluation.evaluator_name == name,
        ).first()
        if existing:
            results.append(existing)
            continue
        score, reason = _run_evaluator(name, run, events)
        threshold = PASS_THRESHOLDS.get(name, 0.5)
        passed = score >= threshold if score is not None else None
        eval_obj = Evaluation(
            run_id=run.id,
            evaluator_name=name,
            score=score,
            passed=passed,
            reason=reason,
        )
        db.add(eval_obj)
        results.append(eval_obj)
    db.commit()
    for r in results:
        db.refresh(r)
    return results


def _run_evaluator(name: str, run: Run, events: list[TraceEvent]) -> tuple[float | None, str]:
    if name == "groundedness":
        return _eval_groundedness(run, events)
    if name == "relevance":
        return _eval_relevance(run, events)
    if name == "safety":
        return _eval_safety(run, events)
    if name == "tool_call_correctness":
        return _eval_tool_correctness(events)
    if name == "latency":
        return _eval_latency(run)
    if name == "format_compliance":
        return _eval_format_compliance(run)
    if name == "retry_loop":
        return _eval_retry_loop(events)
    if name == "evidence":
        return _eval_evidence(events)
    return None, f"Unknown evaluator: {name}"


def _retrieval_evidence_quality(output: dict) -> float:
    """Score evidence quality of a single retrieval output (0.0 – 1.0).

    Penalises empty log searches heavily while still rewarding structural
    config / metrics retrievals that have no 'hits' field.
    """
    if not output:
        return 0.0
    hits = output.get("hits", None)
    if hits is not None:
        # Search-type tool: hits=0 means no evidence at all
        if hits == 0:
            return 0.0
        return min(1.0, hits / 5)   # 5+ hits = full quality

    # Non-search retrieval: look for structured data (changes, series, etc.)
    results = output.get("results", []) or []
    changes = output.get("changes", []) or []
    data_points = output.get("data_points", 0) or 0
    total_items = len(results) + len(changes) + data_points
    if total_items == 0:
        return 0.0
    # Any structural data is meaningful evidence; scale modestly above 0.6 base
    return min(1.0, 0.6 + total_items * 0.1)  # 1 item → 0.7, 3+ → 0.9


def _eval_groundedness(run: Run, events: list[TraceEvent]) -> tuple[float, str]:
    retrieval_events = [e for e in events if e.event_type == "retrieval"]
    if not retrieval_events:
        if run.confidence_score and run.confidence_score > 0.8:
            return 0.65, "No retrieval steps found but high confidence score"
        return 0.45, "No retrieval events found — groundedness cannot be verified"

    successful = [e for e in retrieval_events if e.status == "success"]
    if not successful:
        return 0.2, "All retrieval steps failed — answer has no factual grounding"

    qualities = [_retrieval_evidence_quality(e.output or {}) for e in successful]
    avg_quality = sum(qualities) / len(qualities)

    confidence_boost = (run.confidence_score or 0.5) * 0.15
    score = min(0.95, avg_quality * 0.75 + confidence_boost)

    zero_count = sum(1 for q in qualities if q == 0.0)
    if zero_count:
        reason = (
            f"{zero_count}/{len(successful)} retrieval(s) returned no evidence "
            f"— answer lacks factual grounding"
        )
    else:
        reason = (
            f"{len(successful)}/{len(retrieval_events)} retrieval(s) returned "
            f"useful evidence (avg quality {avg_quality:.0%})"
        )
    return round(score, 3), reason


def _eval_relevance(run: Run, events: list[TraceEvent]) -> tuple[float, str]:
    confidence = run.confidence_score or 0.5

    if run.final_output:
        output_lower = run.final_output.lower()
        inconclusive_markers = [
            "inconclusive", "insufficient", "unable to", "cannot determine",
            "more data needed", "recommend gathering",
        ]
        if any(m in output_lower for m in inconclusive_markers):
            score = min(0.5, confidence * 0.8)
            return round(score, 3), "Output indicates inconclusive result — relevance limited"

        if len(run.final_output) > 100 and confidence >= 0.6:
            score = min(0.95, 0.6 + confidence * 0.35)
            return round(score, 3), "Relevant and substantive output with high confidence"

        score = min(0.75, 0.4 + confidence * 0.4)
        return round(score, 3), "Relevance estimated from output content and confidence"

    return round(min(0.6, confidence * 0.8), 3), "Relevance estimated from confidence score"


def _eval_safety(run: Run, events: list[TraceEvent]) -> tuple[float, str]:
    guardrail_events = [e for e in events if e.event_type == "guardrail_check"]
    if not guardrail_events:
        return 0.85, "No guardrail violations detected (no guardrail events)"
    violations = [e for e in guardrail_events if e.status == "error"]
    if violations:
        return 0.3, f"{len(violations)} guardrail violation(s) detected"
    return 0.95, f"All {len(guardrail_events)} guardrail check(s) passed"


def _eval_tool_correctness(events: list[TraceEvent]) -> tuple[float, str]:
    tool_events = [e for e in events if e.event_type == "tool_call"]
    if not tool_events:
        return 0.8, "No tool calls made"
    errors = [e for e in tool_events if e.status == "error"]
    ratio = 1 - (len(errors) / len(tool_events))
    reason = f"{len(tool_events) - len(errors)}/{len(tool_events)} tool calls succeeded"
    return round(ratio, 3), reason


def _eval_latency(run: Run) -> tuple[float, str]:
    if not run.total_latency_ms:
        return 0.7, "No latency data available"
    ms = run.total_latency_ms
    if ms < 2000:
        return 1.0, f"Excellent latency: {ms}ms"
    if ms < 5000:
        return 0.8, f"Good latency: {ms}ms"
    if ms < 10000:
        return 0.6, f"Acceptable latency: {ms}ms"
    if ms < 20000:
        return 0.4, f"High latency: {ms}ms"
    return 0.2, f"Very high latency: {ms}ms"


def _eval_format_compliance(run: Run) -> tuple[float, str]:
    if not run.final_output:
        return 0.5, "No final output to evaluate"
    output = run.final_output
    if len(output) < 20:
        return 0.4, "Output too short — may not meet format requirements"

    output_lower = output.lower()
    inconclusive_markers = ["inconclusive", "insufficient", "cannot", "unable"]
    if any(m in output_lower for m in inconclusive_markers):
        return 0.55, "Output is inconclusive — does not meet actionable format requirements"

    actionable_markers = [
        "recommendation", "root cause", "recommend", "action",
        "fix", "revert", "increase", "reduce", "change",
    ]
    actionable_count = sum(1 for m in actionable_markers if m in output_lower)
    if actionable_count >= 3:
        return min(0.95, 0.70 + actionable_count * 0.04), f"Output contains {actionable_count} actionable elements"
    if actionable_count >= 1:
        return 0.78, "Output contains minimal actionable guidance"
    return 0.65, "Output present but lacks explicit recommendations"


def _eval_retry_loop(events: list[TraceEvent]) -> tuple[float, str]:
    retry_events = [e for e in events if e.event_type == "retry"]
    if not retry_events:
        return 1.0, "No retries detected"
    if len(retry_events) >= 5:
        return 0.1, f"Excessive retries detected: {len(retry_events)}"
    if len(retry_events) >= 3:
        return 0.4, f"Multiple retries detected: {len(retry_events)}"
    return 0.7, f"Minor retries: {len(retry_events)}"


def _eval_evidence(events: list[TraceEvent]) -> tuple[float, str]:
    retrieval_events = [e for e in events if e.event_type == "retrieval" and e.status == "success"]
    if not retrieval_events:
        return 0.3, "No successful evidence retrieval found"

    outputs_with_hits: list[TraceEvent] = []
    for e in retrieval_events:
        if not e.output:
            continue
        hits = e.output.get("hits", 0) or 0
        results = e.output.get("results", []) or []
        if hits > 0 or len(results) > 0:
            outputs_with_hits.append(e)

    total = len(retrieval_events)
    if not outputs_with_hits:
        return 0.35, f"0/{total} retrieval(s) returned any results — evidence absent"

    score = min(0.95, 0.5 + len(outputs_with_hits) * 0.2)
    return round(score, 3), f"{len(outputs_with_hits)}/{total} retrieval(s) returned relevant evidence"
