"""
eval_consumer — triggers evaluation after a run completes.

Subscribes to:
  • trace.run.end → runs rule-based evaluators on the completed run

Waits briefly after receiving run-end to allow the store_consumer to
write the run and its events to PostgreSQL before we query them.
"""
import logging
import os
import time

from sqlalchemy import create_engine

from consumers.base import make_consumer, run_consumer
from evaluators.rule_based import run_all_evaluators

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO")),
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger("eval_consumer")

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://radar:radar@postgres:5432/agentops_radar")

TOPICS = ["trace.run.end"]
GROUP_ID = os.getenv("KAFKA_GROUP_ID", "radar-eval")

# Short delay to let store_consumer finish writing before we evaluate.
EVAL_DELAY_SECONDS = float(os.getenv("EVAL_DELAY_SECONDS", "2.0"))

engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=3)


def handle(topic: str, envelope: dict) -> None:
    payload = envelope.get("payload", {})
    run_id = payload.get("run_id")
    if not run_id:
        logger.warning("run-end message missing run_id")
        return

    # Give store_consumer time to persist the run's events
    time.sleep(EVAL_DELAY_SECONDS)

    logger.info("evaluating run %s", run_id)
    try:
        from db import get_session
        with get_session() as db:
            results = run_all_evaluators(run_id=run_id, evaluator_names=None, db=db)
        logger.info(
            "evaluated run %s: %d evaluators completed",
            run_id,
            len(results),
        )
        for r in results:
            verdict = "PASS" if r.get("passed") else "FAIL"
            logger.debug(
                "  %s: %.3f (%s)",
                r.get("evaluator_name"),
                r.get("score", 0),
                verdict,
            )
    except Exception as exc:
        logger.exception("evaluation failed for run %s: %s", run_id, exc)


# ── entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logger.info("starting eval consumer (group=%s)", GROUP_ID)
    consumer = make_consumer(GROUP_ID, TOPICS)
    run_consumer(consumer, handle)
