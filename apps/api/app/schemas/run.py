from uuid import UUID
from datetime import datetime
from pydantic import BaseModel


class RunStart(BaseModel):
    project_id: UUID
    agent_id: UUID | None = None
    input: str | None = None


class RunEnd(BaseModel):
    final_output: str | None = None
    status: str = "success"
    confidence_score: float | None = None
    total_tokens: int | None = None
    estimated_cost_usd: float | None = None


class RunResponse(BaseModel):
    id: UUID
    project_id: UUID
    agent_id: UUID | None
    input: str | None
    final_output: str | None
    status: str
    confidence_score: float | None
    total_latency_ms: int | None
    total_tokens: int | None
    estimated_cost_usd: float | None
    failure_count: int
    started_at: datetime
    ended_at: datetime | None

    model_config = {"from_attributes": True}


class RunSummary(BaseModel):
    id: UUID
    project_id: UUID
    agent_id: UUID | None
    status: str
    confidence_score: float | None
    total_latency_ms: int | None
    failure_count: int
    started_at: datetime
    ended_at: datetime | None

    model_config = {"from_attributes": True}
