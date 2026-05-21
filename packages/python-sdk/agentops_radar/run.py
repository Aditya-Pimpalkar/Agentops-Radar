import time
import logging
from contextlib import contextmanager
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from agentops_radar.client import RadarClient

logger = logging.getLogger(__name__)


class RunContext:
    def __init__(self, client: "RadarClient", project_id: str, agent_id: str | None, input: str | None):
        self._client = client
        self._project_id = project_id
        self._agent_id = agent_id
        self._input = input
        self._run_id: str | None = None

    def __enter__(self):
        data = self._client.start_run(
            project_id=self._project_id,
            agent_id=self._agent_id,
            input=self._input,
        )
        self._run_id = data["id"]
        logger.info(f"Started run {self._run_id}")
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            self.end(status="failed", final_output=str(exc_val))
        return False

    @property
    def run_id(self) -> str:
        if not self._run_id:
            raise RuntimeError("RunContext has not been started — use as a context manager")
        return self._run_id

    def event(
        self,
        event_type: str,
        name: str | None = None,
        input: dict[str, Any] | None = None,
        output: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
        latency_ms: int | None = None,
        status: str = "success",
        error_message: str | None = None,
    ) -> dict:
        return self._client.send_event(
            run_id=self.run_id,
            event_type=event_type,
            name=name,
            input=input,
            output=output,
            metadata=metadata,
            latency_ms=latency_ms,
            status=status,
            error_message=error_message,
        )

    def end(
        self,
        final_output: str | None = None,
        status: str = "success",
        confidence_score: float | None = None,
        total_tokens: int | None = None,
        estimated_cost_usd: float | None = None,
    ) -> dict:
        return self._client.end_run(
            run_id=self.run_id,
            final_output=final_output,
            status=status,
            confidence_score=confidence_score,
            total_tokens=total_tokens,
            estimated_cost_usd=estimated_cost_usd,
        )

    @contextmanager
    def trace(
        self,
        event_type: str,
        name: str | None = None,
        metadata: dict[str, Any] | None = None,
    ):
        start = time.time()
        event_input: dict | None = None
        event_output: dict | None = None
        try:
            yield _TraceCapture(lambda i: setattr(self, "_last_input", i),
                                lambda o: setattr(self, "_last_output", o))
            latency = int((time.time() - start) * 1000)
            self.event(
                event_type=event_type,
                name=name,
                input=getattr(self, "_last_input", None),
                output=getattr(self, "_last_output", None),
                metadata=metadata,
                latency_ms=latency,
                status="success",
            )
        except Exception as e:
            latency = int((time.time() - start) * 1000)
            self.event(
                event_type=event_type,
                name=name,
                metadata=metadata,
                latency_ms=latency,
                status="error",
                error_message=str(e),
            )
            raise


class _TraceCapture:
    def __init__(self, set_input, set_output):
        self._set_input = set_input
        self._set_output = set_output

    def set_input(self, data: dict):
        self._set_input(data)

    def set_output(self, data: dict):
        self._set_output(data)
