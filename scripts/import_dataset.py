"""Prepare the H&M Personalized Fashion Recommendations data for ShopEase."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Any
from urllib.parse import quote, urljoin

import pandas as pd


REQUIRED_FILES = ("articles.csv", "transactions_train.csv")
ARTICLE_TEXT_FIELDS = (
    "product_type_name",
    "product_group_name",
    "graphical_appearance_name",
    "colour_group_name",
    "department_name",
    "index_name",
    "index_group_name",
    "section_name",
    "garment_group_name",
)


def validate_input_files(input_dir: Path) -> None:
    missing = [str(input_dir / filename) for filename in REQUIRED_FILES if not (input_dir / filename).exists()]
    if missing:
        raise FileNotFoundError(
            "Missing H&M dataset files. Place articles.csv and transactions_train.csv in "
            f"{input_dir}:\n" + "\n".join(missing)
        )


def _clean(value: Any) -> str:
    if value is None or pd.isna(value):
        return ""
    return str(value).strip()


def _article_category(row: dict[str, Any]) -> str:
    # index_name is a compact, shopper-facing category (for example Ladieswear).
    # product_group_name gives the catalog useful detail beneath it.
    pieces = [_clean(row.get("index_name")), _clean(row.get("product_group_name"))]
    return " / ".join(dict.fromkeys(piece for piece in pieces if piece)) or "Fashion"


def _article_image_url(article_id: str, image_dir: Path, image_base_url: str) -> str:
    """Return a browser URL only when the matching H&M image is available."""
    relative = Path("images") / article_id[:3] / f"{article_id}.jpg"
    image_path = image_dir / relative.relative_to("images")
    if not image_path.exists() or not image_base_url:
        return ""
    return urljoin(image_base_url.rstrip("/") + "/", quote(relative.as_posix()))


def _load_recent_transactions(
    path: Path,
    available_articles: set[str],
    max_events: int,
    chunksize: int = 250_000,
) -> pd.DataFrame:
    """Read in chunks and retain a recent, bounded purchase sample."""
    keep = max(max_events * 2, 100_000)
    recent = pd.DataFrame(columns=["customer_id", "article_id", "t_dat", "price"])
    for chunk in pd.read_csv(
        path,
        usecols=["t_dat", "customer_id", "article_id", "price"],
        dtype={"customer_id": "string", "article_id": "string"},
        chunksize=chunksize,
    ):
        chunk = chunk[chunk["article_id"].isin(available_articles)].copy()
        if chunk.empty:
            continue
        chunk["ts"] = pd.to_datetime(chunk["t_dat"], errors="coerce", utc=True).astype("int64") // 1_000_000
        chunk = chunk[chunk["ts"] >= 0]
        recent = pd.concat([recent, chunk], ignore_index=True)
        if len(recent) > keep:
            recent = recent.nlargest(keep, "ts")
    if recent.empty:
        return recent.assign(ts=pd.Series(dtype="int64"))
    return recent.nlargest(keep, "ts").sort_values("ts").reset_index(drop=True)


def prepare_dataset(
    input_dir: Path,
    output_dir: Path,
    min_interactions: int = 3,
    max_events_per_customer: int = 1000,
    max_items: int = 5000,
    max_events: int = 500_000,
    test_fraction: float = 0.2,
    image_dir: Path | None = None,
    image_base_url: str = "",
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    validate_input_files(input_dir)
    articles = pd.read_csv(input_dir / "articles.csv", dtype={"article_id": "string"}).fillna("")
    articles["article_id"] = articles["article_id"].astype(str)
    articles_by_id = articles.set_index("article_id", drop=False)
    events = _load_recent_transactions(input_dir / "transactions_train.csv", set(articles_by_id.index), max_events)
    if events.empty:
        raise ValueError("no transactions matched the article catalog")

    customer_counts = events.groupby("customer_id").size()
    allowed_customers = set(customer_counts[customer_counts.between(min_interactions, max_events_per_customer)].index)
    events = events[events["customer_id"].isin(allowed_customers)].copy()
    article_counts = events.groupby("article_id").size()
    eligible_articles = article_counts[article_counts >= min_interactions].sort_values(ascending=False).head(max_items).index
    events = events[events["article_id"].isin(set(eligible_articles))].copy()
    events = events.sort_values("ts").tail(max_events).copy()
    if events.empty:
        raise ValueError("no usable purchases remain after interaction filtering")

    article_counts = events.groupby("article_id").size()
    article_rows: list[dict[str, Any]] = []
    products: list[dict[str, Any]] = []
    article_ids = set(events["article_id"])
    price_by_article = events.groupby("article_id")["price"].median().to_dict()
    image_root = image_dir or input_dir / "images"
    for article_id in sorted(article_ids):
        source = articles_by_id.loc[article_id]
        if isinstance(source, pd.DataFrame):
            source = source.iloc[0]
        values = source.to_dict()
        name = _clean(values.get("prod_name")) or f"H&M fashion item {article_id}"
        description = _clean(values.get("detail_desc")) or name
        category = _article_category(values)
        attributes = {field: _clean(values.get(field)) for field in ARTICLE_TEXT_FIELDS if _clean(values.get(field))}
        # H&M's price values are normalized. Multiplying by 100,000 yields an
        # approximate INR display value; this is a demo conversion, not source currency.
        normalized_price = pd.to_numeric(pd.Series([price_by_article.get(article_id, 0)]), errors="coerce").fillna(0).iloc[0]
        price_rupees = round(float(normalized_price) * 100_000, 2)
        image_url = _article_image_url(article_id, image_root, image_base_url)
        product_id = f"hm_{article_id}"
        tokens = " ".join([category, name, description, *attributes.values()])
        item = {
            "item_id": product_id,
            "category_id": category,
            "category_path": category,
            "tokens": tokens,
            "properties": attributes,
            "name": name,
            "description": description,
            "brand": "H&M",
            "category": category,
            "attributes": attributes,
            "price": price_rupees,
            "image_url": image_url,
            "article_id": article_id,
            "product_count": int(article_counts.get(article_id, 0)),
        }
        article_rows.append(item)
        products.append({key: item[key] for key in (
            "item_id", "name", "description", "brand", "category", "attributes", "price", "image_url"
        )})

    item_frame = pd.DataFrame(article_rows)
    product_frame = pd.DataFrame(products).rename(columns={"item_id": "product_id"})
    category_by_article = item_frame.set_index("article_id")["category_id"]
    events["user_id"] = events["customer_id"].astype(str)
    events["product_id"] = "hm_" + events["article_id"].astype(str)
    events["category_id"] = events["article_id"].map(category_by_article)
    events["event_type"] = "purchase"
    events["weight"] = 5.0
    events = events[["user_id", "product_id", "ts", "event_type", "weight", "category_id"]]
    cutoff = events["ts"].quantile(1 - test_fraction)
    events["split"] = events["ts"].ge(cutoff).map({True: "test", False: "train"})
    interactions = events[["user_id", "product_id", "weight", "ts"]].copy()

    output_dir.mkdir(parents=True, exist_ok=True)
    events.to_parquet(output_dir / "events.parquet", index=False)
    interactions.to_parquet(output_dir / "interactions.parquet", index=False)
    item_frame.to_parquet(output_dir / "items.parquet", index=False)
    product_frame.to_parquet(output_dir / "products.parquet", index=False)
    return events, interactions, item_frame


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", type=Path, default=Path(os.getenv("HM_DATA_DIR", "data/H&M")))
    parser.add_argument("--output-dir", type=Path, default=Path(os.getenv("PROCESSED_DATA_DIR", "data/processed")))
    parser.add_argument("--min-interactions", type=int, default=int(os.getenv("MIN_INTERACTIONS", "3")))
    parser.add_argument("--max-events-per-customer", type=int, default=int(os.getenv("MAX_EVENTS_PER_CUSTOMER", "1000")))
    parser.add_argument("--max-items", type=int, default=int(os.getenv("MAX_ITEMS", "5000")))
    parser.add_argument("--max-events", type=int, default=int(os.getenv("MAX_EVENTS", "500000")))
    parser.add_argument("--test-fraction", type=float, default=float(os.getenv("TEST_FRACTION", "0.2")))
    parser.add_argument(
        "--image-dir",
        type=Path,
        default=Path(os.environ["HM_IMAGE_DIR"]) if os.getenv("HM_IMAGE_DIR") else None,
    )
    parser.add_argument("--image-base-url", default=os.getenv("HM_IMAGE_BASE_URL", ""))
    args = parser.parse_args()
    try:
        events, interactions, items = prepare_dataset(**vars(args))
    except FileNotFoundError as error:
        print(error)
        raise SystemExit(2) from error
    print(
        f"wrote {len(events)} purchases, {events['user_id'].nunique()} customers, "
        f"and {len(items)} real H&M products to {args.output_dir}"
    )


if __name__ == "__main__":
    main()
