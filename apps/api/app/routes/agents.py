from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.agent import Agent
from app.models.project import Project
from app.schemas.agent import AgentCreate, AgentResponse
from app.middleware import require_api_key

router = APIRouter(prefix="/api/agents", tags=["Agents"])


@router.post("", response_model=AgentResponse, status_code=201, dependencies=[Depends(require_api_key)])
def register_agent(body: AgentCreate, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == body.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    agent = Agent(
        project_id=body.project_id,
        name=body.name,
        framework=body.framework,
        model_provider=body.model_provider,
        model_name=body.model_name,
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return agent


@router.get("/{agent_id}", response_model=AgentResponse, dependencies=[Depends(require_api_key)])
def get_agent(agent_id: UUID, db: Session = Depends(get_db)):
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.get("", response_model=list[AgentResponse], dependencies=[Depends(require_api_key)])
def list_agents(project_id: UUID | None = None, db: Session = Depends(get_db)):
    q = db.query(Agent)
    if project_id:
        q = q.filter(Agent.project_id == project_id)
    return q.order_by(Agent.created_at.desc()).all()
