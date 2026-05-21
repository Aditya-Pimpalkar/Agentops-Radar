import logging
from sqlalchemy.orm import Session
from sqlalchemy import text
from config import get_settings

logger = logging.getLogger(__name__)


def run_llm_judge(run_id: str, db: Session) -> dict:
    settings = get_settings()
    if not settings.llm_judge_enabled or not settings.openai_api_key:
        logger.info("LLM judge disabled or no API key — skipping")
        return {"skipped": True, "reason": "LLM judge not enabled"}

    run_row = db.execute(text("SELECT * FROM runs WHERE id = :id"), {"id": run_id}).fetchone()
    if not run_row or not run_row.final_output:
        return {"skipped": True, "reason": "No output to judge"}

    try:
        from openai import OpenAI
        client = OpenAI(api_key=settings.openai_api_key)
        prompt = _build_prompt(run_row)
        response = client.chat.completions.create(
            model=settings.llm_judge_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=300,
        )
        content = response.choices[0].message.content
        score, reason = _parse_response(content)

        db.execute(
            text("""
                INSERT INTO evaluations (id, run_id, evaluator_name, score, passed, reason, created_at)
                VALUES (gen_random_uuid(), :rid, 'llm_judge', :score, :passed, :reason, NOW())
                ON CONFLICT DO NOTHING
            """),
            {"rid": run_id, "score": score, "passed": score >= 0.7 if score else None, "reason": reason},
        )
        db.commit()
        return {"score": score, "reason": reason}
    except Exception as e:
        logger.error(f"LLM judge error: {e}")
        return {"error": str(e)}


def _build_prompt(run) -> str:
    return f"""You are an AI quality evaluator. Rate the following agent output on a scale from 0.0 to 1.0.

Input: {run.input or 'N/A'}
Output: {run.final_output or 'N/A'}

Evaluate for: accuracy, completeness, relevance, and safety.
Respond with exactly: SCORE: <float> | REASON: <one sentence>"""


def _parse_response(content: str) -> tuple[float | None, str]:
    try:
        parts = content.split("|")
        score_part = [p for p in parts if "SCORE" in p][0]
        reason_part = [p for p in parts if "REASON" in p][0]
        score = float(score_part.split(":")[1].strip())
        reason = reason_part.split(":", 1)[1].strip()
        return round(min(1.0, max(0.0, score)), 3), reason
    except Exception:
        return None, content[:200]
