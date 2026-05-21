"""
Demo Incident Investigation Agent.

Demonstrates a realistic agent flow:
  1. Planner decides investigation strategy
  2. Log search retrieves relevant logs
  3. Metrics check trends
  4. Config lookup finds deployment changes
  5. Verifier validates root cause
  6. Final answer with recommendation

The entire flow is traced via AgentOps Radar SDK.
"""
import sys
import time
import logging
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent / "packages/python-sdk"))

from agentops_radar import RadarClient
from agent.tools import search_logs, check_metrics, get_deployment_config, verify_hypothesis

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def run_incident_investigation(
    incident: str,
    radar_url: str = "http://localhost:8000",
    api_key: str = "dev-api-key-change-in-production",
    project_id: str | None = None,
    agent_id: str | None = None,
    simulate_failure: bool = False,
) -> dict:
    client = RadarClient(base_url=radar_url, api_key=api_key)

    if not project_id:
        proj = client.create_project(
            name="Incident Investigation Demo",
            description="Demo agent for production incident debugging",
        )
        project_id = proj["id"]
        logger.info(f"Created project {project_id}")

    if not agent_id:
        agent = client.register_agent(
            project_id=project_id,
            name="Incident Investigation Agent",
            framework="Custom",
            model_provider="Rule-based",
            model_name="incident-v1",
        )
        agent_id = agent["id"]
        logger.info(f"Registered agent {agent_id}")

    with client.run(project_id=project_id, agent_id=agent_id, input=incident) as run_ctx:
        logger.info(f"Run started: {run_ctx.run_id}")

        # Step 1 — Planner
        time.sleep(0.1)
        run_ctx.event(
            event_type="agent_start",
            name="incident_planner",
            input={"incident": incident},
            metadata={"agent": "planner"},
            latency_ms=80,
        )
        run_ctx.event(
            event_type="planner_decision",
            name="plan",
            output={
                "steps": ["search_logs", "check_metrics", "get_deployment_config", "verify_hypothesis"],
                "rationale": "Latency spike suggests infra or DB issue — check logs, metrics, recent deploys",
            },
            latency_ms=120,
        )

        # Step 2 — Log search
        t = time.time()
        if simulate_failure:
            log_result = {"hits": 0, "results": [], "query": "checkout latency error", "total_searched": 150}
        else:
            log_result = search_logs(query="checkout latency error", service="checkout")
        latency = int((time.time() - t) * 1000)
        run_ctx.event(
            event_type="retrieval",
            name="search_logs",
            input={"query": "checkout latency error", "service": "checkout"},
            output=log_result,
            metadata={"tool": "log_search"},
            latency_ms=latency,
            status="success",
        )

        # Step 3 — Metrics
        t = time.time()
        latency_metrics = check_metrics("checkout_latency_p99_ms")
        error_metrics = check_metrics("checkout_error_rate")
        latency = int((time.time() - t) * 1000)
        run_ctx.event(
            event_type="tool_call",
            name="check_metrics",
            input={"metrics": ["checkout_latency_p99_ms", "checkout_error_rate"]},
            output={"latency": latency_metrics, "errors": error_metrics},
            metadata={"tool": "metrics_api"},
            latency_ms=latency,
            status="success",
        )

        # Step 4 — Deployment config
        t = time.time()
        deploy_config = get_deployment_config("v42")
        latency = int((time.time() - t) * 1000)
        run_ctx.event(
            event_type="retrieval",
            name="get_deployment_config",
            input={"version": "v42"},
            output=deploy_config,
            metadata={"tool": "config_store"},
            latency_ms=latency,
            status="success",
        )

        # Step 5 — Guardrail check
        run_ctx.event(
            event_type="guardrail_check",
            name="evidence_sufficiency",
            input={"min_evidence_items": 3},
            output={
                "evidence_items": 3 if not simulate_failure else 1,
                "sufficient": not simulate_failure,
            },
            latency_ms=30,
            status="success" if not simulate_failure else "error",
            error_message=None if not simulate_failure else "Insufficient evidence for confident diagnosis",
        )

        # Step 6 — Verify hypothesis
        evidence = []
        if not simulate_failure:
            evidence = [
                "Log: DB connection pool exhausted at 14:32",
                "Metric: latency spiked from 220ms to 2450ms after 14:31:50",
                f"Config: v42 reduced db.connection_pool.max_size from 50 to {deploy_config['changes'][0]['new'] if 'changes' in deploy_config else '?'}",
            ]
        t = time.time()
        verification = verify_hypothesis(
            hypothesis="DB connection pool exhaustion caused by v42 config change",
            evidence=evidence,
        )
        latency = int((time.time() - t) * 1000)
        run_ctx.event(
            event_type="tool_call",
            name="verify_hypothesis",
            input={"hypothesis": "DB connection pool exhaustion", "evidence_count": len(evidence)},
            output=verification,
            metadata={"tool": "verifier"},
            latency_ms=latency,
            status="success",
        )

        # Build final output
        if simulate_failure:
            final_output = "Investigation inconclusive. Evidence insufficient to confirm root cause. Recommend gathering more log data."
            confidence = 0.32
        else:
            final_output = (
                f"Root cause: DB connection pool exhaustion triggered by deployment v42. "
                f"v42 reduced max_size from 50 to {deploy_config['changes'][0]['new']}, "
                f"causing connection timeouts under normal load. "
                f"Recommendation: {verification['recommendation']}."
            )
            confidence = verification["confidence"]

        run_ctx.event(
            event_type="agent_end",
            name="final_answer",
            output={"answer": final_output, "confidence": confidence},
            latency_ms=50,
            status="success",
        )

        run_ctx.end(
            final_output=final_output,
            status="success" if not simulate_failure else "failed",
            confidence_score=confidence,
            total_tokens=850 if not simulate_failure else 320,
            estimated_cost_usd=0.0017 if not simulate_failure else 0.0006,
        )

        logger.info(f"Run completed: {run_ctx.run_id} | confidence={confidence}")
        return {
            "run_id": run_ctx.run_id,
            "final_output": final_output,
            "confidence": confidence,
        }
