from __future__ import annotations

import json
import math
import os
import time
from pathlib import Path
from typing import Any

import joblib

from .ml.ranker import rerank
from .ml.hybrid import hybrid_rank
from .ml.timeutil import to_seconds
from .config import hybrid_weights


class RecommendationEngine:
    def __init__(self, model_dir: str | Path, redis_url: str | None = None):
        self.model_dir = Path(model_dir)
        self.bundle: Any = None
        self.loaded_target: str | None = None
        self.weights = hybrid_weights()
        self.history = None
        if redis_url:
            try:
                import redis
                self.history = redis.Redis.from_url(redis_url, decode_responses=True)
            except Exception:
                self.history = None

    def reload(self) -> None:
        current = self.model_dir / "current"
        model_path = current / "model.pkl"
        target = str(current.resolve()) if current.exists() else None
        if target == self.loaded_target:
            return
        if model_path.exists():
            import __main__
            from .ml.bundle import Bundle

            if not hasattr(__main__, "Bundle"):
                setattr(__main__, "Bundle", Bundle)
            self.bundle = joblib.load(model_path)
        else:
            self.bundle = None
        self.loaded_target = target

    def user(self, user_id: str | None, session_id: str | None, limit: int = 10) -> list[dict[str, Any]]:
        self.reload()
        if not self.bundle:
            return []
        weights = getattr(self.bundle, "hybrid_weights", None) or self.weights
        recent = self._recent_items(user_id, session_id)
        als_rows = []
        if user_id:
            als_rows = self.bundle.collaborative.recommend(user_id, limit * 2)
        item_rows = self._item_item_candidates(user_id, limit * 2)
        content_rows = self._content_candidates(recent, limit * 2)
        popularity_rows = self._popular_candidates(limit * 3)
        seen = set(recent)
        hybrid_rows = hybrid_rank(item_item=item_rows, als=als_rows, content=content_rows, popularity=popularity_rows, weights=weights, limit=limit * 2, excluded=seen)
        ranked = rerank([{"product_id": item, "score": score} for item, score in hybrid_rows], category_by_id=self._categories(), limit=limit)
        return self._rank([(item["product_id"], item["score"]) for item in ranked], "Recommended for you")

    def product(self, product_id: str, kind: str, limit: int = 10) -> list[dict[str, Any]]:
        self.reload()
        if not self.bundle:
            return []
        if kind == "together":
            cosine = getattr(self.bundle.collaborative, "item_item_cosine", None)
            values = cosine(product_id, limit) if cosine else []
            if not values:
                values = self.bundle.collaborative.together(product_id, limit)
            reason = "bought together"
        else:
            content_rows = self.bundle.content.similar(product_id, limit * 2)
            cosine = getattr(self.bundle.collaborative, "item_item_cosine", None)
            item_rows = cosine(product_id, limit * 2) if cosine else []
            from .ml.hybrid import hybrid_rank
            values = hybrid_rank(content=content_rows, item_item=item_rows, limit=limit)
            reason = "similar"
        return self._rank(values, reason)

    def cart(self, product_ids: list[str], limit: int = 10) -> list[dict[str, Any]]:
        self.reload()
        if not self.bundle:
            return []
        values: dict[str, float] = {}
        for product_id in product_ids:
            for candidate, score in self.bundle.content.similar(product_id, limit):
                if candidate not in product_ids:
                    values[candidate] = max(values.get(candidate, 0), score)
        return self._rank(sorted(values.items(), key=lambda item: item[1], reverse=True)[:limit], "You may also like")

    def popular(self, category_id: str | None = None, limit: int = 10) -> list[dict[str, Any]]:
        self.reload()
        values = self._popular_candidates(limit, category_id)
        return self._rank(values, "trending")

    def _interactions(self):
        return getattr(self.bundle, "interactions", None)

    def _categories(self) -> dict[str, str]:
        products = getattr(self.bundle, "products", None)
        if products is None or "product_id" not in products:
            return {}
        category_column = "category_id" if "category_id" in products else "category"
        return dict(zip(products["product_id"].astype(str), products[category_column].astype(str)))

    def _popular_candidates(self, limit: int, category_id: str | None = None) -> list[tuple[str, float]]:
        rows = self._interactions()
        if rows is None or rows.empty:
            return []
        rows = rows.copy()
        if category_id:
            allowed = {item for item, category in self._categories().items() if category == category_id}
            rows = rows[rows["product_id"].astype(str).isin(allowed)]
        timestamps = rows.get("ts")
        if timestamps is None:
            decay = 1.0
            rows["score"] = rows.get("weight", 1.0)
        else:
            values = to_seconds(timestamps.astype(float))
            now = float(values.max()) if values.notna().any() else time.time()
            decay = 0.5 ** (((now - values).clip(lower=0)) / (14 * 86400))
            rows["score"] = rows.get("weight", 1.0).astype(float) * decay
        scores = rows.assign(product_id=rows["product_id"].astype(str)).groupby("product_id")["score"].sum()
        return [(item, float(score)) for item, score in scores.sort_values(ascending=False).head(limit).items()]

    def _recent_items(self, user_id: str | None, session_id: str | None) -> list[str]:
        owner = user_id or f"session:{session_id}"
        if self.history and owner != "session:None":
            try:
                values = self.history.lrange(f"recommendation:history:{owner}", 0, 19)
                if values:
                    return list(dict.fromkeys(json.loads(value)["product_id"] for value in values))
            except Exception:
                pass
        rows = self._interactions()
        if rows is None or rows.empty:
            return []
        key = "user_id" if user_id else "session_id"
        value = user_id or session_id
        if key not in rows or not value:
            return []
        selected = rows[rows[key].astype(str) == str(value)].sort_values("ts" if "ts" in rows else "product_id", ascending=False)
        return selected["product_id"].astype(str).drop_duplicates().head(10).tolist()

    def _content_candidates(self, recent: list[str], limit: int) -> list[tuple[str, float]]:
        values: dict[str, float] = {}
        for product_id in recent:
            for candidate, score in self.bundle.content.similar(product_id, limit):
                values[candidate] = max(values.get(candidate, 0.0), score)
        return sorted(values.items(), key=lambda item: item[1], reverse=True)[:limit]

    def _item_item_candidates(self, user_id: str | None, limit: int) -> list[tuple[str, float]]:
        if not user_id or not hasattr(self.bundle.collaborative, "item_item_for_user"):
            return []
        return self.bundle.collaborative.item_item_for_user(user_id, limit)

    @staticmethod
    def _rank(values: list[tuple[str, float]], reason: str) -> list[dict[str, Any]]:
        return [{"productId": str(product_id), "score": float(score), "reason": reason} for product_id, score in values]


class RecommendationCache:
    def __init__(self, redis_url: str, ttl_seconds: int = 60):
        from redis.asyncio import Redis

        self.client = Redis.from_url(redis_url, decode_responses=True)
        self.ttl_seconds = ttl_seconds

    async def get(self, key: str):
        try:
            value = await self.client.get(key)
            return json.loads(value) if value else None
        except Exception:
            return None

    async def set(self, key: str, value: list[dict[str, Any]]) -> None:
        try:
            await self.client.set(key, json.dumps(value), ex=self.ttl_seconds)
        except Exception:
            return

    async def close(self) -> None:
        await self.client.aclose()