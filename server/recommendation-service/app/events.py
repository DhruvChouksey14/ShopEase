from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from uuid import uuid4

import psycopg
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer

from .config import Settings

LOGGER = logging.getLogger(__name__)
EVENT_WEIGHTS = {"product_view": 1.0, "view": 1.0, "add_to_cart": 3.0, "purchase": 5.0}


def interaction_rows(payload: dict, topic: str) -> list[dict]:
    if topic.endswith("user-events"):
        event_type = payload.get("eventType")
        product_id = payload.get("productId")
        if event_type not in EVENT_WEIGHTS or event_type == "purchase" or not product_id:
            return []
        return [{"event_id": payload.get("eventId") or str(uuid4()), "user_id": payload.get("userId"), "session_id": payload.get("sessionId"), "product_id": product_id, "event_type": event_type, "weight": EVENT_WEIGHTS[event_type], "ts": payload.get("ts") or datetime.now(timezone.utc).isoformat()}]
    if topic.endswith("order.confirmed"):
        return [{"event_id": f"purchase:{payload.get('orderId')}:{item.get('productId')}", "user_id": payload.get("userId"), "session_id": None, "product_id": item.get("productId"), "event_type": "purchase", "weight": 5.0, "ts": payload.get("ts") or datetime.now(timezone.utc).isoformat()} for item in payload.get("items", []) if item.get("productId")]
    return []


class EventStore:
    def __init__(self, database_url: str, redis_url: str | None = None):
        self.database_url = database_url
        self.redis_url = redis_url
        self.redis = None
        if redis_url:
            try:
                import redis
                self.redis = redis.Redis.from_url(redis_url, decode_responses=True)
            except Exception:
                self.redis = None

    def initialize(self) -> None:
        with psycopg.connect(self.database_url) as connection:
            connection.execute("""
                CREATE TABLE IF NOT EXISTS recommendation_interactions (
                    event_id TEXT PRIMARY KEY,
                    user_id TEXT,
                    session_id TEXT,
                    product_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    weight DOUBLE PRECISION NOT NULL,
                    ts TIMESTAMPTZ NOT NULL
                )
            """)
            connection.commit()

    def insert(self, rows: list[dict]) -> None:
        if not rows:
            return
        with psycopg.connect(self.database_url) as connection:
            for row in rows:
                connection.execute("""
                    INSERT INTO recommendation_interactions(event_id, user_id, session_id, product_id, event_type, weight, ts)
                    VALUES (%(event_id)s, %(user_id)s, %(session_id)s, %(product_id)s, %(event_type)s, %(weight)s, %(ts)s)
                    ON CONFLICT (event_id) DO NOTHING
                """, row)
            connection.commit()
        if self.redis:
            for row in rows:
                if row.get("event_type") not in {"product_view", "add_to_cart"}:
                    continue
                owner = row.get("user_id") or f"session:{row.get('session_id')}"
                if owner == "session:None":
                    continue
                key = f"recommendation:history:{owner}"
                self.redis.lpush(key, json.dumps({"product_id": row["product_id"], "ts": row.get("ts")}))
                self.redis.ltrim(key, 0, 19)


async def consume(settings: Settings, stop_event: asyncio.Event, retraining=None) -> None:
    store = EventStore(settings.database_url, settings.redis_url)
    await asyncio.to_thread(store.initialize)
    consumer = AIOKafkaConsumer("recommendation.user-events", "order.confirmed", bootstrap_servers=settings.kafka_broker, group_id="recommendation-service-v1", enable_auto_commit=False)
    producer = AIOKafkaProducer(bootstrap_servers=settings.kafka_broker)
    await consumer.start()
    await producer.start()
    try:
        async for message in consumer:
            if stop_event.is_set():
                break
            try:
                rows = interaction_rows(json.loads(message.value), message.topic)
                await asyncio.to_thread(store.insert, rows)
                if retraining and retraining.record(len(rows)):
                    asyncio.create_task(retraining.train())
                await consumer.commit()
            except Exception as error:
                LOGGER.exception("Recommendation event processing failed")
                try:
                    await producer.send_and_wait("recommendation.user-events.dlq", message.value)
                    await consumer.commit()
                except Exception:
                    LOGGER.exception("Recommendation event DLQ publish failed")
    finally:
        await consumer.stop()
        await producer.stop()