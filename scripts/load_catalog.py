"""Load real H&M article metadata into the ShopEase catalog and inventory."""

from __future__ import annotations

import hashlib
import argparse
import json
import os
import random
import time
from pathlib import Path

import pandas as pd
import requests


def request_json(method: str, url: str, key: str, admin_user_id: str, **kwargs):
    headers = {"x-internal-service-key": key, "x-user-id": admin_user_id, "x-user-role": "ADMIN"}
    response = requests.request(method, url, headers=headers, timeout=60, **kwargs)
    if not response.ok:
        raise requests.HTTPError(f"{response.status_code} {response.reason}: {response.text}", response=response)
    return response.json()


def adjust_stock(inventory_url: str, key: str, admin_user_id: str, product_id: str, sku: str, delta: int) -> None:
    for attempt in range(10):
        try:
            request_json("POST", f"{inventory_url}/adjust", key, admin_user_id, json={"productId": product_id, "sku": sku, "delta": delta})
            return
        except requests.HTTPError as error:
            try:
                code = error.response.json().get("code")
            except (AttributeError, ValueError):
                code = None
            if code not in {"P2002", "P2028"} or attempt == 9:
                raise
            # The Kafka PRODUCT_CREATED consumer may create the stock row at the same time.
            time.sleep(0.25 * (attempt + 1))


def load_catalog(data_dir: Path, catalog_url: str, inventory_url: str, key: str, admin_user_id: str, seed: int = 42) -> int:
    items = pd.read_parquet(data_dir / "items.parquet").fillna("")
    categories = request_json("GET", f"{catalog_url}/categories", key, admin_user_id).get("data", [])
    category_ids = {str(item.get("name", "")).lower(): item["id"] for item in categories}
    existing_products: dict[str, dict] = {}
    page = 1
    while True:
        result = request_json("GET", f"{catalog_url}/products", key, admin_user_id, params={"page": page, "limit": 100}).get("data", {})
        page_products = result.get("products", [])
        existing_products.update({str(item["sku"]): item for item in page_products if item.get("sku")})
        if page >= int(result.get("pagination", {}).get("totalPages", page)) or not page_products:
            break
        page += 1

    # The prior importer used this prefix for its placeholder catalog entries.
    # Soft-delete them so the storefront no longer mixes fake products with H&M.
    retired = 0
    for sku, product in list(existing_products.items()):
        if not sku.startswith("rr-"):
            continue
        product_id = product.get("id")
        if product_id:
            request_json("DELETE", f"{catalog_url}/products/{product_id}", key, admin_user_id)
            retired += 1
        existing_products.pop(sku, None)

    stock_by_product_id: dict[str, int] = {}
    product_rows = list(existing_products.values())
    for offset in range(0, len(product_rows), 200):
        product_ids = [str(item["id"]) for item in product_rows[offset:offset + 200] if item.get("id")]
        result = request_json("POST", f"{inventory_url}/products/bulk", key, admin_user_id, json={"productIds": product_ids})
        stock_by_product_id.update({str(stock["productId"]): int(stock.get("available", 0)) for stock in result.get("data", [])})

    created = 0
    for row in items.to_dict("records"):
        product_id = str(row["item_id"])
        article_id = str(row.get("article_id") or product_id.removeprefix("hm_"))
        sku = f"hm-{article_id}"
        if sku in existing_products:
            existing_id = str(existing_products[sku].get("id", ""))
            if stock_by_product_id.get(existing_id, 0) <= 0:
                stock = random.Random(int(hashlib.sha256(article_id.encode()).hexdigest()[:16], 16) + seed).randint(10, 200)
                adjust_stock(inventory_url, key, admin_user_id, existing_id, sku, stock)
                stock_by_product_id[existing_id] = stock
            continue

        category_name = str(row.get("category") or row.get("category_id") or "Fashion").strip()
        category_id = category_ids.get(category_name.lower())
        if not category_id:
            category = request_json("POST", f"{catalog_url}/categories", key, admin_user_id, json={"name": category_name})
            category_id = category.get("data", category).get("id")
            category_ids[category_name.lower()] = category_id

        attributes = row.get("attributes", {})
        if isinstance(attributes, str):
            try:
                attributes = json.loads(attributes)
            except json.JSONDecodeError:
                attributes = {}
        # No image files are required. The storefront already uses its no-image fallback.
        images = [str(row["image_url"])] if row.get("image_url") else []
        product = request_json("POST", f"{catalog_url}/products", key, admin_user_id, json={
            "id": product_id,
            "sku": sku,
            "name": str(row.get("name") or f"H&M fashion item {article_id}"),
            "description": str(row.get("description") or row.get("name") or "H&M fashion item"),
            "brand": str(row.get("brand") or "H&M"),
            "categoryId": category_id,
            "price": float(row.get("price") or 0),
            "images": images,
            "attributes": attributes,
            "initialStock": 0,
        })
        saved_id = product.get("data", product).get("id")
        if saved_id:
            stock = random.Random(int(hashlib.sha256(article_id.encode()).hexdigest()[:16], 16) + seed).randint(10, 200)
            adjust_stock(inventory_url, key, admin_user_id, saved_id, sku, stock)
            existing_products[sku] = {"id": saved_id, "sku": sku}
            created += 1
    print(f"deactivated {retired} legacy placeholder products")
    return created


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=Path(os.getenv("PROCESSED_DATA_DIR", "data/processed")))
    parser.add_argument("--catalog-url", default=os.getenv("CATALOG_SERVICE_URL", "http://localhost:4003"))
    parser.add_argument("--inventory-url", default=os.getenv("INVENTORY_SERVICE_URL", "http://localhost:4007"))
    parser.add_argument("--internal-service-key", default=os.getenv("INTERNAL_SERVICE_KEY"), required=not os.getenv("INTERNAL_SERVICE_KEY"))
    parser.add_argument("--admin-user-id", default=os.getenv("ADMIN_USER_ID"), required=not os.getenv("ADMIN_USER_ID"))
    args = parser.parse_args()
    created = load_catalog(args.data_dir, args.catalog_url, args.inventory_url, args.internal_service_key, args.admin_user_id)
    print(f"created {created} H&M products from real article metadata")


if __name__ == "__main__":
    main()
