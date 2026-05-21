from uuid import UUID
from datetime import datetime
from typing import Any
from pydantic import BaseModel, model_validator


class TraceEventCreate(BaseModel):
    event_type: str
    name: str | None = None
    input: dict[str, Any] | None = None
    output: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None
    latency_ms: int | None = None
    status: str = "success"
    error_message: str | None = None
    parent_event_id: UUID | None = None


class TraceEventResponse(BaseModel):
    id: UUID
    run_id: UUID
    parent_event_id: UUID | None
    event_type: str
    name: str | None
    input: dict[str, Any] | None
    output: dict[str, Any] | None
    metadata: dict[str, Any] | None = None
    latency_ms: int | None
    status: str
    error_message: str | None
    created_at: datetime

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def _extract_metadata(cls, data: Any) -> Any:
        if hasattr(data, "__tablename__"):
            return {
                "id": data.id,
                "run_id": data.run_id,
                "parent_event_id": data.parent_event_id,
                "event_type": data.event_type,
                "name": data.name,
                "input": data.input,
                "output": data.output,
                "metadata": data.metadata_,
                "latency_ms": data.latency_ms,
                "status": data.status,
                "error_message": data.error_message,
                "created_at": data.created_at,
            }
        return data
