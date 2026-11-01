import importlib.util
from pathlib import Path

import pandas as pd


spec = importlib.util.spec_from_file_location("import_dataset", Path(__file__).with_name("import_dataset.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

catalog_spec = importlib.util.spec_from_file_location("load_catalog", Path(__file__).with_name("load_catalog.py"))
catalog_module = importlib.util.module_from_spec(catalog_spec)
catalog_spec.loader.exec_module(catalog_module)

demo_spec = importlib.util.spec_from_file_location("make_demo_user", Path(__file__).with_name("make_demo_user.py"))
demo_module = importlib.util.module_from_spec(demo_spec)
demo_spec.loader.exec_module(demo_module)


def write_fixture(root: Path) -> None:
    raw = root / "raw" / "retailrocket"
    raw.mkdir(parents=True)
    pd.DataFrame([
        {"timestamp": 1, "visitorid": 1, "event": "view", "itemid": 10, "transactionid": ""},
        {"timestamp": 2, "visitorid": 1, "event": "view", "itemid": 10, "transactionid": ""},
        {"timestamp": 3, "visitorid": 1, "event": "addtocart", "itemid": 10, "transactionid": ""},
        {"timestamp": 4, "visitorid": 1, "event": "transaction", "itemid": 20, "transactionid": "t1"},
        {"timestamp": 5, "visitorid": 2, "event": "view", "itemid": 10, "transactionid": ""},
        {"timestamp": 6, "visitorid": 2, "event": "view", "itemid": 10, "transactionid": ""},
        {"timestamp": 7, "visitorid": 2, "event": "view", "itemid": 10, "transactionid": ""},
        {"timestamp": 8, "visitorid": 3, "event": "view", "itemid": 10, "transactionid": ""},
        {"timestamp": 9, "visitorid": 3, "event": "view", "itemid": 10, "transactionid": ""},
        {"timestamp": 10, "visitorid": 3, "event": "view", "itemid": 10, "transactionid": ""},
        {"timestamp": 11, "visitorid": 3, "event": "view", "itemid": 10, "transactionid": ""},
    ]).to_csv(raw / "events.csv", index=False)
    properties = [
        {"timestamp": 1, "itemid": 10, "property": "categoryid", "value": "100"},
        {"timestamp": 2, "itemid": 10, "property": "categoryid", "value": "101"},
        {"timestamp": 3, "itemid": 10, "property": "available", "value": "1"},
        {"timestamp": 1, "itemid": 10, "property": "color", "value": "hashed-value"},
        {"timestamp": 1, "itemid": 20, "property": "categoryid", "value": "200"},
        {"timestamp": 1, "itemid": 20, "property": "available", "value": "0"},
    ]
    pd.DataFrame(properties[:4]).to_csv(raw / "item_properties_part1.csv", index=False)
    pd.DataFrame(properties[4:]).to_csv(raw / "item_properties_part2.csv", index=False)
    pd.DataFrame([
        {"categoryid": 100, "parentid": ""},
        {"categoryid": 101, "parentid": 100},
        {"categoryid": 200, "parentid": ""},
    ]).to_csv(raw / "category_tree.csv", index=False)


def test_prepare_dataset_filters_bot_unavailable_and_keeps_raw_events(tmp_path: Path):
    write_fixture(tmp_path)
    events, interactions, items = module.prepare_dataset(
        tmp_path / "raw" / "retailrocket", tmp_path / "processed", min_interactions=3, max_events_per_visitor=3
    )
    assert items["item_id"].tolist() == ["10"]
    assert len(events) == 3
    assert interactions.loc[interactions["product_id"] == "10", "weight"].sum() == 3
    assert set(events["split"]) == {"train", "test"}
    property_tokens = [token.removeprefix("property_") for token in items.iloc[0]["tokens"].split() if token.startswith("property_")]
    assert property_tokens and all(len(token) == 12 for token in property_tokens)


def test_missing_files_printable_error(tmp_path: Path):
    try:
        module.validate_input_files(tmp_path)
    except FileNotFoundError as error:
        assert "events.csv" in str(error)
        assert "item_properties_part1.csv" in str(error)
        assert "category_tree.csv" in str(error)
    else:
        raise AssertionError("missing Retailrocket files should fail")


def test_catalog_fields_are_deterministic_and_categories_are_bounded():
    first = catalog_module.deterministic_fields("10", "Category 101", 9999, 1999999)
    second = catalog_module.deterministic_fields("10", "Category 101", 9999, 1999999)
    assert first == second
    assert first["name"] == "Category 101 Item 10"
    assert first["image_url"].startswith("https://")

    items = pd.DataFrame({"category_id": [str(value) for value in range(25)]})
    labels = catalog_module.category_labels(items, None)
    assert len(labels) == 21
    assert labels["uncategorized"] == "Uncategorized"


def test_demo_user_selection_requires_active_cross_category_visitor(tmp_path: Path):
    events = pd.DataFrame([
        {"visitorid": "active", "itemid": str(index), "category_id": "cat-1" if index < 10 else "cat-2"}
        for index in range(20)
    ] + [
        {"visitorid": "inactive", "itemid": "x", "category_id": "cat-1"}
    ])
    path = tmp_path / "events.parquet"
    events.to_parquet(path, index=False)
    assert demo_module.choose_dataset_user(path) == "active"
