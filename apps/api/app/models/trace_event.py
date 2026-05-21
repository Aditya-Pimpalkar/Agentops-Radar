import uuid
from datetime import datetime
from sqlalchemy import String, Text, DateTime, Integer, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.database import Base


class TraceEvent(Base):
    __tablename__ = "trace_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("runs.id"), nullable=False)
    parent_event_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("trace_events.id"))
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str | None] = mapped_column(String(255))
    input: Mapped[dict | None] = mapped_column(JSONB)
    output: Mapped[dict | None] = mapped_column(JSONB)
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(50), default="success")
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    run = relationship("Run", back_populates="trace_events")
    children = relationship("TraceEvent", back_populates="parent")
    parent = relationship("TraceEvent", back_populates="children", remote_side=[id])

    __table_args__ = (
        Index("ix_trace_events_run_id", "run_id"),
        Index("ix_trace_events_event_type", "event_type"),
    )
