import logging
from worker import app
from db import get_session
from evaluators.failure_detector import detect_run_failures

logger = logging.getLogger(__name__)


@app.task(bind=True, max_retries=3, default_retry_delay=15)
def detect_failures_async(self, run_id: str):
    logger.info(f"Detecting failures for run {run_id}")
    try:
        with get_session() as db:
            alerts = detect_run_failures(run_id=run_id, db=db)
            logger.info(f"Created {len(alerts)} alerts for run {run_id}")
            return {"run_id": run_id, "alerts": len(alerts)}
    except Exception as exc:
        logger.error(f"Failure detection failed for run {run_id}: {exc}")
        raise self.retry(exc=exc)
