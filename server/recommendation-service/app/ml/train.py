from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import psycopg

from .artifacts import save_versioned_artifact
from .bundle import Bundle
from .collaborative import CollaborativeModel
from .content import ContentModel
from .evaluate import evaluate_dataset
from .matrix import build_interaction_matrix
from .timeutil import to_seconds


def promotion_allowed(report: dict, margin: float | None = None) -> bool:
    models = report.get("models", {})
    margin = float(os.getenv("PROMOTION_MARGIN", "0.20")) if margin is None else margin
    hybrid = models.get("hybrid", {}).get("ndcg_at_k", 0.0)
    time_popularity = models.get("popularity", {}).get("ndcg_at_k", 0.0)
    plain_popularity = models.get("popularity_plain", {}).get("ndcg_at_k", 0.0)
    return hybrid >= time_popularity * (1 + margin) and hybrid >= plain_popularity * (1 + margin)


def load_live_interactions(database_url: str) -> pd.DataFrame:
    query = "SELECT user_id, session_id, product_id, weight, ts FROM recommendation_interactions WHERE product_id IS NOT NULL"
    with psycopg.connect(database_url) as connection:
        return pd.read_sql_query(query, connection)


def merge_interactions(dataset: pd.DataFrame, live: pd.DataFrame, source: str, half_life_days: float = 14.0) -> pd.DataFrame:
    if source == "dataset":
        dataset = dataset.copy()
        dataset["ts"] = to_seconds(dataset["ts"])
        return dataset
    live = live.copy()
    live["user_id"] = live["user_id"].fillna("session:" + live["session_id"].fillna("unknown")).astype(str)
    live["product_id"] = live["product_id"].astype(str)
    live["ts"] = to_seconds(live["ts"])
    now = float(live["ts"].max()) if not live.empty else 0.0
    if now and half_life_days > 0:
        live["weight"] = live["weight"].astype(float) * (0.5 ** ((now - live["ts"]).clip(lower=0) / (half_life_days * 86400)))
    if source == "live":
        return live[["user_id", "product_id", "weight", "ts"]]
    dataset = dataset.copy()
    dataset["ts"] = to_seconds(dataset["ts"])
    return pd.concat([dataset[["user_id", "product_id", "weight", "ts"]], live[["user_id", "product_id", "weight", "ts"]]], ignore_index=True)


def train(data_dir: Path, model_dir: Path, category: str = "H&M", dataset_name: str = "H&M", data_source: str = "dataset", database_url: str | None = None) -> Path:
    required = [data_dir / "interactions.parquet", data_dir / "items.parquet"]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise FileNotFoundError(f"Recommendation training data is missing: {', '.join(missing)}")
    products_path = data_dir / "products.parquet"
    if products_path.exists():
        products = pd.read_parquet(products_path)
    else:
        products = pd.read_parquet(data_dir / "items.parquet").rename(columns={"item_id": "product_id"})
        products["name"] = "H&M fashion item " + products["product_id"].astype(str)
        products["description"] = products["tokens"].fillna("")
        products["brand"] = "H&M"
        products["category"] = products["category_path"].fillna("uncategorized")
    dataset_interactions = pd.read_parquet(data_dir / "interactions.parquet")
    live = load_live_interactions(database_url) if data_source in {"live", "hybrid"} and database_url else pd.DataFrame()
    interactions = merge_interactions(dataset_interactions, live, data_source)
    matrix = build_interaction_matrix(interactions)
    report = evaluate_dataset(interactions, items=pd.read_parquet(data_dir / "items.parquet"), dataset_name=dataset_name)
    bundle = Bundle(CollaborativeModel(matrix), ContentModel(products), interactions=interactions, products=products, hybrid_weights=report.get("hybrid_weights"))
    report_path = Path(os.getenv("EVAL_REPORT", "reports/eval.json"))
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if not promotion_allowed(report):
        raise RuntimeError("Refusing to promote recommendation model: hybrid NDCG@10 does not beat both popularity baselines by the configured margin")
    metadata = {"dataset": dataset_name, "category": category, "products": len(products), "interactions": len(interactions), "version": datetime.now(timezone.utc).strftime("model-%Y%m%dT%H%M%SZ"), "metrics": report["models"]}
    return save_versioned_artifact(bundle, model_dir, metadata)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=Path(os.getenv("DATA_DIR", "data/processed")))
    parser.add_argument("--model-dir", type=Path, default=Path("/models"))
    parser.add_argument("--category", default="H&M")
    parser.add_argument("--dataset-name", default=os.getenv("DATASET_NAME", "H&M"))
    parser.add_argument("--data-source", default=os.getenv("DATA_SOURCE", "dataset"), choices=("dataset", "live", "hybrid"))
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    args = parser.parse_args()
    print(json.dumps({"artifact": str(train(
        args.data_dir,
        args.model_dir,
        args.category,
        args.dataset_name,
        args.data_source,
        args.database_url,
    ))}))


if __name__ == "__main__":
    main()
