from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.alert import Alert, AlertRule
from app.schemas.alert import AlertRuleCreate, AlertRuleResponse, AlertResponse
from app.middleware import require_api_key

router = APIRouter(prefix="/api/alerts", tags=["Alerts"])


@router.post("/rules", response_model=AlertRuleResponse, status_code=201, dependencies=[Depends(require_api_key)])
def create_alert_rule(body: AlertRuleCreate, db: Session = Depends(get_db)):
    rule = AlertRule(
        project_id=body.project_id,
        name=body.name,
        condition=body.condition,
        severity=body.severity,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


@router.get("/rules", response_model=list[AlertRuleResponse], dependencies=[Depends(require_api_key)])
def list_alert_rules(db: Session = Depends(get_db)):
    return db.query(AlertRule).order_by(AlertRule.created_at.desc()).all()


@router.get("", response_model=list[AlertResponse], dependencies=[Depends(require_api_key)])
def list_alerts(resolved: bool | None = None, db: Session = Depends(get_db)):
    q = db.query(Alert)
    if resolved is not None:
        q = q.filter(Alert.resolved == resolved)
    return q.order_by(Alert.created_at.desc()).all()


@router.patch("/{alert_id}/resolve", response_model=AlertResponse, dependencies=[Depends(require_api_key)])
def resolve_alert(alert_id: str, db: Session = Depends(get_db)):
    from uuid import UUID
    alert = db.query(Alert).filter(Alert.id == UUID(alert_id)).first()
    if not alert:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.resolved = True
    db.commit()
    db.refresh(alert)
    return alert
