from __future__ import annotations

import json
import os
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

import psycopg
from psycopg.rows import dict_row


SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,
  display_name TEXT,
  list_type TEXT NOT NULL DEFAULT 'organic'
    CHECK(list_type IN ('paid_kol','media','platform','koc','organic','official')),
  region TEXT,
  source TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(platform, handle)
);
CREATE TABLE IF NOT EXISTS posts (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  external_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL UNIQUE,
  author_handle TEXT,
  author_name TEXT,
  title TEXT,
  body TEXT,
  language TEXT,
  region TEXT,
  list_type TEXT NOT NULL DEFAULT 'organic',
  sentiment TEXT NOT NULL DEFAULT 'neu',
  published_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(platform, external_id)
);
CREATE TABLE IF NOT EXISTS post_snapshots (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  views BIGINT,
  likes BIGINT,
  comments BIGINT,
  shares BIGINT,
  UNIQUE(post_id, observed_at)
);
CREATE TABLE IF NOT EXISTS crawl_state (
  source TEXT NOT NULL,
  query TEXT NOT NULL,
  cursor TEXT,
  last_success_at TIMESTAMPTZ,
  PRIMARY KEY(source, query)
);
CREATE TABLE IF NOT EXISTS crawl_runs (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  query TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  fetched INTEGER NOT NULL DEFAULT 0,
  inserted INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_type ON posts(list_type, platform);
CREATE INDEX IF NOT EXISTS idx_snapshots_post_time ON post_snapshots(post_id, observed_at DESC);
"""


def _json_default(value: Any) -> str:
    if isinstance(value, (datetime,)):
        return value.isoformat()
    raise TypeError(f"Cannot encode {type(value).__name__}")


class PostgresDatabase:
    def __init__(self, url: str | None = None):
        self.url = url or os.environ.get("DATABASE_URL", "")
        if not self.url:
            raise RuntimeError("DATABASE_URL is not configured")

    @contextmanager
    def connect(self) -> Iterator[psycopg.Connection]:
        with psycopg.connect(self.url, row_factory=dict_row, connect_timeout=10) as conn:
            yield conn

    def init(self) -> None:
        with self.connect() as conn:
            conn.execute(SCHEMA)

    @contextmanager
    def collection_lock(self) -> Iterator[bool]:
        """Hold a session lock for the whole collection, preventing overlapping jobs."""
        with psycopg.connect(self.url, row_factory=dict_row, connect_timeout=10) as conn:
            locked = bool(conn.execute(
                "SELECT pg_try_advisory_lock(hashtext('roco-sentinel-cron')) AS ok"
            ).fetchone()["ok"])
            try:
                yield locked
            finally:
                if locked:
                    conn.execute("SELECT pg_advisory_unlock(hashtext('roco-sentinel-cron'))")

    def get_cursor(self, source: str, query: str) -> str | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT cursor FROM crawl_state WHERE source=%s AND query=%s", (source, query)
            ).fetchone()
        return row["cursor"] if row else None

    def set_cursor(self, source: str, query: str, cursor: str | None) -> None:
        with self.connect() as conn:
            conn.execute(
                """INSERT INTO crawl_state(source,query,cursor,last_success_at) VALUES(%s,%s,%s,now())
                   ON CONFLICT(source,query) DO UPDATE SET cursor=excluded.cursor,last_success_at=excluded.last_success_at""",
                (source, query, cursor),
            )

    def start_run(self, source: str, query: str) -> int:
        with self.connect() as conn:
            row = conn.execute(
                "INSERT INTO crawl_runs(source,query,status) VALUES(%s,%s,'running') RETURNING id",
                (source, query),
            ).fetchone()
        return int(row["id"])

    def finish_run(self, run_id: int, *, status: str, fetched: int, inserted: int, updated: int, error: str | None = None) -> None:
        with self.connect() as conn:
            conn.execute(
                """UPDATE crawl_runs SET finished_at=now(),status=%s,fetched=%s,inserted=%s,updated=%s,error=%s
                   WHERE id=%s""",
                (status, fetched, inserted, updated, error, run_id),
            )

    def upsert_post(self, post: dict[str, Any]) -> str:
        raw = json.dumps(post.get("raw", {}), ensure_ascii=False, default=_json_default)
        with self.connect() as conn:
            account = None
            if post.get("author_handle"):
                account = conn.execute(
                    """SELECT list_type FROM accounts WHERE platform=%s
                       AND lower(handle)=lower(%s) AND active=TRUE""",
                    (post["platform"], post["author_handle"]),
                ).fetchone()
            list_type = post.get("list_type") or (account["list_type"] if account else "organic")
            existing = conn.execute(
                "SELECT id FROM posts WHERE platform=%s AND external_id=%s",
                (post["platform"], str(post["external_id"])),
            ).fetchone()
            row = conn.execute(
                """INSERT INTO posts(platform,external_id,canonical_url,author_handle,author_name,title,body,
                                      language,region,list_type,sentiment,published_at,raw_json)
                   VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb)
                   ON CONFLICT(platform,external_id) DO UPDATE SET
                     canonical_url=excluded.canonical_url,author_handle=excluded.author_handle,
                     author_name=excluded.author_name,title=excluded.title,body=excluded.body,
                     language=COALESCE(excluded.language,posts.language),
                     region=COALESCE(excluded.region,posts.region),list_type=excluded.list_type,
                     sentiment=excluded.sentiment,published_at=COALESCE(excluded.published_at,posts.published_at),
                     last_seen_at=now(),raw_json=excluded.raw_json RETURNING id""",
                (
                    post["platform"], str(post["external_id"]), post["canonical_url"],
                    post.get("author_handle"), post.get("author_name"), post.get("title"), post.get("body"),
                    post.get("language"), post.get("region"), list_type, post.get("sentiment", "neu"),
                    post.get("published_at"), raw,
                ),
            ).fetchone()
            stats = post.get("stats") or {}
            if stats:
                conn.execute(
                    """INSERT INTO post_snapshots(post_id,views,likes,comments,shares)
                       VALUES(%s,%s,%s,%s,%s)""",
                    (row["id"], stats.get("views"), stats.get("likes"), stats.get("comments"), stats.get("shares")),
                )
        return "updated" if existing else "inserted"

    def summary(self) -> dict[str, Any]:
        with self.connect() as conn:
            total = conn.execute("SELECT count(*) AS n FROM posts").fetchone()["n"]
            by_platform = list(conn.execute(
                "SELECT platform,count(*) AS count FROM posts GROUP BY platform ORDER BY count DESC"
            ).fetchall())
            by_type = list(conn.execute(
                "SELECT list_type,count(*) AS count FROM posts GROUP BY list_type ORDER BY count DESC"
            ).fetchall())
            last_scan = conn.execute(
                "SELECT max(finished_at) AS t FROM crawl_runs WHERE status='ok'"
            ).fetchone()["t"]
        return {"total_posts": total, "by_platform": by_platform, "by_list_type": by_type, "last_scan": last_scan}

    def posts(self, limit: int = 100, platform: str | None = None) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                """SELECT p.*,s.views,s.likes,s.comments,s.shares
                   FROM posts p LEFT JOIN LATERAL (
                     SELECT views,likes,comments,shares FROM post_snapshots
                     WHERE post_id=p.id ORDER BY observed_at DESC LIMIT 1
                   ) s ON TRUE
                   WHERE (%s IS NULL OR p.platform=%s)
                   ORDER BY COALESCE(p.published_at,p.first_seen_at) DESC LIMIT %s""",
                (platform, platform, min(max(limit, 1), 1000)),
            ).fetchall()
        return list(rows)
