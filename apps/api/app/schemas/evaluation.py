from uuid import UUID
from datetime import datetime
from typing import Any
from pydantic import BaseModel, model_validator


class EvaluationRequest(BaseModel):
    evaluators: list[str] = [
        "groundedness", "relevance", "safety",
        "tool_call_correctness", "latency", "format_compliance",
        "retry_loop", "evidence",
    ]


class EvaluationResponse(BaseModel):
    id: UUID
    run_id: UUID
    evaluator_name: str
    score: float | None
    passed: bool | None
    reason: str | None
    metadata: dict[str, Any] | None = None
    created_at: datetime

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def _extract_metadata(cls, data: Any) -> Any:
        # ORM objects have a class-level SQLAlchemy MetaData() on `.metadata`
        # that shadows our column. Pull from `metadata_` instead.
        if hasattr(data, "__tablename__"):
            return {
                "id": data.id,
                "run_id": data.run_id,
                "evaluator_name": data.evaluator_name,
                "score": data.score,
                "passed": data.passed,
                "reason": data.reason,
                "metadata": data.metadata_,
                "created_at": data.created_at,
            }
        return data
