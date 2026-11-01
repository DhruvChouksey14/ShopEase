import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.events import consume, interaction_rows
from app.auth import require_internal_service_key
from fastapi import HTTPException


def test_user_event_maps_to_weighted_interaction():
    rows = interaction_rows({
        "eventId": "e1", "userId": "u1", "sessionId": "s1", "eventType": "add_to_cart",
        "productId": "p1", "ts": "2026-01-01T00:00:00Z",
    }, "recommendation.user-events")
    assert rows[0]["event_id"] == "e1"
    assert rows[0]["weight"] == 3.0


def test_order_confirmed_maps_each_item_and_ignores_invalid_events():
    rows = interaction_rows({"orderId": "o1", "userId": "u1", "items": [{"productId": "p1"}, {}]}, "order.confirmed")
    assert len(rows) == 1
    assert rows[0]["event_id"] == "purchase:o1:p1"
    assert interaction_rows({"eventType": "remove_from_cart", "productId": "p1"}, "recommendation.user-events") == []


def test_client_purchase_is_ignored_but_order_purchase_is_preserved():
    assert interaction_rows({"eventType": "purchase", "productId": "p1"}, "recommendation.user-events") == []
    assert interaction_rows({"orderId": "o1", "items": [{"productId": "p1"}]}, "order.confirmed")[0]["event_type"] == "purchase"


def test_internal_key_uses_constant_time_comparison(monkeypatch):
    compare = lambda left, right: True
    monkeypatch.setattr("app.auth.hmac.compare_digest", compare)
    require_internal_service_key("provided")
    with patch("app.auth.hmac.compare_digest", side_effect=AssertionError):
        try:
            require_internal_service_key(None)
        except HTTPException as error:
            assert error.status_code == 403


def test_failed_message_is_sent_to_dlq_before_commit(monkeypatch):
    class Consumer:
        def __init__(self, *args, **kwargs):
            self.committed = 0

        async def start(self): pass
        async def stop(self): pass
        async def commit(self): self.committed += 1

        def __aiter__(self):
            return self

        async def __anext__(self):
            if self.committed:
                raise StopAsyncIteration
            return SimpleNamespace(value=b"raw-event", topic="recommendation.user-events")

    producer = SimpleNamespace(start=AsyncMock(), stop=AsyncMock(), send_and_wait=AsyncMock())
    monkeypatch.setattr("app.events.AIOKafkaConsumer", Consumer)
    monkeypatch.setattr("app.events.AIOKafkaProducer", lambda **kwargs: producer)
    monkeypatch.setattr("app.events.EventStore", lambda *args: SimpleNamespace(initialize=lambda: None, insert=lambda rows: (_ for _ in ()).throw(RuntimeError("bad event"))))
    settings = SimpleNamespace(database_url="db", redis_url=None, kafka_broker="kafka")
    asyncio.run(consume(settings, asyncio.Event()))
    producer.send_and_wait.assert_awaited_once_with("recommendation.user-events.dlq", b"raw-event")
