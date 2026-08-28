from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,
  display_name TEXT,
  list_type TEXT NOT NULL DEFAULT 'organic'
    CHECK(list_type IN ('paid_kol','media','platform','koc','third_party','organic','official')),
  region TEXT,
  source TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(platform, handle)
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  platform TEXT NOT NULL,
  external_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  author_handle TEXT,
  author_name TEXT,
  title TEXT,
  body TEXT,
  language TEXT,
  region TEXT,
  list_type TEXT NOT NULL DEFAULT 'organic',
  sentiment TEXT NOT NULL DEFAULT 'neu',
  published_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  raw_json TEXT,
  UNIQUE(platform, external_id),
  UNIQUE(canonical_url)
);
CREATE TABLE IF NOT EXISTS post_snapshots (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  observed_at TEXT NOT NULL,
  views INTEGER,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  UNIQUE(post_id, observed_at)
);
CREATE TABLE IF NOT EXISTS crawl_state (
  source TEXT NOT NULL,
  query TEXT NOT NULL,
  cursor TEXT,
  last_success_at TEXT,
  PRIMARY KEY(source, query)
);
CREATE TABLE IF NOT EXISTS crawl_runs (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  query TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
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


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Database:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def init(self) -> None:
        with self.connect() as conn:
            conn.executescript(SCHEMA)

    def account_type(self, platform: str, handle: str | None) -> str:
        if not handle:
            return "organic"
        with self.connect() as conn:
            row = conn.execute(
                "SELECT list_type FROM accounts WHERE platform=? AND lower(handle)=lower(?) AND active=1",
                (platform, handle),
            ).fetchone()
        return row["list_type"] if row else "organic"

    def upsert_account(self, account: dict[str, Any]) -> None:
        with self.connect() as conn:
            conn.execute(
                """INSERT INTO accounts(platform,handle,display_name,list_type,region,source,active,created_at)
                   VALUES(?,?,?,?,?,?,?,?)
                   ON CONFLICT(platform,handle) DO UPDATE SET
                     display_name=excluded.display_name,list_type=excluded.list_type,
                     region=excluded.region,source=excluded.source,active=excluded.active""",
                (
                    account["platform"], account["handle"], account.get("display_name"),
                    account.get("list_type", "organic"), account.get("region"),
                    account.get("source"), int(account.get("active", True)), utcnow(),
                ),
            )

    def upsert_post(self, post: dict[str, Any]) -> str:
        now = utcnow()
        list_type = post.get("list_type") or self.account_type(post["platform"], post.get("author_handle"))
        raw = json.dumps(post.get("raw", {}), ensure_ascii=False, separators=(",", ":"))
        with self.connect() as conn:
            existing = conn.execute(
                "SELECT id FROM posts WHERE platform=? AND external_id=?",
                (post["platform"], str(post["external_id"])),
            ).fetchone()
            conn.execute(
                """INSERT INTO posts(platform,external_id,canonical_url,author_handle,author_name,title,body,
                                      language,region,list_type,sentiment,published_at,first_seen_at,last_seen_at,raw_json)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(platform,external_id) DO UPDATE SET
                     canonical_url=excluded.canonical_url,author_handle=excluded.author_handle,
                     author_name=excluded.author_name,title=excluded.title,body=excluded.body,
                     language=COALESCE(excluded.language,posts.language),
                     region=COALESCE(excluded.region,posts.region),list_type=excluded.list_type,
                     sentiment=excluded.sentiment,published_at=COALESCE(excluded.published_at,posts.published_at),
                     last_seen_at=excluded.last_seen_at,raw_json=excluded.raw_json""",
                (
                    post["platform"], str(post["external_id"]), post["canonical_url"],
                    post.get("author_handle"), post.get("author_name"), post.get("title"),
                    post.get("body"), post.get("language"), post.get("region"), list_type,
                    post.get("sentiment", "neu"), post.get("published_at"), now, now, raw,
                ),
            )
            row = conn.execute(
                "SELECT id FROM posts WHERE platform=? AND external_id=?",
                (post["platform"], str(post["external_id"])),
            ).fetchone()
            stats = post.get("stats") or {}
            if stats:
                conn.execute(
                    """INSERT OR REPLACE INTO post_snapshots
                       (post_id,observed_at,views,likes,comments,shares) VALUES(?,?,?,?,?,?)""",
                    (row["id"], now, stats.get("views"), stats.get("likes"),
                     stats.get("comments"), stats.get("shares")),
                )
        return "updated" if existing else "inserted"

    def get_cursor(self, source: str, query: str) -> str | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT cursor FROM crawl_state WHERE source=? AND query=?", (source, query)
            ).fetchone()
        return row["cursor"] if row else None

    def set_cursor(self, source: str, query: str, cursor: str | None) -> None:
        with self.connect() as conn:
            conn.execute(
                """INSERT INTO crawl_state(source,query,cursor,last_success_at) VALUES(?,?,?,?)
                   ON CONFLICT(source,query) DO UPDATE SET cursor=excluded.cursor,last_success_at=excluded.last_success_at""",
                (source, query, cursor, utcnow()),
            )

    def summary(self) -> dict[str, Any]:
        with self.connect() as conn:
            total = conn.execute("SELECT count(*) n FROM posts").fetchone()["n"]
            by_platform = [dict(r) for r in conn.execute(
                "SELECT platform, count(*) count FROM posts GROUP BY platform ORDER BY count DESC"
            )]
            by_type = [dict(r) for r in conn.execute(
                "SELECT list_type, count(*) count FROM posts GROUP BY list_type ORDER BY count DESC"
            )]
            last_scan = conn.execute("SELECT max(finished_at) t FROM crawl_runs WHERE status='ok'").fetchone()["t"]
        return {"total_posts": total, "by_platform": by_platform, "by_list_type": by_type, "last_scan": last_scan}

    def posts(self, limit: int = 100, platform: str | None = None) -> list[dict[str, Any]]:
        sql = """SELECT p.*, s.views,s.likes,s.comments,s.shares
                 FROM posts p LEFT JOIN post_snapshots s ON s.id=(
                   SELECT id FROM post_snapshots WHERE post_id=p.id ORDER BY observed_at DESC LIMIT 1)
                 WHERE (? IS NULL OR p.platform=?) ORDER BY COALESCE(p.published_at,p.first_seen_at) DESC LIMIT ?"""
        with self.connect() as conn:
            return [dict(r) for r in conn.execute(sql, (platform, platform, min(limit, 1000)))]
