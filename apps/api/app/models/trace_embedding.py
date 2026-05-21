"""
trace_embeddings — pgvector table for semantic similarity search.

Each row stores an OpenAI embedding of a run's trace summary.
The embedding enables "find similar failures" queries using cosine distance.

Uses pgvector's VECTOR type via a raw DDL approach (SQLAlchemy doesn't
ship a native Vector type; we register it at table creation time).
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    Column, DateTime, ForeignKey, Index, String, Text, event
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, engine


class TraceEmbedding(Base):
    __tablename__ = "trace_embeddings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("runs.id", ondelete="CASCADE"), unique=True, nullable=False)
    model: Mapped[str] = mapped_column(String(100), default="text-embedding-3-small", nullable=False)
    # The vector column is defined via DDL (see _create_vector_column below)
    # SQLAlchemy sees it as a generic Text column for ORM purposes,
    # but PostgreSQL stores it as vector(1536).
    embedding_text: Mapped[str | None] = mapped_column(Text)  # text that was embedded (debug)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_trace_embeddings_run_id", "run_id"),
    )


def ensure_pgvector(db_engine=None) -> None:
    """
    Enable the pgvector extension and create the trace_embeddings table
    with a proper VECTOR(1536) column + IVFFlat index for ANN search.

    Called once at API startup after create_all().
    """
    target = db_engine or engine
    with target.begin() as conn:
        # 1. Enable extension (idempotent)
        conn.execute(__import__("sqlalchemy").text(
            "CREATE EXTENSION IF NOT EXISTS vector"
        ))

        # 2. Add the vector column if it doesn't exist yet
        conn.execute(__import__("sqlalchemy").text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'trace_embeddings'
                      AND column_name = 'embedding'
                ) THEN
                    ALTER TABLE trace_embeddings
                    ADD COLUMN embedding vector(1536);
                END IF;
            END
            $$
        """))

        # 3. Create IVFFlat index for approximate nearest-neighbour search.
        #    lists=100 is a reasonable starting point for < 1 M vectors.
        conn.execute(__import__("sqlalchemy").text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_indexes
                    WHERE tablename = 'trace_embeddings'
                      AND indexname = 'ix_trace_embeddings_embedding_cosine'
                ) THEN
                    CREATE INDEX ix_trace_embeddings_embedding_cosine
                    ON trace_embeddings
                    USING ivfflat (embedding vector_cosine_ops)
                    WITH (lists = 100);
                END IF;
            END
            $$
        """))
