from __future__ import annotations

import pandas as pd


def to_seconds(values):
    numeric = pd.to_numeric(values, errors="coerce")
    if numeric.isna().all():
        numeric = pd.Series(pd.to_datetime(values, utc=True, errors="coerce").astype("int64") / 1e9, index=getattr(values, "index", None))
    if numeric.notna().any() and numeric.max() > 10_000_000_000:
        return numeric / 1000.0
    return numeric