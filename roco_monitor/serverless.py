from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta, timezone
from typing import Any

from .connectors import TikTokResearchConnector, XaiConnector, XaiWebConnector, YouTubeConnector
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
    xai_key = os.environ.get("XAI_API_KEY", "")
    xai_model = os.environ.get("XAI_MODEL", "grok-4.6")
    youtube = YouTubeConnector(os.environ.get("YOUTUBE_API_KEY", ""))
    x_search = XaiConnector(xai_key, xai_model)
    tiktok_research = TikTokResearchConnector(
        os.environ.get("TIKTOK_RESEARCH_CLIENT_KEY", ""),
        os.environ.get("TIKTOK_RESEARCH_CLIENT_SECRET", ""),
        os.environ.get("TIKTOK_RESEARCH_ACCESS_TOKEN", ""),
    )
    roster_jobs: list[tuple[str, str, Any, list[dict[str, Any]]]] = []
    youtube_accounts = db.monitor_accounts("youtube", limit=500)
    if youtube_accounts:
        roster_jobs.append(("youtube_roster", "daily_named_accounts", youtube, youtube_accounts))
    x_accounts = db.monitor_accounts("x", limit=50)
    if x_accounts and x_search.enabled():
        roster_jobs.append(("x_roster", "daily_named_accounts", x_search, x_accounts))
    tiktok_accounts = db.monitor_accounts("tiktok", limit=500 if tiktok_research.enabled() else 60)
    if tiktok_accounts:
        if tiktok_research.enabled():
            roster_jobs.append(("tiktok_roster_research", "daily_named_accounts", tiktok_research, tiktok_accounts))
        elif xai_key:
            for index in range(0, len(tiktok_accounts), 20):
                roster_jobs.append((
                    "tiktok_roster_web", f"daily_named_accounts_{index // 20 + 1}",
                    XaiWebConnector(xai_key, "tiktok", xai_model), tiktok_accounts[index:index + 20],
                ))
    jobs = [
        ("youtube", keyword, youtube) for keyword in KEYWORDS
    ] + [
        ("x", keyword, x_search) for keyword in KEYWORDS
    ] + [
        ("tiktok_web", "Roco Kingdom | ロコキングダム", XaiWebConnector(xai_key, "tiktok", xai_model)),
        ("reddit_web", "Roco Kingdom | ロコキングダム", XaiWebConnector(xai_key, "reddit", xai_model)),
        ("open_web", "Roco Kingdom | ロコキングダム", XaiWebConnector(xai_key, "web", xai_model)),
    ]
    report: list[dict[str, Any]] = []
    for source, query, connector, accounts in roster_jobs:
        item = {"source": source, "query": query, "accounts": len(accounts), "fetched": 0, "inserted": 0, "updated": 0}
        report.append(item)
        run_id = db.start_run(source, query)
        try:
            if source == "youtube_roster":
                result = connector.search_accounts(accounts, overlap.isoformat(timespec="seconds"))
            else:
                result = connector.search_accounts(accounts, overlap.date().isoformat(), now.date().isoformat())
            item["fetched"] = len(result.posts)
            for post in result.posts:
                outcome = db.upsert_post(post)
                item[outcome] += 1
            for update in result.account_updates:
                db.update_account_monitor(update)
            item["status"] = "ok"
            db.finish_run(run_id, status="ok", fetched=item["fetched"], inserted=item["inserted"], updated=item["updated"])
        except Exception as exc:
            error = f"{type(exc).__name__}: {exc}"[:1000]
            item.update(status="error", error=error)
            db.finish_run(run_id, status="error", fetched=item["fetched"], inserted=item["inserted"], updated=item["updated"], error=error)
    for source, query, connector in jobs:
        item = {"source": source, "query": query, "fetched": 0, "inserted": 0, "updated": 0}
        report.append(item)
        if not connector.enabled():
            item["status"] = "skipped_missing_key"
            continue
        run_id = db.start_run(source, query)
        try:
            if source == "youtube":
                cursor = db.get_cursor(source, query) or overlap.isoformat(timespec="seconds")
                result = connector.search(query, cursor, max_pages=3)
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
