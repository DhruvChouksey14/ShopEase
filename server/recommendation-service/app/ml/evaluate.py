from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics.pairwise import cosine_similarity

from .collaborative import CollaborativeModel
from .content import ContentModel
from .hybrid import hybrid_rank, weight_grid
from .matrix import build_interaction_matrix

MODEL_NAMES = ("popularity", "popularity_plain", "item_item", "als", "content", "hybrid")


def _timestamp_column(rows: pd.DataFrame) -> pd.Series:
    if "ts" not in rows:
        return pd.Series(np.arange(len(rows), dtype=float), index=rows.index)
    values = pd.to_numeric(rows["ts"], errors="coerce")
    if values.isna().all():
        values = pd.to_datetime(rows["ts"], errors="coerce").astype("int64") / 1e9
    return values.ffill().fillna(0.0).astype(float)


def _metrics(actual: set[str], predicted: list[str], k: int) -> dict[str, float]:
    ranked = predicted[:k]
    hits = [index for index, item in enumerate(ranked) if item in actual]
    precision = len(hits) / k if k else 0.0
    recall = len(hits) / len(actual) if actual else 0.0
    dcg = sum(1.0 / math.log2(index + 2) for index in hits)
    ideal = sum(1.0 / math.log2(index + 2) for index in range(min(len(actual), k)))
    average_precision = sum(sum(1.0 for hit in hits if hit <= index) / (index + 1) for index in hits) / len(actual) if actual else 0.0
    return {"precision_at_k": precision, "recall_at_k": recall, "ndcg_at_k": dcg / ideal if ideal else 0.0, "map_at_k": average_precision}


def _products_from_items(items: pd.DataFrame | None, item_ids: list[str]) -> pd.DataFrame:
    if items is None:
        names = [f"product_{item_id}" for item_id in item_ids]
        return pd.DataFrame({"product_id": item_ids, "name": names, "description": names, "brand": "", "category": "", "attributes": ""})
    products = items.copy().rename(columns={"item_id": "product_id"})
    products["product_id"] = products["product_id"].astype(str)
    products["name"] = "Retailrocket product " + products["product_id"]
    products["description"] = products.get("tokens", "")
    products["brand"] = "Retailrocket Dataset"
    products["category"] = products.get("category_path", "uncategorized")
    return products[products["product_id"].isin(item_ids)].copy()


def _popular(train: pd.DataFrame, item_ids: list[str], now: float, half_life_days: float = 14.0) -> list[tuple[str, float]]:
    timestamps = pd.to_numeric(train["ts"], errors="coerce")
    unit = 1000.0 if timestamps.max() > 10_000_000_000 else 1.0
    age = ((now - timestamps / unit).clip(lower=0) / (half_life_days * 86400)).fillna(0)
    scores = train.assign(score=train["weight"].astype(float) * np.power(0.5, age)).groupby("product_id")["score"].sum()
    return [(str(item), float(scores[item])) for item in scores.sort_values(ascending=False).index if item in item_ids]


def _popular_plain(train: pd.DataFrame, item_ids: list[str]) -> list[tuple[str, float]]:
    scores = train.assign(score=train["weight"].astype(float)).groupby("product_id")["score"].sum()
    return [(str(item), float(scores[item])) for item in scores.sort_values(ascending=False).index if item in item_ids]


def _item_item(matrix, user_id: str, limit: int, seen: set[str]) -> list[tuple[str, float]]:
    return matrix.item_item_for_user(user_id, limit)


def _content(model: ContentModel, seen: set[str], limit: int) -> list[tuple[str, float]]:
    scores: dict[str, float] = {}
    for product_id in seen:
        for item, score in model.similar(product_id, limit=limit * 2):
            scores[item] = max(scores.get(item, 0.0), score)
    return sorted(scores.items(), key=lambda pair: pair[1], reverse=True)[:limit]


def _window_predictions(train: pd.DataFrame, window: pd.DataFrame, catalog: list[str], content: ContentModel, als: CollaborativeModel, k: int) -> tuple[dict[str, dict[str, list[str]]], dict[str, dict[str, list[tuple[str, float]]]], dict[str, set[str]]]:
    train_users = set(train["user_id"])
    window = window[window["user_id"].isin(train_users)]
    relevant = {user: set(group["product_id"]) for user, group in window.groupby("user_id")}
    matrix = als
    popularity = _popular(train, catalog, float(train["ts"].max()))
    popularity_plain = _popular_plain(train, catalog)
    predictions = {name: {} for name in MODEL_NAMES}
    candidates: dict[str, dict[str, list[tuple[str, float]]]] = {}
    for user_id, actual in relevant.items():
        seen = set(train.loc[train["user_id"] == user_id, "product_id"])
        popularity_rows = [(item, score) for item, score in popularity if item not in seen][:k]
        popularity_plain_rows = [(item, score) for item, score in popularity_plain if item not in seen][:k]
        item_rows = _item_item(matrix, user_id, k, seen)
        als_rows = matrix.recommend(user_id, k)
        content_rows = _content(content, seen, k)
        predictions["popularity"][user_id] = [item for item, _ in popularity_rows]
        predictions["popularity_plain"][user_id] = [item for item, _ in popularity_plain_rows]
        predictions["item_item"][user_id] = [item for item, _ in item_rows]
        predictions["als"][user_id] = [item for item, _ in als_rows]
        predictions["content"][user_id] = [item for item, _ in content_rows]
        candidates[user_id] = {"item_item": item_rows, "als": als_rows, "content": content_rows, "popularity": popularity_rows}
    return predictions, candidates, relevant


def _score_predictions(predictions: dict[str, dict[str, list[str]]], relevant: dict[str, set[str]], k: int, catalog_size: int) -> dict[str, dict[str, float]]:
    metrics = {}
    for name in MODEL_NAMES:
        per_user = [_metrics(actual, predictions[name].get(user, []), k) for user, actual in relevant.items()]
        metrics[name] = {key: sum(row[key] for row in per_user) / len(per_user) if per_user else 0.0 for key in ("precision_at_k", "recall_at_k", "ndcg_at_k", "map_at_k")}
        metrics[name]["catalog_coverage"] = len({item for rows_for_user in predictions[name].values() for item in rows_for_user}) / max(1, catalog_size)
    return metrics


def evaluate_dataset(interactions: pd.DataFrame, items: pd.DataFrame | None = None, k: int = 10, test_fraction: float = 0.2, dataset_name: str = "Retailrocket") -> dict:
    rows = interactions.copy()
    rows["user_id"] = rows["user_id"].astype(str)
    rows["product_id"] = rows["product_id"].astype(str)
    if "weight" not in rows:
        rows["weight"] = 1.0
    if "ts" not in rows:
        rows["ts"] = np.arange(len(rows), dtype=float)
    rows["ts"] = pd.to_numeric(rows["ts"], errors="coerce").ffill().fillna(0.0)
    rows = rows.sort_values("ts").reset_index(drop=True)
    split_date = rows["ts"].quantile(1 - test_fraction) if len(rows) > 1 else None
    train = rows[rows["ts"] < split_date].copy() if split_date is not None else rows.copy()
    test_period = rows[rows["ts"] >= split_date].copy() if split_date is not None else rows.iloc[0:0].copy()
    validation_date = test_period["ts"].quantile(0.5) if len(test_period) > 1 else None
    validation = test_period[test_period["ts"] < validation_date].copy() if validation_date is not None else test_period.copy()
    heldout = test_period[test_period["ts"] >= validation_date].copy() if validation_date is not None else test_period.iloc[0:0].copy()
    matrix = build_interaction_matrix(train)
    catalog = sorted(set(train["product_id"]) | set(test_period["product_id"]))
    content = ContentModel(_products_from_items(items, catalog))
    als = CollaborativeModel(matrix)
    validation_predictions, validation_candidates, validation_relevant = _window_predictions(train, validation, catalog, content, als, k)
    heldout_predictions, heldout_candidates, heldout_relevant = _window_predictions(train, heldout, catalog, content, als, k)
    best_weights = None
    best_score = float("-inf")
    for weights in weight_grid():
        score_rows = []
        for user_id, actual in validation_relevant.items():
            ranked = hybrid_rank(weights=weights, limit=k, excluded=set(train.loc[train["user_id"] == user_id, "product_id"]), **validation_candidates.get(user_id, {}))
            score_rows.append(_metrics(actual, [item for item, _ in ranked], k)["ndcg_at_k"])
        score = sum(score_rows) / len(score_rows) if score_rows else 0.0
        if score > best_score:
            best_score, best_weights = score, weights
    for user_id in validation_relevant:
        ranked = hybrid_rank(weights=best_weights, limit=k, excluded=set(train.loc[train["user_id"] == user_id, "product_id"]), **validation_candidates.get(user_id, {}))
        validation_predictions["hybrid"][user_id] = [item for item, _ in ranked]
    for user_id in heldout_relevant:
        ranked = hybrid_rank(weights=best_weights, limit=k, excluded=set(train.loc[train["user_id"] == user_id, "product_id"]), **heldout_candidates.get(user_id, {}))
        heldout_predictions["hybrid"][user_id] = [item for item, _ in ranked]
    validation_metrics = _score_predictions(validation_predictions, validation_relevant, k, len(catalog))
    heldout_metrics = _score_predictions(heldout_predictions, heldout_relevant, k, len(catalog))
    return {"dataset": dataset_name, "k": k, "sizes": {"rows": len(rows), "train_rows": len(train), "test_rows": len(test_period), "validation_rows": len(validation), "heldout_rows": len(heldout), "validation_users": len(validation_relevant), "users_evaluated": len(heldout_relevant), "catalog": len(catalog)}, "split_date": float(split_date) if split_date is not None else None, "validation_split_date": float(validation_date) if validation_date is not None else None, "hybrid_weights": best_weights, "validation": validation_metrics, "heldout": heldout_metrics, "models": heldout_metrics}


def evaluate(interactions: pd.DataFrame, k: int = 10) -> dict[str, float]:
    return evaluate_dataset(interactions, k=k)["models"]["popularity"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--interactions", type=Path, default=Path("data/processed/interactions.parquet"))
    parser.add_argument("--items", type=Path, default=Path("data/processed/items.parquet"))
    parser.add_argument("--report", type=Path, default=Path("reports/eval.json"))
    args = parser.parse_args()
    interactions = pd.read_parquet(args.interactions)
    items = pd.read_parquet(args.items) if args.items.exists() else None
    result = evaluate_dataset(interactions, items=items)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
