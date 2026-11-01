from app.events import interaction_rows


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
