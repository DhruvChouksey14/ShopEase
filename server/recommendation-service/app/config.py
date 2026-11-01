from functools import lru_cache
import os

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    port: int = 4010
    internal_service_key: str
    redis_url: str = "redis://localhost:6379"
    kafka_broker: str = "localhost:9093"
    data_source: str = "dataset"
    model_dir: str = "/models"
    database_url: str = "postgresql://admin:password@localhost:5432/recommendations"
    enable_consumer: bool = False
    enable_retraining: bool = False
    data_dir: str = "/data"
    retrain_after_interactions: int = 1000
    hybrid_item_item_weight: float = 0.35
    hybrid_als_weight: float = 0.25
    hybrid_content_weight: float = 0.20
    hybrid_popularity_weight: float = 0.20


def hybrid_weights() -> dict[str, float]:
    return {
        "item_item": float(os.getenv("HYBRID_ITEM_ITEM_WEIGHT", "0.35")),
        "als": float(os.getenv("HYBRID_ALS_WEIGHT", "0.25")),
        "content": float(os.getenv("HYBRID_CONTENT_WEIGHT", "0.20")),
        "popularity": float(os.getenv("HYBRID_POPULARITY_WEIGHT", "0.20")),
    }


@lru_cache
def get_settings() -> Settings:
    return Settings()
