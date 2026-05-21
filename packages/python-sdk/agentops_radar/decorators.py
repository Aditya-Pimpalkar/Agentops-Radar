import time
import functools
import logging
from typing import Any, Callable

logger = logging.getLogger(__name__)


def trace_event(
    event_type: str,
    name: str | None = None,
    run_context_arg: str = "run_ctx",
):
    """Decorator to automatically trace a function call as a trace event.

    The decorated function must receive a RunContext as the argument named
    by `run_context_arg` (default: 'run_ctx').
    """
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            ctx = kwargs.get(run_context_arg)
            if ctx is None:
                for a in args:
                    if hasattr(a, "event") and hasattr(a, "run_id"):
                        ctx = a
                        break
            if ctx is None:
                return func(*args, **kwargs)

            event_name = name or func.__name__
            start = time.time()
            try:
                result = func(*args, **kwargs)
                latency = int((time.time() - start) * 1000)
                output = result if isinstance(result, dict) else {"result": str(result)[:500]}
                ctx.event(
                    event_type=event_type,
                    name=event_name,
                    output=output,
                    latency_ms=latency,
                    status="success",
                )
                return result
            except Exception as e:
                latency = int((time.time() - start) * 1000)
                ctx.event(
                    event_type=event_type,
                    name=event_name,
                    latency_ms=latency,
                    status="error",
                    error_message=str(e),
                )
                raise
        return wrapper
    return decorator
