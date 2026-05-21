from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.project import Project
from app.schemas.project import ProjectCreate, ProjectResponse
from app.middleware import require_api_key

router = APIRouter(prefix="/api/projects", tags=["Projects"])


@router.post("", response_model=ProjectResponse, status_code=201, dependencies=[Depends(require_api_key)])
def create_project(body: ProjectCreate, db: Session = Depends(get_db)):
    project = Project(name=body.name, description=body.description)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("", response_model=list[ProjectResponse], dependencies=[Depends(require_api_key)])
def list_projects(db: Session = Depends(get_db)):
    return db.query(Project).order_by(Project.created_at.desc()).all()


@router.get("/{project_id}", response_model=ProjectResponse, dependencies=[Depends(require_api_key)])
def get_project(project_id: UUID, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project
