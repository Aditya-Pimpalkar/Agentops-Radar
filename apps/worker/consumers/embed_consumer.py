"""
embed_consumer — generates pgvector embeddings for completed runs.

Subscribes to:
  • trace.run.end  → embeds the run's final output + trace summary
                      using OpenAI text-embedding-3-small and stores
                      in the trace_embeddings table.

Only failed / low-confidence runs are embedded by default to keep
API costs down.  Set EMBED_ALL_RUNS=true to embed every run.
"""
import json
import logging
import os
import time
from typing import Optional

from sqlalchemy import create_engine, text

from consumers.base import make_consumer, run_consumer

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO")),
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger("embed_consumer")

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://radar:radar@postgres:5432/agentops_radar")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
EMBED_ALL_RUNS = os.getenv("EMBED_ALL_RUNS", "false").lower() == "true"
EMBED_MODEL = os.getenv("EMBED_MODEL", "text-embedding-3-small")
EMBED_DIMENSIONS = 1536  # text-embedding-3-small dimensions
EVAL_DELAY_SECONDS = float(os.getenv("EVAL_DELAY_SECONDS", "3.0"))

TOPICS = ["trace.run.end"]
GROUP_ID = os.getenv("KAFKA_GROUP_ID", "radar-embed")

engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=3)


def handle(topic: str, envelope: dict) -> None:
    payload = envelope.get("payload", {})
    run_id = payload.get("run_id")
    status = payload.get("status", "success")
    confidence = payload.get("confidence_score")

    if not run_id:
        return

    # Decide whether to embed this run
    should_embed = EMBED_ALL_RUNS or status in ("failed", "error")
    if not should_embed and confidence is not None and float(confidence) < 0.5:
        should_embed = True

    if not should_embed:
        logger.debug("skipping embedding for successful run %s", run_id)
        return

    if not OPENAI_API_KEY:
        logger.warning("OPENAI_API_KEY not set — skipping embedding for run %s", run_id)
        return

    # Give store_consumer time to write events before we build the embedding text
    time.sleep(EVAL_DELAY_SECONDS)

    logger.info("generating embedding for run %s (status=%s)", run_id, status)
    try:
        embedding_text = _build_embedding_text(run_id)
        if not embedding_text:
            logger.warning("no embedding text for run %s", run_id)
            return

        vector = _embed(embedding_text)
        if vector is None:
            return

        _upsert_embedding(run_id, vector, embedding_text)
        logger.info("stored embedding for run %s (dims=%d)", run_id, len(vector))
    except Exception as exc:
        logger.exception("embedding failed for run %s: %s", run_id, exc)


def _build_embedding_text(run_id: str) -> Optional[str]:
    """
    Construct a text representation of the run for embedding.
    Includes: input, final_output, key event types, failure signals.
    """
    with engine.connect() as conn:
        run = conn.execute(
            text("SELECT input, final_output, status, confidence_score FROM runs WHERE id = :id"),
            {"id": run_id},
        ).fetchone()
        if not run:
            return None

        events = conn.execute(
            text("""
                SELECT event_type, name, status, error_message, output
                FROM trace_events
                WHERE run_id = :id
                ORDER BY created_at
            """),
            {"id": run_id},
        ).fetchall()

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
        # Include retrieval hit counts as they're diagnostic signals
        if e.event_type == "retrieval" and e.output:
            try:
                out = json.loads(e.output) if isinstance(e.output, str) else e.output
                hits = out.get("hits", 0)
                summary += f" hits={hits}"
            except Exception:
                pass
        event_summaries.append(summary)

    if event_summaries:
        parts.append("trace: " + " | ".join(event_summaries))

    return "\n".join(parts)


def _embed(text_content: str) -> Optional[list[float]]:
    """Call OpenAI embeddings API and return the vector."""
    try:
        from openai import OpenAI
        client = OpenAI(api_key=OPENAI_API_KEY)
        resp = client.embeddings.create(
            model=EMBED_MODEL,
            input=text_content,
            dimensions=EMBED_DIMENSIONS,
        )
        return resp.data[0].embedding
    except Exception as exc:
        logger.error("OpenAI embedding call failed: %s", exc)
        return None


def _upsert_embedding(run_id: str, vector: list[float], text_content: str) -> None:
    """Store the embedding in the trace_embeddings table."""
    vector_str = "[" + ",".join(str(x) for x in vector) + "]"
    with engine.begin() as conn:
        conn.execute(
            text("""
                INSERT INTO trace_embeddings (id, run_id, model, embedding, embedding_text, created_at)
                VALUES (gen_random_uuid(), :run_id, :model, :embedding::vector, :text, NOW())
                ON CONFLICT (run_id) DO UPDATE
                  SET embedding        = EXCLUDED.embedding,
                      embedding_text   = EXCLUDED.embedding_text,
                      created_at       = NOW()
            """),
            {
                "run_id": run_id,
                "model": EMBED_MODEL,
                "embedding": vector_str,
                "text": text_content[:4000],
            },
        )


# ── entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logger.info("starting embed consumer (group=%s, model=%s)", GROUP_ID, EMBED_MODEL)
    consumer = make_consumer(GROUP_ID, TOPICS)
    run_consumer(consumer, handle)
