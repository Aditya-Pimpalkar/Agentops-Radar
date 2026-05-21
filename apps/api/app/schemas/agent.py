from uuid import UUID
from datetime import datetime
from pydantic import BaseModel


class AgentCreate(BaseModel):
    project_id: UUID
    name: str
    framework: str | None = None
    model_provider: str | None = None
    model_name: str | None = None


class AgentResponse(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    framework: str | None
    model_provider: str | None
    model_name: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
