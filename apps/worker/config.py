from pydantic_settings import BaseSettings
from functools import lru_cache


class WorkerSettings(BaseSettings):
    database_url: str = "postgresql://radar:radar@localhost:5432/agentops_radar"
    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/0"
    openai_api_key: str = ""
    llm_judge_model: str = "gpt-4o-mini"
    llm_judge_enabled: bool = False
    log_level: str = "INFO"

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> WorkerSettings:
    return WorkerSettings()
