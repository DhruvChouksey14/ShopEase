"""Map a ShopEase account to an active Retailrocket visitor."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd


def choose_dataset_user(events_path: Path, visitor_id: str | None = None) -> str:
    events = pd.read_parquet(events_path)
    if visitor_id:
        if visitor_id not in set(events["visitorid"].astype(str)):
            raise ValueError("visitor is not present in events.parquet")
        return visitor_id
    grouped = events.groupby("visitorid").agg(
        interactions=("itemid", "size"), categories=("category_id", "nunique")
    )
    eligible = grouped[(grouped["interactions"].between(20, 100)) & (grouped["categories"] >= 2)]
    if eligible.empty:
        raise ValueError("no active visitor has 20-100 interactions across at least two categories")
    return str(eligible.sort_values(["categories", "interactions"], ascending=False).index[0])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--shop-user-id", required=True)
    parser.add_argument("--dataset-visitor-id")
    parser.add_argument("--data-dir", type=Path, default=Path("data/processed"))
    parser.add_argument("--output", type=Path, default=Path("data/demo-user.json"))
    args = parser.parse_args()
    visitor_id = choose_dataset_user(args.data_dir / "events.parquet", args.dataset_visitor_id)
    mapping = {"shop_user_id": args.shop_user_id, "dataset_user_id": visitor_id}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(mapping, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(mapping))


if __name__ == "__main__":
    main()
