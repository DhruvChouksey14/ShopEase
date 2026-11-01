from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix


WEIGHTS = {"view": 1.0, "product_view": 1.0, "add_to_cart": 3.0, "purchase": 5.0}


@dataclass
class InteractionMatrix:
    matrix: csr_matrix
    user_ids: list[str]
    item_ids: list[str]
    weights: pd.DataFrame


def build_interaction_matrix(interactions: pd.DataFrame) -> InteractionMatrix:
    required = {"user_id", "product_id"}
    missing = required - set(interactions.columns)
    if missing:
        raise ValueError(f"missing interaction columns: {sorted(missing)}")
    rows = interactions.copy()
    event_weights = rows.get("event_type", pd.Series("view", index=rows.index)).map(WEIGHTS).fillna(1.0)
    if "weight" not in rows:
        rows["weight"] = event_weights
    else:
        rows["weight"] = rows["weight"].fillna(event_weights)
    rows["weight"] = pd.to_numeric(rows["weight"], errors="coerce").fillna(0.0)
    rows = rows[rows["weight"] > 0].copy()
    if rows.empty:
        return InteractionMatrix(csr_matrix((0, 0), dtype=np.float32), [], [], rows)
    rows["user_id"] = rows["user_id"].astype(str)
    rows["product_id"] = rows["product_id"].astype(str)
    user_ids = sorted(rows["user_id"].unique())
    item_ids = sorted(rows["product_id"].unique())
    user_index = {value: index for index, value in enumerate(user_ids)}
    item_index = {value: index for index, value in enumerate(item_ids)}
    matrix = csr_matrix(
        (rows["weight"].astype(np.float32), ([user_index[x] for x in rows["user_id"]], [item_index[x] for x in rows["product_id"]])),
        shape=(len(user_ids), len(item_ids)),
    )
    return InteractionMatrix(matrix, user_ids, item_ids, rows)