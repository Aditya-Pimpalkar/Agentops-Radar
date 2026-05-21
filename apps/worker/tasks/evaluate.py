import logging
from worker import app
from db import get_session
from evaluators.rule_based import run_all_evaluators
from evaluators.llm_judge import run_llm_judge

logger = logging.getLogger(__name__)


@app.task(bind=True, max_retries=3, default_retry_delay=30)
def evaluate_run_async(self, run_id: str, evaluator_names: list[str] | None = None):
    logger.info(f"Starting evaluation for run {run_id}")
    try:
        with get_session() as db:
            results = run_all_evaluators(run_id=run_id, evaluator_names=evaluator_names, db=db)
            logger.info(f"Completed {len(results)} evaluations for run {run_id}")
            return {"run_id": run_id, "evaluations": len(results)}
    except Exception as exc:
        logger.error(f"Evaluation failed for run {run_id}: {exc}")
        raise self.retry(exc=exc)


@app.task(bind=True, max_retries=2, default_retry_delay=60)
def run_llm_judge_async(self, run_id: str):
    logger.info(f"Starting LLM judge for run {run_id}")
    try:
        with get_session() as db:
            result = run_llm_judge(run_id=run_id, db=db)
            return {"run_id": run_id, "llm_judge_result": result}
    except Exception as exc:
        logger.error(f"LLM judge failed for run {run_id}: {exc}")
        raise self.retry(exc=exc)
