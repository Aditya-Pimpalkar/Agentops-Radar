"""
Semantic similarity endpoints — "find similar failures".

GET /api/runs/{run_id}/similar
  Returns the top-N runs whose trace embeddings are closest in cosine
  space to the given run. Requires pgvector and a stored embedding for
  the query run.

POST /api/runs/{run_id}/embed
  Explicitly trigger embedding generation for a run (useful after
  retroactively enabling OPENAI_API_KEY).
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware import require_api_key
from app.services.embedding_service import embed_run, search_similar

router = APIRouter(prefix="/api/runs", tags=["Similarity"])


class SimilarRun(BaseModel):
    run_id: str
    similarity: float
    status: str
    confidence_score: float | None
    final_output: str | None
    started_at: str | None
    total_latency_ms: int | None


class EmbedResponse(BaseModel):
    run_id: str
    embedded: bool
    message: str


@router.get(
    "/{run_id}/similar",
    response_model=list[SimilarRun],
    dependencies=[Depends(require_api_key)],
    summary="Find semantically similar runs",
    description=(
        "Uses pgvector cosine similarity on OpenAI trace embeddings to return the "
        "N runs most similar to the given run. Only runs that have been embedded "
        "are candidates. Embed a run with POST /api/runs/{id}/embed."
    ),
)
def get_similar_runs(
    run_id: UUID,
    limit: int = Query(5, ge=1, le=20),
    db: Session = Depends(get_db),
) -> list[SimilarRun]:
    results = search_similar(str(run_id), limit=limit, db=db)
    if not results:
        # Return empty list — no error, the run just has no embedding or no neighbors
        return []
    return [SimilarRun(**r) for r in results]


@router.post(
    "/{run_id}/embed",
    response_model=EmbedResponse,
    dependencies=[Depends(require_api_key)],
    summary="Generate embedding for a run",
    description="Explicitly generate and store a pgvector embedding for the given run.",
)
def trigger_embed(run_id: UUID, db: Session = Depends(get_db)) -> EmbedResponse:
    success = embed_run(str(run_id), db=db)
    return EmbedResponse(
        run_id=str(run_id),
        embedded=success,
        message="Embedding stored." if success else "Embedding skipped (no API key or run not found).",
    )
