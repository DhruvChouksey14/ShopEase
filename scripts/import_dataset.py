"""Prepare manually downloaded Retailrocket files for ShopEase ML training."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from collections import defaultdict
from pathlib import Path
from typing import Any

import pandas as pd

EVENT_WEIGHTS = {"view": 1, "addtocart": 3, "transaction": 5}
REQUIRED_FILES = (
    "events.csv",
    "item_properties_part1.csv",
    "item_properties_part2.csv",
    "category_tree.csv",
)


def required_files(input_dir: Path) -> list[Path]:
    return [input_dir / filename for filename in REQUIRED_FILES]


def validate_input_files(input_dir: Path) -> None:
    missing = [str(path) for path in required_files(input_dir) if not path.exists()]
    if missing:
        raise FileNotFoundError(
            "Missing Retailrocket files. Download these files and place them in "
            f"{input_dir}:\n" + "\n".join(missing)
        )


def load_category_tree(path: Path) -> dict[str, list[str]]:
    tree = pd.read_csv(path).fillna("")
    parents = {str(row.categoryid): str(row.parentid) for row in tree.itertuples()}
    paths: dict[str, list[str]] = {}
    for category_id in parents:
        path_ids: list[str] = []
        current = category_id
        seen: set[str] = set()
        while current and current not in seen:
            seen.add(current)
            path_ids.append(current)
            current = parents.get(current, "")
        paths[category_id] = list(reversed(path_ids))
    return paths


def _latest_properties(input_dir: Path) -> dict[str, dict[str, str]]:
    latest: dict[tuple[str, str], tuple[int, str]] = {}
    for path in sorted(input_dir.glob("item_properties_part*.csv")):
        for chunk in pd.read_csv(path, chunksize=100_000):
            chunk = chunk.dropna(subset=["itemid", "property", "value"])
            for row in chunk.itertuples(index=False):
                key = (str(row.itemid), str(row.property))
                candidate = (int(row.timestamp), str(row.value))
                if key not in latest or candidate[0] >= latest[key][0]:
                    latest[key] = candidate
    properties: dict[str, dict[str, str]] = defaultdict(dict)
    for (item_id, name), (_, value) in latest.items():
        properties[item_id][name] = value
    return dict(properties)


def _hash_token(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]


def build_items(properties: dict[str, dict[str, str]], category_paths: dict[str, list[str]]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for item_id, values in properties.items():
        if str(values.get("available", "0")).lower() not in {"1", "true", "yes"}:
            continue
        category_id = str(values.get("categoryid", "uncategorized"))
        path = category_paths.get(category_id, [category_id])
        hashed_values = [_hash_token(f"{name}={value}") for name, value in sorted(values.items()) if name not in {"available", "categoryid"}]
        rows.append({
            "item_id": item_id,
            "category_id": category_id,
            "category_path": "/".join(path),
            "tokens": " ".join([f"category_{part}" for part in path] + [f"property_{token}" for token in hashed_values]),
            "properties": values,
        })
    return pd.DataFrame(rows, columns=["item_id", "category_id", "category_path", "tokens", "properties"])


def load_events(path: Path) -> pd.DataFrame:
    events = pd.read_csv(path)
    required = {"timestamp", "visitorid", "event", "itemid"}
    missing = required - set(events.columns)
    if missing:
        raise ValueError(f"events.csv missing columns: {sorted(missing)}")
    events = events[events["event"].isin(EVENT_WEIGHTS)].copy()
    events["visitorid"] = events["visitorid"].astype(str)
    events["itemid"] = events["itemid"].astype(str)
    events["weight"] = events["event"].map(EVENT_WEIGHTS).astype(int)
    return events.sort_values("timestamp").reset_index(drop=True)


def prepare_dataset(input_dir: Path, output_dir: Path, min_interactions: int = 3, max_events_per_visitor: int = 1000, max_items: int = 5000, max_events: int = 500_000, test_fraction: float = 0.2) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    validate_input_files(input_dir)
    events = load_events(input_dir / "events.csv")
    event_counts = events.groupby("visitorid").size()
    allowed_visitors = set(event_counts[event_counts <= max_events_per_visitor].index)
    events = events[events["visitorid"].isin(allowed_visitors)]
    item_counts = events.groupby("itemid").size()
    visitor_interaction_counts = events.groupby("visitorid").size()
    events = events[events["itemid"].isin(set(item_counts[item_counts >= min_interactions].index))]
    events = events[events["visitorid"].isin(set(visitor_interaction_counts[visitor_interaction_counts >= min_interactions].index))]
    events = events.head(max_events).copy()
    properties = _latest_properties(input_dir)
    items = build_items(properties, load_category_tree(input_dir / "category_tree.csv"))
    items = items[items["item_id"].isin(set(events["itemid"]))].head(max_items).copy()
    events = events[events["itemid"].isin(set(items["item_id"]))].copy()
    if events.empty or items.empty:
        raise ValueError("no usable events and available items remain after filtering")
    category_by_item = items.set_index("item_id")["category_id"]
    events["category_id"] = events["itemid"].map(category_by_item).fillna("uncategorized")
    cutoff = events["timestamp"].quantile(1 - test_fraction)
    events["split"] = events["timestamp"].ge(cutoff).map({True: "test", False: "train"})
    interactions = events.groupby(["visitorid", "itemid"], as_index=False).agg(weight=("weight", "sum"), timestamp=("timestamp", "max"))
    interactions = interactions.rename(columns={"visitorid": "user_id", "itemid": "product_id", "timestamp": "ts"})
    output_dir.mkdir(parents=True, exist_ok=True)
    events.to_parquet(output_dir / "events.parquet", index=False)
    interactions.to_parquet(output_dir / "interactions.parquet", index=False)
    items.to_parquet(output_dir / "items.parquet", index=False)
    return events, interactions, items


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", type=Path, default=Path(os.getenv("RETAILROCKET_DIR", "data/raw/retailrocket")))
    parser.add_argument("--output-dir", type=Path, default=Path(os.getenv("PROCESSED_DATA_DIR", "data/processed")))
    parser.add_argument("--min-interactions", type=int, default=int(os.getenv("MIN_INTERACTIONS", "3")))
    parser.add_argument("--max-events-per-visitor", type=int, default=int(os.getenv("MAX_EVENTS_PER_VISITOR", "1000")))
    parser.add_argument("--max-items", type=int, default=int(os.getenv("MAX_ITEMS", "5000")))
    parser.add_argument("--max-events", type=int, default=int(os.getenv("MAX_EVENTS", "500000")))
    parser.add_argument("--test-fraction", type=float, default=float(os.getenv("TEST_FRACTION", "0.2")))
    args = parser.parse_args()
    try:
        events, interactions, items = prepare_dataset(**vars(args))
    except FileNotFoundError as error:
        print(error)
        raise SystemExit(2)
    print(f"wrote {len(events)} raw events, {len(interactions)} interactions, and {len(items)} available items to {args.output_dir}")


if __name__ == "__main__":
    main()
