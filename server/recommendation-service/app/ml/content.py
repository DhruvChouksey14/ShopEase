from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


class ContentModel:
    def __init__(self, products: pd.DataFrame):
        self.product_ids = products["product_id"].astype(str).tolist()
        text_columns = ["name", "description", "brand", "category", "attributes"]
        text = products.reindex(columns=text_columns, fill_value="").fillna("").astype(str).agg(" ".join, axis=1)
        self.vectorizer = TfidfVectorizer(max_features=20000, ngram_range=(1, 2), min_df=1)
        self.matrix = self.vectorizer.fit_transform(text) if len(text) else self.vectorizer.fit_transform([""])
        self.index = {product_id: index for index, product_id in enumerate(self.product_ids)}

    def similar(self, product_id: str, limit: int = 10) -> list[tuple[str, float]]:
        if product_id not in self.index:
            return []
        source = self.index[product_id]
        scores = cosine_similarity(self.matrix[source], self.matrix).ravel()
        order = np.argsort(-scores)
        return [(self.product_ids[index], float(scores[index])) for index in order if index != source][:limit]