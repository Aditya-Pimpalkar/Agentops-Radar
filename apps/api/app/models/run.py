import uuid
from datetime import datetime
from sqlalchemy import String, Text, DateTime, Float, Integer, Numeric, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    agent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("agents.id"))
    input: Mapped[str | None] = mapped_column(Text)
    final_output: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), default="running")
    confidence_score: Mapped[float | None] = mapped_column(Float)
    total_latency_ms: Mapped[int | None] = mapped_column(Integer)
    total_tokens: Mapped[int | None] = mapped_column(Integer)
    estimated_cost_usd: Mapped[float | None] = mapped_column(Numeric(10, 6))
    failure_count: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime)

    project = relationship("Project", back_populates="runs")
    agent = relationship("Agent", back_populates="runs")
    trace_events = relationship("TraceEvent", back_populates="run", cascade="all, delete-orphan")
    evaluations = relationship("Evaluation", back_populates="run", cascade="all, delete-orphan")
    alerts = relationship("Alert", back_populates="run")

    __table_args__ = (
        Index("ix_runs_project_id", "project_id"),
        Index("ix_runs_agent_id", "agent_id"),
        Index("ix_runs_status", "status"),
        Index("ix_runs_started_at", "started_at"),
    )
