import httpx
import logging
from typing import Any

logger = logging.getLogger(__name__)


class RadarClient:
    def __init__(self, base_url: str, api_key: str, timeout: float = 10.0):
        self.base_url = base_url.rstrip("/")
        self.headers = {"X-API-Key": api_key, "Content-Type": "application/json"}
        self.timeout = timeout

    def _post(self, path: str, data: dict) -> dict:
        url = f"{self.base_url}{path}"
        with httpx.Client(timeout=self.timeout) as client:
            resp = client.post(url, json=data, headers=self.headers)
            resp.raise_for_status()
            return resp.json()

    def _get(self, path: str, params: dict | None = None) -> dict | list:
        url = f"{self.base_url}{path}"
        with httpx.Client(timeout=self.timeout) as client:
            resp = client.get(url, params=params, headers=self.headers)
            resp.raise_for_status()
            return resp.json()

    def create_project(self, name: str, description: str | None = None) -> dict:
        return self._post("/api/projects", {"name": name, "description": description})

    def register_agent(
        self,
        project_id: str,
        name: str,
        framework: str | None = None,
        model_provider: str | None = None,
        model_name: str | None = None,
    ) -> dict:
        return self._post("/api/agents", {
            "project_id": project_id,
            "name": name,
            "framework": framework,
            "model_provider": model_provider,
            "model_name": model_name,
        })

    def start_run(self, project_id: str, agent_id: str | None = None, input: str | None = None) -> dict:
        return self._post("/api/runs/start", {
            "project_id": project_id,
            "agent_id": agent_id,
            "input": input,
        })

    def send_event(
        self,
        run_id: str,
        event_type: str,
        name: str | None = None,
        input: dict[str, Any] | None = None,
        output: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
        latency_ms: int | None = None,
        status: str = "success",
        error_message: str | None = None,
        parent_event_id: str | None = None,
    ) -> dict:
        return self._post(f"/api/runs/{run_id}/events", {
            "event_type": event_type,
            "name": name,
            "input": input,
            "output": output,
            "metadata": metadata,
            "latency_ms": latency_ms,
            "status": status,
            "error_message": error_message,
            "parent_event_id": parent_event_id,
        })

    def end_run(
        self,
        run_id: str,
        final_output: str | None = None,
        status: str = "success",
        confidence_score: float | None = None,
        total_tokens: int | None = None,
        estimated_cost_usd: float | None = None,
    ) -> dict:
        return self._post(f"/api/runs/{run_id}/end", {
            "final_output": final_output,
            "status": status,
            "confidence_score": confidence_score,
            "total_tokens": total_tokens,
            "estimated_cost_usd": estimated_cost_usd,
        })

    def evaluate_run(self, run_id: str, evaluators: list[str] | None = None) -> list:
        body = {}
        if evaluators:
            body["evaluators"] = evaluators
        return self._post(f"/api/runs/{run_id}/evaluate", body)

    def replay_run(
        self,
        run_id: str,
        model_name: str | None = None,
        prompt_override: str | None = None,
        guardrail_strictness: str | None = None,
        disabled_tools: list[str] | None = None,
    ) -> dict:
        return self._post(f"/api/runs/{run_id}/replay", {
            "model_name": model_name,
            "prompt_override": prompt_override,
            "guardrail_strictness": guardrail_strictness,
            "disabled_tools": disabled_tools or [],
        })

    def get_run(self, run_id: str) -> dict:
        return self._get(f"/api/runs/{run_id}")

    def get_trace(self, run_id: str) -> list:
        return self._get(f"/api/runs/{run_id}/trace")

    def run(
        self,
        project_id: str,
        agent_id: str | None = None,
        input: str | None = None,
    ) -> "RunContext":
        from agentops_radar.run import RunContext
        return RunContext(client=self, project_id=project_id, agent_id=agent_id, input=input)
