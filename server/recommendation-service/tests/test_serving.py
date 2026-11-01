import os

os.environ["INTERNAL_SERVICE_KEY"] = "test-key"

from fastapi.testclient import TestClient

from app.main import app
from app.serving import RecommendationEngine
import pandas as pd


class FakeCache:
    def __init__(self):
        self.values = {}
        self.writes = []

    async def get(self, key):
        return self.values.get(key)

    async def set(self, key, value):
        self.values[key] = value
        self.writes.append(key)


class FakeEngine:
    def user(self, user_id, session_id, limit):
        return [{"productId": user_id or session_id, "score": 1.0, "reason": "Recommended for you"}]

    def product(self, product_id, kind, limit):
        return [{"productId": "p2", "score": 0.8, "reason": kind}]

    def cart(self, product_ids, limit):
        return [{"productId": "p3", "score": 0.7, "reason": "You may also like"}]

    def popular(self, category_id, limit):
        return [{"productId": "p4", "score": 0.6, "reason": "trending"}]


client = TestClient(app)


def setup_function():
    app.state.cache = FakeCache()
    app.state.engine = FakeEngine()


def headers():
    return {"x-internal-service-key": "test-key"}


def test_user_recommendations_use_trusted_header_or_session():
    assert client.get("/recommendations/user", headers=headers()).status_code == 400
    response = client.get("/recommendations/user?sessionId=s1", headers=headers())
    assert response.json()["data"]["products"][0]["productId"] == "s1"
    response = client.get("/recommendations/user", headers={**headers(), "x-user-id": "u1"})
    assert response.json()["data"]["products"][0]["productId"] == "u1"


def test_product_cart_popular_and_cache():
    product = client.get("/recommendations/product/p1?type=together", headers=headers())
    assert product.status_code == 200
    assert product.json()["data"]["products"][0]["reason"] == "together"
    cart = client.get("/recommendations/cart?productIds=p1,p2", headers=headers())
    assert cart.status_code == 200
    popular = client.get("/recommendations/popular?categoryId=c1", headers=headers())
    assert popular.status_code == 200
    assert len(app.state.cache.writes) == 3
    client.get("/recommendations/product/p1?type=together", headers=headers())
    assert len(app.state.cache.writes) == 3


def test_product_together_uses_item_item_cosine_and_similar_blends(tmp_path):
    class Collaborative:
        def item_item_cosine(self, product_id, limit):
            return [("cosine", 0.9)]

        def together(self, product_id, limit):
            return [("als-fallback", 0.8)]

    class Content:
        def similar(self, product_id, limit):
            return [("content", 0.9)]

    class Bundle:
        collaborative = Collaborative()
        content = Content()

    engine = RecommendationEngine(tmp_path)
    engine.bundle = Bundle()
    engine.reload = lambda: None
    together = engine.product("source", "together", 1)
    similar = engine.product("source", "similar", 2)
    assert together[0]["productId"] == "cosine"
    assert {item["productId"] for item in similar} == {"cosine", "content"}


def test_routes_require_internal_key_and_validate_type():
    assert client.get("/recommendations/popular").status_code == 403
    assert client.get("/recommendations/product/p1?type=bad", headers=headers()).status_code == 422


def test_engine_popular_is_time_decayed_and_category_aware(tmp_path):
    class Bundle:
        interactions = pd.DataFrame([
            {"user_id": "u1", "product_id": "old", "weight": 10, "ts": 1},
            {"user_id": "u1", "product_id": "new", "weight": 2, "ts": 100000},
        ])
        products = pd.DataFrame({"product_id": ["old", "new"], "category_id": ["a", "b"]})

    engine = RecommendationEngine(tmp_path)
    engine.bundle = Bundle()
    engine.reload = lambda: None
    assert engine.popular("b", 1)[0]["productId"] == "new"


def test_engine_hybrid_combines_cf_content_and_popularity(tmp_path):
    class Collaborative:
        def recommend(self, user_id, limit):
            return [("cf", 1.0)]

    class Content:
        def similar(self, product_id, limit):
            return [("content", 1.0)]

    class Bundle:
        collaborative = Collaborative()
        content = Content()
        interactions = pd.DataFrame([
            {"user_id": "u1", "product_id": "viewed", "weight": 1, "ts": 100000},
            {"user_id": "u2", "product_id": "popular", "weight": 5, "ts": 100000},
        ])
        products = pd.DataFrame({"product_id": ["cf", "content", "popular", "viewed"], "category_id": ["a", "b", "c", "a"]})

    engine = RecommendationEngine(tmp_path)
    engine.bundle = Bundle()
    engine.reload = lambda: None
    result = engine.user("u1", None, 3)
    assert {item["productId"] for item in result} == {"cf", "content", "popular"}


def test_engine_cold_start_uses_session_views(tmp_path):
    class Collaborative:
        def recommend(self, user_id, limit):
            return []

    class Content:
        def similar(self, product_id, limit):
            return [("content", 1.0)] if product_id == "viewed" else []

    class Bundle:
        collaborative = Collaborative()
        content = Content()
        interactions = pd.DataFrame([
            {"session_id": "s1", "product_id": "viewed", "weight": 1, "ts": 100000},
            {"session_id": "other", "product_id": "popular", "weight": 5, "ts": 100000},
        ])
        products = pd.DataFrame({"product_id": ["viewed", "content", "popular"], "category_id": ["a", "b", "c"]})

    engine = RecommendationEngine(tmp_path)
    engine.bundle = Bundle()
    engine.reload = lambda: None
    result = engine.user(None, "s1", 2)
    assert "content" in {item["productId"] for item in result}


def test_engine_cold_start_prefers_redis_history(tmp_path):
    class FakeHistory:
        def lrange(self, key, start, end):
            return ['{"product_id": "redis-viewed", "ts": 2}']

    class Content:
        def similar(self, product_id, limit):
            return [("redis-content", 1.0)] if product_id == "redis-viewed" else []

    class Collaborative:
        def recommend(self, user_id, limit):
            return []

    class Bundle:
        collaborative = Collaborative()
        content = Content()
        interactions = pd.DataFrame([{"session_id": "s1", "product_id": "fallback", "weight": 1, "ts": 1}])
        products = pd.DataFrame({"product_id": ["redis-viewed", "redis-content", "fallback"], "category_id": ["a", "b", "c"]})

    engine = RecommendationEngine(tmp_path)
    engine.bundle = Bundle()
    engine.history = FakeHistory()
    engine.reload = lambda: None
    result = engine.user(None, "s1", 2)
    assert "redis-content" in {item["productId"] for item in result}
