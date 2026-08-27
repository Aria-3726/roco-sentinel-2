from __future__ import annotations

from dataclasses import dataclass

from .config import Settings
from .connectors import RedditConnector, RssConnector, XConnector, YouTubeConnector
from .db import Database, utcnow


@dataclass
class RunStats:
    source: str
    query: str
    fetched: int = 0
    inserted: int = 0
    updated: int = 0
    skipped: bool = False
    error: str | None = None


class Monitor:
    def __init__(self, settings: Settings, db: Database):
        self.settings = settings
        self.db = db
        self.connectors = {
            "youtube": YouTubeConnector(settings.youtube_api_key),
            "x": XConnector(settings.x_bearer_token),
            "reddit": RedditConnector(settings.reddit_client_id, settings.reddit_client_secret, settings.reddit_user_agent),
            "rss": RssConnector(settings.rss_feeds),
        }

    def crawl(self, sources: list[str] | None = None) -> list[RunStats]:
        selected = sources or list(self.connectors)
        results: list[RunStats] = []
        for source in selected:
            connector = self.connectors[source]
            for query in self.settings.keywords:
                stats = RunStats(source, query)
                results.append(stats)
                if not connector.enabled():
                    stats.skipped = True
                    continue
                started = utcnow()
                with self.db.connect() as conn:
                    run_id = conn.execute(
                        "INSERT INTO crawl_runs(source,query,started_at,status) VALUES(?,?,?,'running')",
                        (source, query, started),
                    ).lastrowid
                try:
                    cursor = self.db.get_cursor(source, query)
                    result = connector.search(query, cursor)
                    stats.fetched = len(result.posts)
                    for post in result.posts:
                        outcome = self.db.upsert_post(post)
                        setattr(stats, outcome, getattr(stats, outcome) + 1)
                    self.db.set_cursor(source, query, result.cursor)
                    status, error = "ok", None
                except Exception as exc:  # one source failure must not stop the rest
                    status, error = "error", f"{type(exc).__name__}: {exc}"
                    stats.error = error
                with self.db.connect() as conn:
                    conn.execute(
                        """UPDATE crawl_runs SET finished_at=?,status=?,fetched=?,inserted=?,updated=?,error=?
                           WHERE id=?""",
                        (utcnow(), status, stats.fetched, stats.inserted, stats.updated, error, run_id),
                    )
        return results
