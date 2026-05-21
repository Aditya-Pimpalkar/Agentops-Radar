"""
Demo runner for AgentOps Radar.

Usage:
    python main.py                          # Run successful investigation
    python main.py --fail                   # Run flawed investigation (for demo)
    python main.py --seed                   # Seed multiple demo runs
    python main.py --replay <run_id>        # Replay a failed run
"""
import argparse
import sys
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

RADAR_URL = os.getenv("RADAR_URL", "http://localhost:8000")
API_KEY = os.getenv("API_KEY", "dev-api-key-change-in-production")

INCIDENT = "Checkout latency increased from 200ms to 2.4s after deployment v42. Investigate the root cause."


def run_success():
    from agent.incident_agent import run_incident_investigation
    result = run_incident_investigation(
        incident=INCIDENT,
        radar_url=RADAR_URL,
        api_key=API_KEY,
        simulate_failure=False,
    )
    print(f"\n✅ Successful run: {result['run_id']}")
    print(f"   Confidence: {result['confidence']}")
    print(f"   Output: {result['final_output'][:120]}...")
    return result


def run_failure():
    from agent.incident_agent import run_incident_investigation
    result = run_incident_investigation(
        incident=INCIDENT,
        radar_url=RADAR_URL,
        api_key=API_KEY,
        simulate_failure=True,
    )
    print(f"\n❌ Failed run: {result['run_id']}")
    print(f"   Confidence: {result['confidence']}")
    print(f"   Output: {result['final_output']}")
    return result


def seed_runs():
    import sys
    sys.path.insert(0, "../../packages/python-sdk")
    from agentops_radar import RadarClient
    client = RadarClient(base_url=RADAR_URL, api_key=API_KEY)

    proj = client.create_project(
        name="Incident Investigation Demo",
        description="Seeded demo data for AgentOps Radar",
    )
    project_id = proj["id"]
    agent = client.register_agent(
        project_id=project_id,
        name="Incident Investigation Agent",
        framework="Custom",
        model_provider="Rule-based",
        model_name="incident-v1",
    )
    agent_id = agent["id"]

    print(f"\nProject: {project_id}")
    print(f"Agent: {agent_id}")

    from agent.incident_agent import run_incident_investigation
    for i in range(3):
        result = run_incident_investigation(
            incident=INCIDENT,
            radar_url=RADAR_URL,
            api_key=API_KEY,
            project_id=project_id,
            agent_id=agent_id,
            simulate_failure=False,
        )
        client.evaluate_run(result["run_id"])
        print(f"  ✅ Run {i+1}: {result['run_id']}")

    failed = run_incident_investigation(
        incident=INCIDENT,
        radar_url=RADAR_URL,
        api_key=API_KEY,
        project_id=project_id,
        agent_id=agent_id,
        simulate_failure=True,
    )
    client.evaluate_run(failed["run_id"])
    print(f"\n  ❌ Failed run: {failed['run_id']}")

    replay = client.replay_run(
        run_id=failed["run_id"],
        prompt_override="Use strict evidence validation. Require at least 3 corroborating sources.",
        guardrail_strictness="high",
    )
    print(f"\n  🔄 Replay: {replay['replay_run_id']}")
    print(f"\nOpen dashboard: http://localhost:3000/dashboard")
    print(f"View run: http://localhost:3000/runs/{failed['run_id']}")


def replay_run(run_id: str):
    sys.path.insert(0, "../../packages/python-sdk")
    from agentops_radar import RadarClient
    client = RadarClient(base_url=RADAR_URL, api_key=API_KEY)
    result = client.replay_run(
        run_id=run_id,
        prompt_override="Use strict evidence validation before answering.",
        guardrail_strictness="high",
    )
    print(f"\n🔄 Replay queued: {result['replay_run_id']}")
    print(f"   Status: {result['status']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AgentOps Radar Demo Agent")
    parser.add_argument("--fail", action="store_true", help="Run a failing scenario")
    parser.add_argument("--seed", action="store_true", help="Seed multiple demo runs")
    parser.add_argument("--replay", metavar="RUN_ID", help="Replay a specific run")
    args = parser.parse_args()

    if args.seed:
        seed_runs()
    elif args.fail:
        run_failure()
    elif args.replay:
        replay_run(args.replay)
    else:
        run_success()
