"""Load Retailrocket items with deterministic placeholder catalog fields."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
from pathlib import Path

import pandas as pd
import requests


def request_json(method: str, url: str, key: str, admin_user_id: str, **kwargs):
    headers = {"x-internal-service-key": key, "x-user-id": admin_user_id, "x-user-role": "ADMIN"}
    response = requests.request(method, url, headers=headers, timeout=20, **kwargs)
    response.raise_for_status()
    return response.json()


def deterministic_fields(item_id: str, category_label: str, min_price_paise: int, max_price_paise: int) -> dict:
    seed = int(hashlib.sha256(str(item_id).encode()).hexdigest()[:16], 16)
    rng = random.Random(seed)
    short_id = str(item_id)[-8:]
    return {
        "name": f"{category_label} Item {short_id}",
        "description": f"Retailrocket placeholder product {short_id}.",
        "brand": "Retailrocket Dataset",
        "price_paise": rng.randint(min_price_paise, max_price_paise),
        "image_url": f"https://placehold.co/600x600/png?text={short_id}",
    }


UNCATEGORIZED_ID = "uncategorized"


def category_labels(items: pd.DataFrame, mapping_path: Path | None, limit: int = 20) -> dict[str, str]:
    mapping = json.loads(mapping_path.read_text()) if mapping_path and mapping_path.exists() else {}
    counts = items["category_id"].astype(str).value_counts().head(limit)
    labels = {category_id: str(mapping.get(category_id, f"Category {category_id}")) for category_id in counts.index}
    labels[UNCATEGORIZED_ID] = "Uncategorized"
    return labels


def load_catalog(data_dir: Path, catalog_url: str, inventory_url: str, key: str, admin_user_id: str, seed: int = 42, min_price_paise: int = 9999, max_price_paise: int = 1999999, category_names: Path | None = None) -> int:
    items = pd.read_parquet(data_dir / "items.parquet").fillna("")
    labels = category_labels(items, category_names)
    categories = request_json("GET", f"{catalog_url}/categories", key, admin_user_id).get("data", [])
    category_ids = {str(item.get("name", "")).lower(): item["id"] for item in categories}
    existing_skus: set[str] = set()
    page = 1
    while True:
        result = request_json("GET", f"{catalog_url}/products", key, admin_user_id, params={"page": page, "limit": 100}).get("data", {})
        page_products = result.get("products", [])
        existing_skus.update(str(item.get("sku")) for item in page_products if item.get("sku"))
        if page >= int(result.get("pagination", {}).get("totalPages", page)) or not page_products:
            break
        page += 1
    created = 0
    for row in items.to_dict("records"):
        item_id = str(row["item_id"])
        sku = f"rr-{item_id}"
        if sku in existing_skus:
            continue
        category_id_value = str(row.get("category_id") or UNCATEGORIZED_ID)
        category_name = labels.get(category_id_value, labels[UNCATEGORIZED_ID])
        category_id = category_ids.get(category_name.lower())
        if not category_id:
            category = request_json("POST", f"{catalog_url}/categories", key, admin_user_id, json={"name": category_name})
            category_id = category.get("data", category).get("id")
            category_ids[category_name.lower()] = category_id
        fields = deterministic_fields(item_id, category_name, min_price_paise, max_price_paise)
        product = request_json("POST", f"{catalog_url}/products", key, admin_user_id, json={
            "id": item_id, "sku": sku, "name": fields["name"], "description": fields["description"], "brand": fields["brand"],
            "categoryId": category_id, "price": fields["price_paise"] / 100, "images": [fields["image_url"]],
            "attributes": row.get("properties", {}) if isinstance(row.get("properties"), dict) else {}, "initialStock": 0,
        })
        product_id = product.get("data", product).get("id")
        if product_id:
            stock = random.Random(int(hashlib.sha256(item_id.encode()).hexdigest()[:16], 16) + seed).randint(10, 200)
            request_json("POST", f"{inventory_url}/adjust", key, admin_user_id, json={"productId": product_id, "delta": stock})
            existing_skus.add(sku)
            created += 1
    return created


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=Path(os.getenv("PROCESSED_DATA_DIR", "data/processed")))
    parser.add_argument("--category-names", type=Path, default=Path(os.getenv("CATEGORY_NAMES", "data/category_names.json")))
    parser.add_argument("--catalog-url", default=os.getenv("CATALOG_SERVICE_URL", "http://localhost:4003"))
    parser.add_argument("--inventory-url", default=os.getenv("INVENTORY_SERVICE_URL", "http://localhost:4007"))
    parser.add_argument("--internal-service-key", default=os.getenv("INTERNAL_SERVICE_KEY"), required=not os.getenv("INTERNAL_SERVICE_KEY"))
    parser.add_argument("--admin-user-id", default=os.getenv("ADMIN_USER_ID"), required=not os.getenv("ADMIN_USER_ID"))
    parser.add_argument("--min-price-paise", type=int, default=int(os.getenv("MIN_PRICE_PAISE", "9999")))
    parser.add_argument("--max-price-paise", type=int, default=int(os.getenv("MAX_PRICE_PAISE", "1999999")))
    args = parser.parse_args()
    print("NOTE: Retailrocket has no names, prices, or images; generated catalog fields are deterministic synthetic placeholders.")
    print(f"created {load_catalog(**vars(args))} products")


if __name__ == "__main__":
    main()
