import importlib.util
from pathlib import Path

import pandas as pd


spec = importlib.util.spec_from_file_location("import_dataset", Path(__file__).with_name("import_dataset.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

demo_spec = importlib.util.spec_from_file_location("make_demo_user", Path(__file__).with_name("make_demo_user.py"))
demo_module = importlib.util.module_from_spec(demo_spec)
demo_spec.loader.exec_module(demo_module)


def write_fixture(root: Path) -> Path:
    raw = root / "hm"
    raw.mkdir(parents=True)
    pd.DataFrame([
        {
            "article_id": "010",
            "prod_name": "Cotton shirt",
            "detail_desc": "A soft cotton shirt.",
            "product_type_name": "Shirt",
            "product_group_name": "Garment Upper body",
            "colour_group_name": "Blue",
            "index_name": "Ladieswear",
            "index_group_name": "Ladieswear",
            "department_name": "Shirts",
            "section_name": "Basics",
            "garment_group_name": "Jersey Fancy",
            "graphical_appearance_name": "Solid",
        },
        {
            "article_id": "020",
            "prod_name": "Cotton trousers",
            "detail_desc": "Straight leg cotton trousers.",
            "product_type_name": "Trousers",
            "product_group_name": "Garment Lower body",
            "colour_group_name": "Black",
            "index_name": "Menswear",
            "index_group_name": "Menswear",
            "department_name": "Trousers",
            "section_name": "Basics",
            "garment_group_name": "Trousers",
            "graphical_appearance_name": "Solid",
        },
    ]).to_csv(raw / "articles.csv", index=False)
    rows = []
    for index in range(24):
        rows.append({
            "t_dat": f"2020-09-{index + 1:02d}",
            "customer_id": "customer-1",
            "article_id": "010" if index % 2 == 0 else "020",
            "price": 0.02 if index % 2 == 0 else 0.03,
        })
    pd.DataFrame(rows).to_csv(raw / "transactions_train.csv", index=False)
    return raw


def test_prepare_dataset_keeps_real_hm_details_and_purchase_events(tmp_path: Path):
    raw = write_fixture(tmp_path)
    events, interactions, items = module.prepare_dataset(
        raw, tmp_path / "processed", min_interactions=3, max_events_per_customer=100,
        max_items=20, max_events=100, test_fraction=0.2,
    )
    assert len(events) == len(interactions) == 24
    assert set(interactions["product_id"]) == {"hm_010", "hm_020"}
    assert set(events["event_type"]) == {"purchase"}
    assert set(events["split"]) == {"train", "test"}
    assert set(items["name"]) == {"Cotton shirt", "Cotton trousers"}
    assert "Blue" in items.loc[items["name"] == "Cotton shirt", "tokens"].iloc[0]
    assert (tmp_path / "processed" / "products.parquet").exists()


def test_prepare_dataset_uses_available_hm_image_with_configured_base_url(tmp_path: Path):
    raw = write_fixture(tmp_path)
    image_dir = raw / "images" / "010"
    image_dir.mkdir(parents=True)
    (image_dir / "010.jpg").write_bytes(b"image")

    _, _, items = module.prepare_dataset(
        raw, tmp_path / "processed", min_interactions=3, max_events_per_customer=100,
        max_items=20, max_events=100, test_fraction=0.2,
        image_base_url="https://cdn.example.test/catalog/",
    )

    image = items.loc[items["article_id"] == "010", "image_url"].iloc[0]
    assert image == "https://cdn.example.test/catalog/images/010/010.jpg"


def test_missing_hm_files_printable_error(tmp_path: Path):
    try:
        module.validate_input_files(tmp_path)
    except FileNotFoundError as error:
        assert "articles.csv" in str(error)
        assert "transactions_train.csv" in str(error)
    else:
        raise AssertionError("missing H&M files should fail")


def test_demo_user_selection_uses_hm_customer_schema(tmp_path: Path):
    events = pd.DataFrame([
        {"user_id": "active", "product_id": str(index), "category_id": "cat-1" if index < 10 else "cat-2"}
        for index in range(20)
    ] + [
        {"user_id": "inactive", "product_id": "x", "category_id": "cat-1"}
    ])
    path = tmp_path / "events.parquet"
    events.to_parquet(path, index=False)
    assert demo_module.choose_dataset_user(path) == "active"
