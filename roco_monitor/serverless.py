from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta, timezone
from typing import Any

from .connectors import XaiConnector, YouTubeConnector
from .postgres import PostgresDatabase


KEYWORDS = ("Roco Kingdom", "ロコキングダム")


def jsonable(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(item) for item in value]
    return value


def dumps(value: Any) -> bytes:
    return json.dumps(jsonable(value), ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def run_collection(db: PostgresDatabase) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    overlap = now - timedelta(days=2)
    connectors = [
        ("youtube", YouTubeConnector(os.environ.get("YOUTUBE_API_KEY", ""))),
        ("x", XaiConnector(os.environ.get("XAI_API_KEY", ""), os.environ.get("XAI_MODEL", "grok-4.6"))),
    ]
    report: list[dict[str, Any]] = []
    for source, connector in connectors:
        for query in KEYWORDS:
            item = {"source": source, "query": query, "fetched": 0, "inserted": 0, "updated": 0}
            report.append(item)
            if not connector.enabled():
                item["status"] = "skipped_missing_key"
                continue
            run_id = db.start_run(source, query)
            try:
                if source == "youtube":
                    cursor = db.get_cursor(source, query) or overlap.isoformat(timespec="seconds")
                    result = connector.search(query, cursor)
                    next_cursor = overlap.isoformat(timespec="seconds")
                else:
                    result = connector.search(query, overlap.date().isoformat(), now.date().isoformat())
                    next_cursor = now.isoformat(timespec="seconds")
                item["fetched"] = len(result.posts)
                for post in result.posts:
                    outcome = db.upsert_post(post)
                    item[outcome] += 1
                db.set_cursor(source, query, next_cursor)
                item["status"] = "ok"
                db.finish_run(run_id, status="ok", fetched=item["fetched"], inserted=item["inserted"], updated=item["updated"])
            except Exception as exc:
                error = f"{type(exc).__name__}: {exc}"[:1000]
                item.update(status="error", error=error)
                db.finish_run(run_id, status="error", fetched=item["fetched"], inserted=item["inserted"], updated=item["updated"], error=error)
    return {"ran_at": now, "results": report, "summary": db.summary()}
