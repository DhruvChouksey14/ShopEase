from __future__ import annotations

import math
import time
from collections import defaultdict

import pandas as pd

from .timeutil import to_seconds


def rerank(candidates, purchased=None, category_by_id=None, in_stock=None, limit=10, diversity=0.25):
    purchased = {str(value) for value in (purchased or set())}
    category_by_id = category_by_id or {}
    in_stock = in_stock or {}
    remaining = [dict(item) for item in candidates if str(item["product_id"]) not in purchased]
    selected = []
    categories = defaultdict(int)
    while remaining and len(selected) < limit:
        best_index, best_score = 0, float("-inf")
        for index, item in enumerate(remaining):
            product_id = str(item["product_id"])
            category = category_by_id.get(product_id)
            novelty = 1.0 / (1 + categories[category])
            stock_boost = 0.1 if in_stock.get(product_id, True) else -1.0
            score = float(item.get("score", 0)) + diversity * novelty + stock_boost
            if score > best_score:
                best_index, best_score = index, score
        item = remaining.pop(best_index)
        item["score"] = best_score
        selected.append(item)
        categories[category_by_id.get(str(item["product_id"]))] += 1
    return selected


def time_decay(timestamp, now=None, half_life_days=14.0):
    if timestamp is None:
        return 0.0
    timestamp_seconds = float(to_seconds(pd.Series([timestamp])).iloc[0])
    now_seconds = float(to_seconds(pd.Series([now if now is not None else time.time()])).iloc[0])
    age_seconds = max(0.0, now_seconds - timestamp_seconds)
    return math.pow(0.5, age_seconds / (half_life_days * 86400))