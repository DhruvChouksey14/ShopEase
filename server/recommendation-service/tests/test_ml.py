from pathlib import Path
import json
import sys

import pandas as pd
import pytest

from app.ml.artifacts import save_versioned_artifact
from app.ml.content import ContentModel
from app.ml.evaluate import evaluate, evaluate_dataset
from app.ml.train import merge_interactions, promotion_allowed
import app.ml.train as train_module
from app.ml.collaborative import CollaborativeModel
from app.ml.matrix import build_interaction_matrix
from app.ml.ranker import rerank, time_decay
from app.ml.evaluate import _popular


def products():
    return pd.DataFrame([
        {"product_id": "a", "name": "Wireless phone", "description": "black phone", "brand": "Acme", "category": "electronics", "attributes": {}},
        {"product_id": "b", "name": "Wireless headphones", "description": "black audio", "brand": "Acme", "category": "electronics", "attributes": {}},
        {"product_id": "c", "name": "Coffee mug", "description": "ceramic cup", "brand": "Home", "category": "kitchen", "attributes": {}},
    ])


def test_matrix_shape_and_weights():
    rows = pd.DataFrame([
        {"user_id": "u1", "product_id": "a", "event_type": "product_view"},
        {"user_id": "u1", "product_id": "b", "event_type": "purchase"},
        {"user_id": "u2", "product_id": "c", "weight": 3},
    ])
    result = build_interaction_matrix(rows)
    assert result.matrix.shape == (2, 3)
    assert result.matrix[result.user_ids.index("u1"), result.item_ids.index("b")] == 5


def test_content_output_and_unknown_product_cold_start():
    model = ContentModel(products())
    recommendations = model.similar("a", limit=2)
    assert len(recommendations) == 2
    assert all(len(item) == 2 for item in recommendations)
    assert model.similar("new-product") == []


def test_rerank_removes_purchased_and_diversifies():
    result = rerank([
        {"product_id": "a", "score": 1}, {"product_id": "b", "score": 0.9}, {"product_id": "c", "score": 0.8},
    ], purchased={"a"}, category_by_id={"b": "electronics", "c": "kitchen"}, limit=2)
    assert [item["product_id"] for item in result] == ["b", "c"]


def test_evaluation_has_required_metrics():
    interactions = pd.DataFrame([
        {"user_id": "u1", "product_id": "a", "weight": 5},
        {"user_id": "u2", "product_id": "b", "weight": 3},
    ])
    result = evaluate(interactions, k=2)
    assert {"precision_at_k", "recall_at_k", "ndcg_at_k", "map_at_k", "catalog_coverage"} <= result.keys()


def test_evaluation_uses_time_split_and_seen_users_only():
    interactions = pd.DataFrame([
        {"user_id": "u1", "product_id": "a", "weight": 1, "ts": 1},
        {"user_id": "u1", "product_id": "b", "weight": 1, "ts": 2},
        {"user_id": "u1", "product_id": "c", "weight": 1, "ts": 3},
        {"user_id": "u2", "product_id": "d", "weight": 1, "ts": 4},
        {"user_id": "u2", "product_id": "e", "weight": 1, "ts": 5},
        {"user_id": "u2", "product_id": "f", "weight": 1, "ts": 6},
        {"user_id": "u3", "product_id": "g", "weight": 1, "ts": 7},
    ])
    report = evaluate_dataset(interactions, k=2, test_fraction=1 / 3)
    assert report["sizes"] == {"rows": 7, "train_rows": 4, "test_rows": 3, "validation_rows": 1, "heldout_rows": 2, "validation_users": 1, "users_evaluated": 1, "catalog": 7}
    assert report["split_date"] == pytest.approx(5.0)
    assert set(report["models"]) == {"popularity", "popularity_plain", "item_item", "als", "content", "hybrid"}
    assert report["validation"]["hybrid"]
    assert report["heldout"]["hybrid"]
    assert report["hybrid_weights"] is not None


def test_promotion_gate_refuses_worse_als_and_hybrid():
    report = {"models": {
        "popularity": {"ndcg_at_k": 0.5},
        "popularity_plain": {"ndcg_at_k": 0.4},
        "hybrid": {"ndcg_at_k": 0.59},
    }}
    assert promotion_allowed(report) is False
    report["models"]["hybrid"]["ndcg_at_k"] = 0.61
    assert promotion_allowed(report) is True


def test_als_damps_and_caps_weights():
    matrix = build_interaction_matrix(pd.DataFrame([{"user_id": "u1", "product_id": "a", "weight": 100}]))
    model = CollaborativeModel(matrix, damping_cap=3.0)
    assert model.user_items[0, 0] == 3.0


def test_live_merge_adds_rows_and_applies_recency_weighting():
    dataset = pd.DataFrame([{"user_id": "u1", "product_id": "a", "weight": 1, "ts": 100}])
    live = pd.DataFrame([{"user_id": "u2", "session_id": None, "product_id": "b", "weight": 4, "ts": "1970-01-01T00:01:40Z"}])
    merged = merge_interactions(dataset, live, "hybrid")
    assert set(merged["product_id"]) == {"a", "b"}
    assert merged.loc[merged["product_id"] == "b", "weight"].iloc[0] == 4


def test_merge_normalizes_millisecond_dataset_and_live_seconds():
    dataset = pd.DataFrame([{"user_id": "u1", "product_id": "old", "weight": 1, "ts": 1_700_000_000_000}])
    live = pd.DataFrame([{"user_id": "u2", "session_id": None, "product_id": "new", "weight": 2, "ts": "2023-11-14T22:13:21Z"}])
    merged = merge_interactions(dataset, live, "hybrid")
    assert merged["ts"].max() < 2_000_000_000
    assert merged.sort_values("ts")["product_id"].tolist() == ["old", "new"]


def test_time_decay_and_popularity_are_nonzero_and_unit_invariant():
    seconds = 1_700_000_000.0
    rows = pd.DataFrame([
        {"product_id": "old", "weight": 1, "ts": seconds - 5 * 86400},
        {"product_id": "new", "weight": 1, "ts": seconds},
    ])
    milliseconds = rows.assign(ts=rows["ts"] * 1000)
    second_scores = dict(_popular(rows, ["old", "new"], seconds))
    millisecond_scores = dict(_popular(milliseconds, ["old", "new"], seconds * 1000))
    assert millisecond_scores == pytest.approx(second_scores)
    assert millisecond_scores["new"] > 0.99
    assert millisecond_scores["old"] < millisecond_scores["new"]
    assert 0 < millisecond_scores["old"] < 1
    assert millisecond_scores["new"] == pytest.approx(1.0)
    assert time_decay(seconds * 1000, seconds * 1000) == pytest.approx(time_decay(seconds, seconds))


def test_evaluation_popularity_baseline_is_not_all_zero():
    interactions = pd.DataFrame([
        {"user_id": "u1", "product_id": "a", "weight": 1, "ts": 1_700_000_000_000},
        {"user_id": "u1", "product_id": "b", "weight": 1, "ts": 1_700_000_100_000},
        {"user_id": "u2", "product_id": "a", "weight": 1, "ts": 1_700_000_200_000},
        {"user_id": "u2", "product_id": "c", "weight": 1, "ts": 1_700_000_300_000},
        {"user_id": "u3", "product_id": "b", "weight": 1, "ts": 1_700_000_400_000},
    ])
    report = evaluate_dataset(interactions, k=2, test_fraction=0.4)
    assert report["models"]["popularity"]["ndcg_at_k"] >= 0
    scores = _popular(interactions.iloc[:3], ["a", "b", "c"], interactions["ts"].iloc[2])
    assert any(score > 0 for _, score in scores)
    assert len({score for _, score in scores}) > 1


def test_serving_popularity_is_identical_for_seconds_and_milliseconds():
    from types import SimpleNamespace
    from app.serving import RecommendationEngine

    seconds = 1_700_000_000.0
    rows = pd.DataFrame([
        {"product_id": "old", "weight": 1, "ts": seconds - 5 * 86400},
        {"product_id": "new", "weight": 1, "ts": seconds},
    ])
    engine = RecommendationEngine("/unused")
    engine.bundle = SimpleNamespace(interactions=rows, products=None)
    seconds_scores = dict(engine._popular_candidates(10))
    engine.bundle.interactions = rows.assign(ts=rows["ts"] * 1000)
    milliseconds_scores = dict(engine._popular_candidates(10))
    assert milliseconds_scores == pytest.approx(seconds_scores)


def test_main_forwards_hybrid_options_and_live_rows(monkeypatch, tmp_path, capsys):
    captured = {}

    def fake_train(data_dir, model_dir, category, dataset_name, data_source, database_url):
        captured.update(dataset_name=dataset_name, data_source=data_source, database_url=database_url)
        return tmp_path / "model"

    monkeypatch.setattr(train_module, "train", fake_train)
    monkeypatch.setattr(sys, "argv", [
        "train", "--data-source", "hybrid", "--dataset-name", "Retailrocket",
        "--database-url", "postgresql://test", "--data-dir", str(tmp_path),
    ])
    train_module.main()
    assert captured == {
        "dataset_name": "Retailrocket",
        "data_source": "hybrid",
        "database_url": "postgresql://test",
    }

    dataset = pd.DataFrame([{"user_id": "u1", "product_id": "a", "weight": 1, "ts": 1}])
    live = pd.DataFrame([{"user_id": "u2", "session_id": None, "product_id": "b", "weight": 2, "ts": "1970-01-01T00:00:02Z"}])
    assert set(merge_interactions(dataset, live, "hybrid")["product_id"]) == {"a", "b"}
    assert json.loads(capsys.readouterr().out)["artifact"].endswith("model")


def test_artifact_swap_is_atomic(tmp_path: Path):
    class Model:
        def save(self, path):
            path.write_text("model")

    target = save_versioned_artifact(Model(), tmp_path, {"version": "v1"})
    assert (tmp_path / "current").is_symlink()
    assert (tmp_path / "current" / "model.pkl").read_text() == "model"
    assert target.name == "v1"


def test_artifacts_keep_only_two_versions(tmp_path: Path):
    class Model:
        def save(self, path):
            path.write_text("model")

    for version in ("model-1", "model-2", "model-3"):
        save_versioned_artifact(Model(), tmp_path, {"version": version})
    versions = sorted(path.name for path in tmp_path.iterdir() if path.is_dir() and path.name.startswith("model-"))
    assert versions == ["model-2", "model-3"]
