"""Map a ShopEase account to a customer in the H&M training interactions."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd


def choose_dataset_user(events_path: Path, customer_id: str | None = None) -> str:
    events = pd.read_parquet(events_path)
    if customer_id:
        if customer_id not in set(events["user_id"].astype(str)):
            raise ValueError("customer is not present in events.parquet")
        return customer_id
    grouped = events.groupby("user_id").agg(
        interactions=("product_id", "size"), categories=("category_id", "nunique")
    )
    eligible = grouped[(grouped["interactions"].between(20, 100)) & (grouped["categories"] >= 2)]
    if eligible.empty:
        raise ValueError("no customer has 20-100 purchases across at least two categories")
    return str(eligible.sort_values(["categories", "interactions"], ascending=False).index[0])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--shop-user-id", required=True)
    parser.add_argument("--dataset-customer-id")
    parser.add_argument("--data-dir", type=Path, default=Path("data/processed"))
    parser.add_argument("--output", type=Path, default=Path("data/demo-user.json"))
    args = parser.parse_args()
    customer_id = choose_dataset_user(args.data_dir / "events.parquet", args.dataset_customer_id)
    mapping = {"shop_user_id": args.shop_user_id, "dataset_user_id": customer_id}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(mapping, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(mapping))


if __name__ == "__main__":
    main()
