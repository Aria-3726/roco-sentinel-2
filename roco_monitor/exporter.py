from __future__ import annotations

import json
from pathlib import Path

from .db import Database


def export_frontend(db: Database, output: str | Path) -> None:
    path = Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"summary": db.summary(), "posts": db.posts(limit=1000)}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")
