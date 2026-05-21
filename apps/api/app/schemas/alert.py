from uuid import UUID
from datetime import datetime
from typing import Any
from pydantic import BaseModel


class AlertRuleCreate(BaseModel):
    project_id: UUID
    name: str
    condition: dict[str, Any]
    severity: str = "medium"


class AlertRuleResponse(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    condition: dict[str, Any]
    severity: str
    enabled: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class AlertResponse(BaseModel):
    id: UUID
    run_id: UUID | None
    severity: str
    alert_type: str
    message: str
    resolved: bool
    created_at: datetime

    model_config = {"from_attributes": True}
