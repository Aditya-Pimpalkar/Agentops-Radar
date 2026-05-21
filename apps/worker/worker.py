import logging
from celery import Celery
from config import get_settings

settings = get_settings()
logging.basicConfig(level=settings.log_level, format="%(asctime)s %(name)s %(levelname)s %(message)s")

app = Celery(
    "agentops_radar_worker",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["tasks.evaluate", "tasks.detect_failures"],
)

app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)

if __name__ == "__main__":
    app.start()
