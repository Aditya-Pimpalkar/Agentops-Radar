"""
embedding_service — generates OpenAI embeddings and performs pgvector
cosine similarity search to find semantically similar run traces.
"""
import json
import logging
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings

logger = logging.getLogger(__name__)

EMBED_MODEL = "text-embedding-3-small"
EMBED_DIMENSIONS = 1536
SIMILARITY_THRESHOLD = 0.5  # minimum cosine similarity to surface


def build_embedding_text(run, events: list) -> str:
    """
    Builds a compact text representation of a run for embedding.
    Keeps the most diagnostically relevant fields so the vector
    captures failure-mode semantics, not incidental metadata.
    """
    parts = []
    if run.input:
        parts.append(f"input: {run.input}")
    if run.final_output:
        parts.append(f"output: {run.final_output}")
    parts.append(f"status: {run.status}")
    if run.confidence_score is not None:
        parts.append(f"confidence: {run.confidence_score:.2f}")

    event_summaries = []
    for e in events:
        summary = f"{e.event_type}:{e.name or ''}:{e.status}"
        if e.status == "error" and e.error_message:
            summary += f" error={e.error_message}"
        if e.event_type == "retrieval" and e.output:
            out = e.output if isinstance(e.output, dict) else {}
            hits = out.get("hits", 0)
            summary += f" hits={hits}"
        event_summaries.append(summary)

    if event_summaries:
        parts.append("trace: " + " | ".join(event_summaries))

    return "\n".join(parts)


def embed_run(run_id: str, db: Session) -> bool:
    """
    Generate and store an embedding for the given run.
    Returns True if the embedding was stored, False otherwise.
    """
    settings = get_settings()
    if not settings.openai_api_key:
        logger.warning("OPENAI_API_KEY not configured — skipping embedding")
        return False

    from app.models.run import Run
    from app.models.trace_event import TraceEvent

    run = db.query(Run).filter(Run.id == UUID(run_id)).first()
    if not run:
        return False

    events = (
        db.query(TraceEvent)
        .filter(TraceEvent.run_id == run.id)
        .order_by(TraceEvent.created_at)
        .all()
    )

    text_content = build_embedding_text(run, events)
    vector = _call_openai(text_content, settings.openai_api_key)
    if vector is None:
        return False

    _upsert(db, run_id, vector, text_content)
    logger.info("embedded run %s (%d dims)", run_id, len(vector))
    return True


def search_similar(run_id: str, limit: int, db: Session) -> list[dict[str, Any]]:
    """
    Returns up to `limit` runs that are semantically similar to `run_id`,
    ordered by cosine similarity (highest first).

    Uses pgvector's <=> cosine distance operator.
    """
    # Fetch query embedding
    row = db.execute(
        text("SELECT embedding::text FROM trace_embeddings WHERE run_id = :id"),
        {"id": run_id},
    ).fetchone()

    if not row or not row[0]:
        return []

    query_vector = row[0]  # already formatted as '[0.1,0.2,...]'

    rows = db.execute(
        text("""
            SELECT
                te.run_id,
                1 - (te.embedding <=> :vec::vector) AS similarity,
                r.status,
                r.confidence_score,
                r.final_output,
                r.started_at,
                r.total_latency_ms
            FROM trace_embeddings te
            JOIN runs r ON r.id = te.run_id
            WHERE te.run_id != :run_id
              AND (1 - (te.embedding <=> :vec::vector)) >= :threshold
            ORDER BY te.embedding <=> :vec::vector   -- ascending distance = highest similarity first
            LIMIT :limit
        """),
        {
            "vec": query_vector,
            "run_id": run_id,
            "threshold": SIMILARITY_THRESHOLD,
            "limit": limit,
        },
    ).fetchall()

    return [
        {
            "run_id": str(r.run_id),
            "similarity": round(float(r.similarity), 4),
            "status": r.status,
            "confidence_score": float(r.confidence_score) if r.confidence_score else None,
            "final_output": r.final_output,
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "total_latency_ms": r.total_latency_ms,
        }
        for r in rows
    ]


# ── internal helpers ──────────────────────────────────────────────────────────

def _call_openai(text_content: str, api_key: str) -> list[float] | None:
    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        resp = client.embeddings.create(
            model=EMBED_MODEL,
            input=text_content,
            dimensions=EMBED_DIMENSIONS,
        )
        return resp.data[0].embedding
    except Exception as exc:
        logger.error("OpenAI embed failed: %s", exc)
        return None


def _upsert(db: Session, run_id: str, vector: list[float], text_content: str) -> None:
    vector_str = "[" + ",".join(str(x) for x in vector) + "]"
    db.execute(
        text("""
            INSERT INTO trace_embeddings (id, run_id, model, embedding, embedding_text, created_at)
            VALUES (gen_random_uuid(), :run_id, :model, :vec::vector, :text, NOW())
            ON CONFLICT (run_id) DO UPDATE
              SET embedding = EXCLUDED.embedding,
                  embedding_text = EXCLUDED.embedding_text,
                  created_at = NOW()
        """),
        {
            "run_id": run_id,
            "model": EMBED_MODEL,
            "vec": vector_str,
            "text": text_content[:4000],
        },
    )
    db.commit()
