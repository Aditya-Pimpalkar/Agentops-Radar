"""
store_consumer — writes ingested traces to PostgreSQL.

Subscribes to:
  • trace.run.start  → INSERT INTO runs
  • trace.event.add  → INSERT INTO trace_events
  • trace.run.end    → UPDATE runs SET final_output, status, …
"""
import json
import logging
import os
import sys
import uuid
from datetime import datetime

from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

from consumers.base import make_consumer, run_consumer

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO")),
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger("store_consumer")

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://radar:radar@postgres:5432/agentops_radar")

TOPICS = ["trace.run.start", "trace.event.add", "trace.run.end"]
GROUP_ID = os.getenv("KAFKA_GROUP_ID", "radar-store")

engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=5)


def handle(topic: str, envelope: dict) -> None:
    payload = envelope.get("payload", {})
    api_key = envelope.get("api_key", "")

    if topic == "trace.run.start":
        _store_run_start(payload)
    elif topic == "trace.event.add":
        _store_event(payload)
    elif topic == "trace.run.end":
        _store_run_end(payload)
    else:
        logger.warning("unknown topic: %s", topic)


# ── handlers ──────────────────────────────────────────────────────────────────

def _store_run_start(p: dict) -> None:
    run_id = p.get("run_id") or str(uuid.uuid4())
    with engine.begin() as conn:
        existing = conn.execute(
            text("SELECT id FROM runs WHERE id = :id"),
            {"id": run_id},
        ).fetchone()
        if existing:
            logger.debug("run %s already stored, skipping", run_id)
            return
        conn.execute(
            text("""
                INSERT INTO runs
                  (id, project_id, agent_id, input, status, started_at, failure_count)
                VALUES
                  (:id, :project_id, :agent_id, :input, 'running', NOW(), 0)
                ON CONFLICT (id) DO NOTHING
            """),
            {
                "id": run_id,
                "project_id": p.get("project_id"),
                "agent_id": p.get("agent_id") or None,
                "input": p.get("input") or None,
            },
        )
    logger.info("stored run start: %s", run_id)


def _store_event(p: dict) -> None:
    event_id = p.get("event_id") or str(uuid.uuid4())
    run_id = p.get("run_id")
    if not run_id:
        logger.warning("event missing run_id, skipping: %s", p)
        return

    try:
        _do_store_event(event_id, run_id, p)
    except IntegrityError as exc:
        # run.start message may not have arrived yet on a different topic partition.
        # Since messages for the same run_id are co-partitioned, this is rare —
        # log and skip rather than using a fake project_id.
        logger.warning("skipping event %s — run %s not yet stored: %s", event_id, run_id, exc.orig)


def _do_store_event(event_id: str, run_id: str, p: dict) -> None:
    with engine.begin() as conn:
        status = p.get("status", "success")
        conn.execute(
            text("""
                INSERT INTO trace_events
                  (id, run_id, parent_event_id, event_type, name,
                   input, output, metadata, latency_ms, status, error_message, created_at)
                VALUES
                  (:id, :run_id, :parent_id, :event_type, :name,
                   :input, :output, :metadata, :latency_ms, :status, :error_message, NOW())
                ON CONFLICT (id) DO NOTHING
            """),
            {
                "id": event_id,
                "run_id": run_id,
                "parent_id": p.get("parent_event_id") or None,
                "event_type": p.get("event_type"),
                "name": p.get("name") or None,
                "input": json.dumps(p["input"]) if p.get("input") else None,
                "output": json.dumps(p["output"]) if p.get("output") else None,
                "metadata": json.dumps(p["metadata"]) if p.get("metadata") else None,
                "latency_ms": p.get("latency_ms") or None,
                "status": status,
                "error_message": p.get("error_message") or None,
            },
        )

        # Increment failure_count on the run when an event fails
        if status == "error":
            conn.execute(
                text("UPDATE runs SET failure_count = COALESCE(failure_count, 0) + 1 WHERE id = :id"),
                {"id": run_id},
            )

    logger.debug("stored event %s (run=%s type=%s)", event_id, run_id, p.get("event_type"))


def _store_run_end(p: dict) -> None:
    run_id = p.get("run_id")
    if not run_id:
        return
    with engine.begin() as conn:
        conn.execute(
            text("""
                UPDATE runs SET
                  final_output      = :final_output,
                  status            = :status,
                  confidence_score  = :confidence,
                  total_tokens      = :tokens,
                  estimated_cost_usd = :cost,
                  ended_at          = NOW(),
                  total_latency_ms  = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000
                WHERE id = :id
            """),
            {
                "id": run_id,
                "final_output": p.get("final_output") or None,
                "status": p.get("status", "success"),
                "confidence": p.get("confidence_score") or None,
                "tokens": p.get("total_tokens") or None,
                "cost": p.get("estimated_cost_usd") or None,
            },
        )
    logger.info("stored run end: %s (status=%s)", run_id, p.get("status"))


# ── entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logger.info("starting store consumer (group=%s)", GROUP_ID)
    consumer = make_consumer(GROUP_ID, TOPICS)
    run_consumer(consumer, handle)
