from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from .config import Settings

LOGGER = logging.getLogger(__name__)


class RetrainingScheduler:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.scheduler = AsyncIOScheduler()
        self.live_interactions = 0
        self.lock = asyncio.Lock()

    async def train(self) -> None:
        async with self.lock:
            process = await asyncio.create_subprocess_exec(sys.executable, "-m", "app.ml.train", "--data-dir", self.settings.data_dir, "--model-dir", self.settings.model_dir)
            result = await process.wait()
            if result:
                LOGGER.error("Recommendation retraining failed with exit code %s", result)
            else:
                LOGGER.info("Recommendation model retrained")
            self.live_interactions = 0

    def record(self, count: int) -> bool:
        self.live_interactions += count
        return self.live_interactions >= self.settings.retrain_after_interactions

    def start(self) -> None:
        self.scheduler.add_job(self.train, "interval", days=1, id="nightly-retrain", replace_existing=True)
        self.scheduler.start()

    async def stop(self) -> None:
        self.scheduler.shutdown(wait=False)