import json
import time
import random
from pathlib import Path

SAMPLE_DATA = Path(__file__).parent.parent / "sample_data"


def search_logs(query: str, service: str | None = None, limit: int = 10) -> dict:
    """Query fake production logs matching the search criteria."""
    time.sleep(random.uniform(0.1, 0.4))
    with open(SAMPLE_DATA / "logs.json") as f:
        logs = json.load(f)
    results = []
    q_lower = query.lower()
    for log in logs:
        text = json.dumps(log).lower()
        if q_lower in text or (service and service.lower() in text):
            results.append(log)
    return {
        "query": query,
        "hits": len(results[:limit]),
        "results": results[:limit],
        "total_searched": len(logs),
    }


def check_metrics(metric_name: str, time_range: str = "last_5m") -> dict:
    """Check latency and error rate metrics for the given time range."""
    time.sleep(random.uniform(0.05, 0.2))
    with open(SAMPLE_DATA / "metrics.json") as f:
        metrics = json.load(f)
    result = metrics.get(metric_name, [])
    if not result:
        available = list(metrics.keys())
        return {"error": f"Metric '{metric_name}' not found", "available": available}
    values = [r["value"] for r in result]
    return {
        "metric": metric_name,
        "time_range": time_range,
        "data_points": len(result),
        "min": min(values),
        "max": max(values),
        "latest": values[-1] if values else None,
        "trend": "increasing" if len(values) >= 2 and values[-1] > values[0] else "stable",
        "series": result,
    }


def get_deployment_config(version: str) -> dict:
    """Retrieve deployment configuration changes for a given version."""
    time.sleep(random.uniform(0.05, 0.15))
    configs = {
        "v42": {
            "version": "v42",
            "changes": [
                {"key": "db.connection_pool.max_size", "old": 50, "new": 10, "reason": "cost optimization"},
                {"key": "db.connection_pool.timeout_ms", "old": 5000, "new": 2000, "reason": "fail-fast"},
                {"key": "checkout.cache_ttl_s", "old": 300, "new": 600, "reason": "reduce DB load"},
            ],
            "deployed_at": "2024-01-15T14:31:50Z",
            "deployed_by": "deploy-bot",
        }
    }
    return configs.get(version, {"error": f"Version {version} not found"})


def verify_hypothesis(hypothesis: str, evidence: list[str]) -> dict:
    """Validate a root cause hypothesis against gathered evidence."""
    time.sleep(random.uniform(0.2, 0.5))
    keywords = ["connection pool", "db", "deployment", "v42", "timeout", "latency"]
    score = sum(1 for kw in keywords if kw.lower() in hypothesis.lower()) / len(keywords)
    evidence_strength = min(1.0, len(evidence) * 0.2)
    confidence = round((score * 0.6 + evidence_strength * 0.4), 3)
    return {
        "hypothesis": hypothesis,
        "evidence_count": len(evidence),
        "confidence": confidence,
        "verdict": "supported" if confidence >= 0.6 else "weak",
        "recommendation": (
            "Increase DB connection pool size (max_size >= 30) and revert timeout to 5000ms"
            if confidence >= 0.6
            else "Gather more evidence before concluding"
        ),
    }
