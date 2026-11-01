from __future__ import annotations

import json
import os
import shutil
import tempfile
from pathlib import Path


def save_versioned_artifact(model, model_dir: str | Path, metadata: dict) -> Path:
    root = Path(model_dir)
    root.mkdir(parents=True, exist_ok=True)
    version = str(metadata.get("version") or "model-" + str(int(__import__("time").time())))
    if (root / version).exists():
        version = f"{version}-{int(__import__('time').time_ns())}"
    target = root / version
    with tempfile.TemporaryDirectory(dir=root) as temporary:
        staging = Path(temporary) / version
        staging.mkdir()
        model.save(staging / "model.pkl")
        (staging / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
        os.replace(staging, target)
    current = root / "current"
    temporary_link = root / ".current.tmp"
    temporary_link.unlink(missing_ok=True)
    temporary_link.symlink_to(target.name)
    os.replace(temporary_link, current)
    versions = sorted(
        (path for path in root.iterdir() if path.is_dir() and path.name.startswith("model-")),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for stale in versions[2:]:
        shutil.rmtree(stale)
    return target