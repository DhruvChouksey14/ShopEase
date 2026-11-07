from __future__ import annotations

from itertools import product
from typing import Iterable

DEFAULT_WEIGHTS = {"item_item": 0.35, "als": 0.25, "content": 0.20, "popularity": 0.20}


def _normalise(values: Iterable[tuple[str, float]]) -> dict[str, float]:
    values = list(values)
    maximum = max((float(score) for _, score in values), default=0.0) or 1.0
    return {str(item): float(score) / maximum for item, score in values}


def hybrid_rank(
    item_item: Iterable[tuple[str, float]] = (),
    als: Iterable[tuple[str, float]] = (),
    content: Iterable[tuple[str, float]] = (),
    popularity: Iterable[tuple[str, float]] = (),
    weights: dict[str, float] | None = None,
    limit: int = 10,
    excluded: set[str] | None = None,
) -> list[tuple[str, float]]:
    weights = {**DEFAULT_WEIGHTS, **(weights or {})}
    excluded = {str(item) for item in (excluded or set())}
    components = {
        "item_item": _normalise(item_item),
        "als": _normalise(als),
        "content": _normalise(content),
        "popularity": _normalise(popularity),
    }
    scores: dict[str, float] = {}
    for component, values in components.items():
        for item, score in values.items():
            if item not in excluded:
                scores[item] = scores.get(item, 0.0) + weights[component] * score
    return sorted(scores.items(), key=lambda pair: (-pair[1], pair[0]))[:limit]


def weight_grid() -> list[dict[str, float]]:
    return [
        # The H&M catalog has rich descriptive metadata and purchase-only
        # interactions, so validation must be able to favor content matching.
        {"item_item": 0.20, "als": 0.10, "content": 0.60, "popularity": 0.10},
        {"item_item": 0.10, "als": 0.10, "content": 0.70, "popularity": 0.10},
        {"item_item": 0.10, "als": 0.00, "content": 0.80, "popularity": 0.10},
        {"item_item": 0.00, "als": 0.00, "content": 0.90, "popularity": 0.10},
        {"item_item": 0.25, "als": 0.15, "content": 0.50, "popularity": 0.10},
        {"item_item": 0.50, "als": 0.10, "content": 0.20, "popularity": 0.20},
        {"item_item": 0.40, "als": 0.20, "content": 0.20, "popularity": 0.20},
        {"item_item": 0.35, "als": 0.25, "content": 0.20, "popularity": 0.20},
        {"item_item": 0.50, "als": 0.20, "content": 0.10, "popularity": 0.20},
        {"item_item": 0.60, "als": 0.10, "content": 0.10, "popularity": 0.20},
        {"item_item": 0.40, "als": 0.30, "content": 0.10, "popularity": 0.20},
    ]
