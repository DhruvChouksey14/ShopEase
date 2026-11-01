from __future__ import annotations

import numpy as np
import os
from sklearn.metrics.pairwise import cosine_similarity

from .matrix import InteractionMatrix


class CollaborativeModel:
    def __init__(self, interaction_matrix: InteractionMatrix, factors: int = 32, damping_cap: float | None = None):
        self.item_ids = interaction_matrix.item_ids
        self.user_ids = interaction_matrix.user_ids
        self.damping_cap = damping_cap if damping_cap is not None else float(os.getenv("ALS_WEIGHT_DAMPING_MAX", "10"))
        self.user_items = interaction_matrix.matrix.copy().astype(np.float32)
        self.user_items.data = np.minimum(1.0 + np.log1p(self.user_items.data), self.damping_cap)
        self.index = {value: index for index, value in enumerate(self.user_ids)}
        self.item_index = {value: index for index, value in enumerate(self.item_ids)}
        self.model = None
        self.item_factors = np.empty((0, 0))
        if interaction_matrix.matrix.shape[0] and interaction_matrix.matrix.shape[1]:
            from implicit.als import AlternatingLeastSquares

            self.model = AlternatingLeastSquares(factors=factors, iterations=10, random_state=42)
            self.model.fit(self.user_items, show_progress=False)
            self.item_factors = self.model.item_factors

    def recommend(self, user_id: str, limit: int = 10) -> list[tuple[str, float]]:
        if self.model is None or user_id not in self.index:
            return []
        user_index = self.index[user_id]
        item_ids, scores = self.model.recommend(user_index, self.user_items[user_index], N=limit, filter_already_liked_items=True)
        return [(self.item_ids[int(item_id)], float(score)) for item_id, score in zip(item_ids, scores)]

    def together(self, product_id: str, limit: int = 10) -> list[tuple[str, float]]:
        if self.model is None or product_id not in self.item_index:
            return []
        item_id = self.item_index[product_id]
        ids, scores = self.model.similar_items(item_id, N=limit + 1)
        return [(self.item_ids[int(index)], float(score)) for index, score in zip(ids, scores) if int(index) != item_id][:limit]

    def item_item_cosine(self, product_id: str, limit: int = 10) -> list[tuple[str, float]]:
        if product_id not in self.item_index or not self.item_ids:
            return []
        item_index = self.item_index[product_id]
        similarities = cosine_similarity(self.user_items.T[item_index], self.user_items.T).ravel()
        order = np.argsort(-similarities)
        return [(self.item_ids[index], float(similarities[index])) for index in order if index != item_index][:limit]

    def item_item_for_user(self, user_id: str, limit: int = 10) -> list[tuple[str, float]]:
        if user_id not in self.index or not self.item_ids:
            return []
        user_index = self.index[user_id]
        similarities = cosine_similarity(self.user_items[user_index], self.user_items).ravel()
        scores = np.asarray(self.user_items.T @ similarities).ravel()
        seen = set(self.user_items[user_index].indices)
        order = np.argsort(-scores)
        return [(self.item_ids[index], float(scores[index])) for index in order if index not in seen][:limit]