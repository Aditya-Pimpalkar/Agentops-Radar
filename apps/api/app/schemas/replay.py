from uuid import UUID
from datetime import datetime
from pydantic import BaseModel


class ReplayRequest(BaseModel):
    model_name: str | None = None
    prompt_override: str | None = None
    guardrail_strictness: str | None = None
    disabled_tools: list[str] = []


class ReplayResponse(BaseModel):
    replay_run_id: UUID
    original_run_id: UUID
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ReplayComparison(BaseModel):
    original_run_id: UUID
    replay_run_id: UUID
    original_scores: dict
    replay_scores: dict
    score_delta: dict
    original_latency_ms: int | None
    replay_latency_ms: int | None
    latency_delta_ms: int | None
    original_status: str
    replay_status: str
    change_details: dict | None
