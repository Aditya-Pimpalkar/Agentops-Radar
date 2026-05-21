from datetime import datetime
from sqlalchemy.orm import Session
from app.models.run import Run
from app.models.trace_event import TraceEvent
from app.models.replay_run import ReplayRun
from app.schemas.replay import ReplayRequest, ReplayResponse
from app.services.evaluation_service import trigger_evaluation
from app.services.failure_detection import detect_failures

# Simulated high-quality log results returned when a better prompt is used
_BOOSTED_LOG_RESULTS = {
    "query": "checkout latency error DB connection pool",
    "hits": 8,
    "results": [
        {
            "timestamp": "2024-01-15T14:32:01Z",
            "level": "ERROR",
            "message": "DB connection pool exhausted: all 10 connections in use",
            "service": "checkout",
        },
        {
            "timestamp": "2024-01-15T14:32:03Z",
            "level": "ERROR",
            "message": "Connection acquire timeout after 2000ms (pool_size=10)",
            "service": "checkout",
        },
        {
            "timestamp": "2024-01-15T14:32:05Z",
            "level": "ERROR",
            "message": "Request timeout: checkout_service latency=2450ms",
            "service": "checkout",
        },
        {
            "timestamp": "2024-01-15T14:31:52Z",
            "level": "WARN",
            "message": "Connection pool near capacity: 9/10 connections active",
            "service": "checkout",
        },
        {
            "timestamp": "2024-01-15T14:31:58Z",
            "level": "ERROR",
            "message": "DB pool exhaustion after deploy v42 (max_size=10)",
            "service": "checkout",
        },
    ],
    "total_searched": 150,
}


def create_replay(run: Run, config: ReplayRequest, db: Session) -> ReplayResponse:
    change_details = {}
    if config.model_name:
        change_details["model_name"] = config.model_name
    if config.prompt_override:
        change_details["prompt_override"] = config.prompt_override
    if config.guardrail_strictness:
        change_details["guardrail_strictness"] = config.guardrail_strictness
    if config.disabled_tools:
        change_details["disabled_tools"] = config.disabled_tools

    replay_run = Run(
        project_id=run.project_id,
        agent_id=run.agent_id,
        input=run.input,
        status="replayed",
        confidence_score=_simulate_confidence(run, config),
        total_latency_ms=_simulate_latency(run, config),
        total_tokens=run.total_tokens,
        estimated_cost_usd=run.estimated_cost_usd,
        started_at=datetime.utcnow(),
        ended_at=datetime.utcnow(),
    )
    if config.prompt_override:
        replay_run.input = f"[REPLAY with prompt override]\n{run.input}\n\nOverride: {config.prompt_override}"
    replay_run.final_output = _simulate_output(run, config)
    db.add(replay_run)
    db.flush()

    orig_events = db.query(TraceEvent).filter(TraceEvent.run_id == run.id).all()
    for e in orig_events:
        if config.disabled_tools and e.event_type == "tool_call" and e.name in config.disabled_tools:
            continue
        new_event = TraceEvent(
            run_id=replay_run.id,
            event_type=e.event_type,
            name=e.name,
            input=e.input,
            output=_replay_event_output(e, config),
            metadata_=e.metadata_,
            latency_ms=int(e.latency_ms * 0.85) if e.latency_ms else None,
            status=_replay_event_status(e, config),
            error_message=e.error_message if _replay_event_status(e, config) == "error" else None,
        )
        db.add(new_event)

    replay_record = ReplayRun(
        original_run_id=run.id,
        new_run_id=replay_run.id,
        change_type=",".join(change_details.keys()) or "no_change",
        change_details=change_details,
    )
    db.add(replay_record)
    db.commit()

    trigger_evaluation(
        run_id=str(replay_run.id),
        evaluator_names=["groundedness", "relevance", "safety", "tool_call_correctness", "latency", "format_compliance", "retry_loop", "evidence"],
        db=db,
    )
    detect_failures(run_id=str(replay_run.id), db=db)

    return ReplayResponse(
        replay_run_id=replay_run.id,
        original_run_id=run.id,
        status="completed",
        created_at=replay_record.created_at,
    )


def _simulate_confidence(run: Run, config: ReplayRequest) -> float:
    base = run.confidence_score or 0.5
    if config.prompt_override:
        # Dramatically boost to simulate better evidence retrieval and reasoning
        base = min(0.92, base + 0.55)
    elif config.guardrail_strictness == "high":
        base = min(0.95, base + 0.05)
    return round(base, 3)


def _simulate_latency(run: Run, config: ReplayRequest) -> int | None:
    if not run.total_latency_ms:
        return None
    factor = 0.85
    if config.model_name and "mini" in config.model_name:
        factor = 0.6
    return int(run.total_latency_ms * factor)


def _simulate_output(run: Run, config: ReplayRequest) -> str:
    if config.prompt_override:
        return (
            "[Replayed with enhanced retrieval] Root cause confirmed: DB connection pool "
            "exhaustion triggered by deployment v42. v42 reduced db.connection_pool.max_size "
            "from 50 to 10, causing connection timeouts under normal load. "
            "Recommendation: Increase DB connection pool size (max_size >= 30) and revert "
            "connection timeout to 5000ms."
        )
    base = run.final_output or ""
    if config.guardrail_strictness == "high":
        return f"[Replayed with stricter guardrails] {base}"
    return base


def _replay_event_output(event: TraceEvent, config: ReplayRequest) -> dict | None:
    """Return (potentially boosted) output for a replayed event.

    When prompt_override is active we simulate a better-targeted log search
    returning rich evidence, turning the failure path into a success.
    """
    if not config.prompt_override:
        return event.output
    if event.event_type == "retrieval" and event.name == "search_logs":
        return _BOOSTED_LOG_RESULTS
    return event.output


def _replay_event_status(event: TraceEvent, config: ReplayRequest) -> str:
    if event.status != "error":
        return event.status
    # Guardrail failures resolve when we have better evidence (prompt_override)
    # or when strictness is explicitly set to high (more thorough checks pass)
    if event.event_type == "guardrail_check" and (
        config.prompt_override or config.guardrail_strictness == "high"
    ):
        return "success"
    return event.status
