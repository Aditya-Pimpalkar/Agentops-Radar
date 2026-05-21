from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    database_url: str = "postgresql://radar:radar@localhost:5432/agentops_radar"
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/0"
    api_key: str = "dev-api-key-change-in-production"
    secret_key: str = "change-this-secret-key-in-production"
    openai_api_key: str = ""
    llm_judge_model: str = "gpt-4o-mini"
    llm_judge_enabled: bool = False
    environment: str = "development"
    log_level: str = "INFO"

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
