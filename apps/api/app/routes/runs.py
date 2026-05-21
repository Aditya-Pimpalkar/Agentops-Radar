from uuid import UUID
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.run import Run
from app.models.trace_event import TraceEvent
from app.schemas.run import RunStart, RunEnd, RunResponse, RunSummary
from app.schemas.trace_event import TraceEventCreate, TraceEventResponse
from app.schemas.evaluation import EvaluationRequest, EvaluationResponse
from app.schemas.replay import ReplayRequest, ReplayResponse, ReplayComparison
from app.middleware import require_api_key
from app.services.evaluation_service import trigger_evaluation
from app.services.replay_service import create_replay
from app.services.failure_detection import detect_failures

router = APIRouter(prefix="/api/runs", tags=["Runs"])


@router.post("/start", response_model=RunResponse, status_code=201, dependencies=[Depends(require_api_key)])
def start_run(body: RunStart, db: Session = Depends(get_db)):
    run = Run(
        project_id=body.project_id,
        agent_id=body.agent_id,
        input=body.input,
        status="running",
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


@router.post("/{run_id}/events", response_model=TraceEventResponse, status_code=201, dependencies=[Depends(require_api_key)])
def add_event(run_id: UUID, body: TraceEventCreate, db: Session = Depends(get_db)):
    run = db.query(Run).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    event = TraceEvent(
        run_id=run_id,
        parent_event_id=body.parent_event_id,
        event_type=body.event_type,
        name=body.name,
        input=body.input,
        output=body.output,
        metadata_=body.metadata,
        latency_ms=body.latency_ms,
        status=body.status,
        error_message=body.error_message,
    )
    db.add(event)
    if body.status == "error":
        run.failure_count = (run.failure_count or 0) + 1
    db.commit()
    db.refresh(event)
    return event


@router.post("/{run_id}/end", response_model=RunResponse, dependencies=[Depends(require_api_key)])
def end_run(run_id: UUID, body: RunEnd, db: Session = Depends(get_db)):
    run = db.query(Run).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    run.final_output = body.final_output
    run.status = body.status
    run.confidence_score = body.confidence_score
    run.total_tokens = body.total_tokens
    run.estimated_cost_usd = body.estimated_cost_usd
    run.ended_at = datetime.utcnow()
    if run.started_at and run.ended_at:
        delta = run.ended_at - run.started_at
        run.total_latency_ms = int(delta.total_seconds() * 1000)
    db.commit()
    db.refresh(run)
    detect_failures(run_id=str(run_id), db=db)
    return run


@router.get("", response_model=list[RunSummary], dependencies=[Depends(require_api_key)])
def list_runs(
    project_id: UUID | None = None,
    agent_id: UUID | None = None,
    status: str | None = None,
    failure_type: str | None = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    q = db.query(Run)
    if project_id:
        q = q.filter(Run.project_id == project_id)
    if agent_id:
        q = q.filter(Run.agent_id == agent_id)
    if status:
        q = q.filter(Run.status == status)
    return q.order_by(Run.started_at.desc()).offset(offset).limit(limit).all()


@router.get("/{run_id}", response_model=RunResponse, dependencies=[Depends(require_api_key)])
def get_run(run_id: UUID, db: Session = Depends(get_db)):
    run = db.query(Run).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@router.get("/{run_id}/trace", response_model=list[TraceEventResponse], dependencies=[Depends(require_api_key)])
def get_trace(run_id: UUID, db: Session = Depends(get_db)):
    run = db.query(Run).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return (
        db.query(TraceEvent)
        .filter(TraceEvent.run_id == run_id)
        .order_by(TraceEvent.created_at)
        .all()
    )


@router.post("/{run_id}/evaluate", response_model=list[EvaluationResponse], dependencies=[Depends(require_api_key)])
def evaluate_run(run_id: UUID, body: EvaluationRequest, db: Session = Depends(get_db)):
    run = db.query(Run).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return trigger_evaluation(run_id=str(run_id), evaluator_names=body.evaluators, db=db)


@router.get("/{run_id}/evaluations", response_model=list[EvaluationResponse], dependencies=[Depends(require_api_key)])
def get_evaluations(run_id: UUID, db: Session = Depends(get_db)):
    from app.models.evaluation import Evaluation
    return db.query(Evaluation).filter(Evaluation.run_id == run_id).all()


@router.post("/{run_id}/replay", response_model=ReplayResponse, dependencies=[Depends(require_api_key)])
def replay_run(run_id: UUID, body: ReplayRequest, db: Session = Depends(get_db)):
    run = db.query(Run).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return create_replay(run=run, config=body, db=db)


@router.get("/{run_id}/replay/comparison", response_model=ReplayComparison, dependencies=[Depends(require_api_key)])
def get_replay_comparison(run_id: UUID, db: Session = Depends(get_db)):
    from app.models.replay_run import ReplayRun
    from app.models.evaluation import Evaluation
    replay = db.query(ReplayRun).filter(ReplayRun.original_run_id == run_id).order_by(ReplayRun.created_at.desc()).first()
    if not replay:
        raise HTTPException(status_code=404, detail="No replay found for this run")
    orig_run = db.query(Run).filter(Run.id == run_id).first()
    replay_run = db.query(Run).filter(Run.id == replay.new_run_id).first()

    def scores_for(rid):
        evals = db.query(Evaluation).filter(Evaluation.run_id == rid).all()
        return {e.evaluator_name: e.score for e in evals}

    orig_scores = scores_for(run_id)
    rpl_scores = scores_for(replay.new_run_id)
    delta = {k: (rpl_scores.get(k, 0) or 0) - (orig_scores.get(k, 0) or 0) for k in set(list(orig_scores.keys()) + list(rpl_scores.keys()))}

    return ReplayComparison(
        original_run_id=run_id,
        replay_run_id=replay.new_run_id,
        original_scores=orig_scores,
        replay_scores=rpl_scores,
        score_delta=delta,
        original_latency_ms=orig_run.total_latency_ms if orig_run else None,
        replay_latency_ms=replay_run.total_latency_ms if replay_run else None,
        latency_delta_ms=(
            (replay_run.total_latency_ms or 0) - (orig_run.total_latency_ms or 0)
            if orig_run and replay_run else None
        ),
        original_status=orig_run.status if orig_run else "unknown",
        replay_status=replay_run.status if replay_run else "unknown",
        change_details=replay.change_details,
    )
