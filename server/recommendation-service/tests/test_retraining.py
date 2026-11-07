import asyncio
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.retraining import RetrainingScheduler


def test_retraining_passes_data_source_and_database_url():
    settings = SimpleNamespace(
        data_dir="/data",
        model_dir="/models",
        data_source="hybrid",
        database_url="postgresql://test",
        retrain_after_interactions=10,
    )
    scheduler = RetrainingScheduler(settings)
    process = SimpleNamespace(wait=AsyncMock(return_value=0))

    async def run():
        with patch("app.retraining.asyncio.create_subprocess_exec", AsyncMock(return_value=process)) as create:
            await scheduler.train()
            return create.await_args.args

    args = asyncio.run(run())
    assert args == (
        sys.executable,
        "-m",
        "app.ml.train",
        "--data-dir",
        "/data",
        "--model-dir",
        "/models",
        "--data-source",
        "hybrid",
        "--database-url",
        "postgresql://test",
    )
