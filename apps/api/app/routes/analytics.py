from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database import get_db
from app.models.run import Run
from app.models.alert import Alert
from app.middleware import require_api_key

router = APIRouter(prefix="/api/analytics", tags=["Analytics"])


@router.get("/overview", dependencies=[Depends(require_api_key)])
def get_overview(project_id: str | None = None, db: Session = Depends(get_db)):
    q = db.query(Run)
    if project_id:
        q = q.filter(Run.project_id == project_id)
    runs = q.all()
    total = len(runs)
    failed = sum(1 for r in runs if r.status == "failed")
    latencies = [r.total_latency_ms for r in runs if r.total_latency_ms]
    scores = [r.confidence_score for r in runs if r.confidence_score]
    costs = [float(r.estimated_cost_usd) for r in runs if r.estimated_cost_usd]
    return {
        "total_runs": total,
        "failed_runs": failed,
        "failure_rate": round(failed / total, 4) if total else 0,
        "avg_latency_ms": round(sum(latencies) / len(latencies)) if latencies else 0,
        "avg_quality_score": round(sum(scores) / len(scores), 4) if scores else 0,
        "estimated_cost_usd": round(sum(costs), 4),
    }


@router.get("/failures", dependencies=[Depends(require_api_key)])
def get_failures(project_id: str | None = None, db: Session = Depends(get_db)):
    q = db.query(Alert.alert_type, func.count(Alert.id).label("count"))
    q = q.group_by(Alert.alert_type).order_by(func.count(Alert.id).desc())
    rows = q.all()
    return {"failure_types": [{"type": r.alert_type, "count": r.count} for r in rows]}


@router.get("/latency-trend", dependencies=[Depends(require_api_key)])
def get_latency_trend(project_id: str | None = None, db: Session = Depends(get_db)):
    q = db.query(Run).filter(Run.total_latency_ms.isnot(None))
    if project_id:
        q = q.filter(Run.project_id == project_id)
    runs = q.order_by(Run.started_at).all()
    return [
        {
            "run_id": str(r.id),
            "latency_ms": r.total_latency_ms,
            "started_at": r.started_at.isoformat(),
        }
        for r in runs
    ]


@router.get("/quality-trend", dependencies=[Depends(require_api_key)])
def get_quality_trend(project_id: str | None = None, db: Session = Depends(get_db)):
    q = db.query(Run).filter(Run.confidence_score.isnot(None))
    if project_id:
        q = q.filter(Run.project_id == project_id)
    runs = q.order_by(Run.started_at).all()
    return [
        {
            "run_id": str(r.id),
            "score": r.confidence_score,
            "started_at": r.started_at.isoformat(),
        }
        for r in runs
    ]
