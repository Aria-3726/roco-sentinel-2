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
CREATE TABLE IF NOT EXISTS creators (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  list_type TEXT NOT NULL CHECK(list_type IN ('paid_kol','media','platform','koc','official')),
  region TEXT,
  language TEXT,
  category TEXT,
  priority TEXT,
  content_direction TEXT,
  outreach_status TEXT,
  supplier TEXT,
  notes TEXT,
  contact_name TEXT,
  email TEXT,
  discord_id TEXT,
  creator_hub_id TEXT,
  freelancer_id TEXT,
  gid TEXT,
  nda_status TEXT,
  source_workbook TEXT NOT NULL,
  source_sheet TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS creator_id TEXT REFERENCES creators(id) ON DELETE SET NULL;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS canonical_url TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS followers BIGINT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS avg_views BIGINT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS primary_platform BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS commercial_terms (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  currency TEXT,
  quote_text TEXT,
  quoted_amount NUMERIC,
  firm_offer_text TEXT,
  firm_offer_amount NUMERIC,
  trial_event_quote TEXT,
  video_quote TEXT,
  expected_views BIGINT,
  cpm NUMERIC,
  cpc NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS campaign_deliverables (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  deliverables TEXT,
  status TEXT,
  draft_url TEXT,
  scheduled_at_text TEXT,
  published_url TEXT,
  expected_views BIGINT,
  actual_views BIGINT,
  clicks BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
CREATE INDEX IF NOT EXISTS idx_creators_type_region ON creators(list_type, region);
CREATE INDEX IF NOT EXISTS idx_creators_status ON creators(outreach_status);
CREATE INDEX IF NOT EXISTS idx_accounts_creator ON accounts(creator_id);
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
                    """SELECT list_type FROM accounts WHERE platform=%s AND active=TRUE
                       AND (lower(handle)=lower(%s) OR (%s IS NOT NULL AND lower(display_name)=lower(%s)))
                       ORDER BY CASE list_type WHEN 'official' THEN 1 WHEN 'platform' THEN 2
                                WHEN 'paid_kol' THEN 3 WHEN 'media' THEN 4 WHEN 'koc' THEN 5 ELSE 6 END
                       LIMIT 1""",
                    (post["platform"], post["author_handle"], post.get("author_name"), post.get("author_name")),
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

    def coverage(self) -> dict[str, Any]:
        with self.connect() as conn:
            latest_runs = list(conn.execute(
                """SELECT DISTINCT ON(source) source,query,status,fetched,inserted,updated,
                          started_at,finished_at,error
                   FROM crawl_runs ORDER BY source,started_at DESC"""
            ).fetchall())
            by_platform = list(conn.execute(
                "SELECT platform,count(*) AS count,max(COALESCE(published_at,first_seen_at)) AS latest_at FROM posts GROUP BY platform ORDER BY count DESC"
            ).fetchall())
            recent = conn.execute(
                """SELECT count(*) AS posts_48h,count(DISTINCT platform) AS platforms_48h
                   FROM posts WHERE COALESCE(published_at,first_seen_at) >= now() - interval '48 hours'"""
            ).fetchone()
        return {"latest_runs": latest_runs, "by_platform": by_platform, **recent}

    def import_roster_bundle(self, bundle: dict[str, Any]) -> dict[str, int]:
        """Import private roster data without making commercial/contact fields public."""
        counts = {"creators": 0, "accounts": 0, "commercial_terms": 0, "deliverables": 0}
        with self.connect() as conn:
            for item in bundle.get("creators", []):
                creator = {
                    "region": None, "language": None, "category": None, "priority": None,
                    "content_direction": None, "outreach_status": None, "supplier": None,
                    "notes": None, "contact_name": None, "email": None, "discord_id": None,
                    "creator_hub_id": None, "freelancer_id": None, "gid": None, "nda_status": None,
                    **item,
                }
                conn.execute(
                    """INSERT INTO creators(
                         id,display_name,list_type,region,language,category,priority,content_direction,
                         outreach_status,supplier,notes,contact_name,email,discord_id,creator_hub_id,
                         freelancer_id,gid,nda_status,source_workbook,source_sheet,source_row)
                       VALUES(%(id)s,%(display_name)s,%(list_type)s,%(region)s,%(language)s,%(category)s,
                         %(priority)s,%(content_direction)s,%(outreach_status)s,%(supplier)s,%(notes)s,
                         %(contact_name)s,%(email)s,%(discord_id)s,%(creator_hub_id)s,%(freelancer_id)s,
                         %(gid)s,%(nda_status)s,%(source_workbook)s,%(source_sheet)s,%(source_row)s)
                       ON CONFLICT(id) DO UPDATE SET
                         display_name=excluded.display_name,list_type=excluded.list_type,region=excluded.region,
                         language=excluded.language,category=excluded.category,priority=excluded.priority,
                         content_direction=excluded.content_direction,outreach_status=excluded.outreach_status,
                         supplier=excluded.supplier,notes=excluded.notes,contact_name=excluded.contact_name,
                         email=excluded.email,discord_id=excluded.discord_id,creator_hub_id=excluded.creator_hub_id,
                         freelancer_id=excluded.freelancer_id,gid=excluded.gid,nda_status=excluded.nda_status,
                         updated_at=now()""",
                    creator,
                )
                counts["creators"] += 1
            for item in bundle.get("accounts", []):
                conn.execute(
                    """INSERT INTO accounts(platform,handle,display_name,list_type,region,source,creator_id,
                                              canonical_url,followers,avg_views,primary_platform)
                       SELECT %(platform)s,%(handle)s,%(display_name)s,c.list_type,c.region,'roster_import',%(creator_id)s,
                              %(canonical_url)s,%(followers)s,%(avg_views)s,%(primary_platform)s
                       FROM creators c WHERE c.id=%(creator_id)s
                       ON CONFLICT(platform,handle) DO UPDATE SET
                         display_name=excluded.display_name,
                         list_type=CASE
                           WHEN accounts.list_type IN ('paid_kol','media','platform','official') THEN accounts.list_type
                           ELSE excluded.list_type END,
                         region=COALESCE(excluded.region,accounts.region),
                         creator_id=CASE
                           WHEN accounts.list_type IN ('paid_kol','media','platform','official') THEN accounts.creator_id
                           ELSE excluded.creator_id END,
                         canonical_url=excluded.canonical_url,followers=excluded.followers,
                         avg_views=excluded.avg_views,primary_platform=excluded.primary_platform,active=TRUE""",
                    item,
                )
                counts["accounts"] += 1
            for table, key in (("commercial_terms", "commercial_terms"), ("campaign_deliverables", "deliverables")):
                for item in bundle.get(key, []):
                    columns = list(item)
                    assignments = ",".join(f"{name}=excluded.{name}" for name in columns if name not in {"id", "creator_id"})
                    names = ",".join(columns)
                    placeholders = ",".join(f"%({name})s" for name in columns)
                    conn.execute(
                        f"INSERT INTO {table}({names}) VALUES({placeholders}) ON CONFLICT(id) DO UPDATE SET {assignments},updated_at=now()",
                        item,
                    )
                    counts[key] += 1
            # Reclassify already collected posts after roster accounts become available.
            conn.execute(
                """UPDATE posts p SET list_type=a.list_type,region=COALESCE(p.region,a.region)
                   FROM accounts a WHERE p.platform=a.platform
                     AND (lower(p.author_handle)=lower(a.handle)
                          OR (p.author_name IS NOT NULL AND lower(p.author_name)=lower(a.display_name)))
                     AND a.active=TRUE AND p.list_type='organic'"""
            )
        return counts

    def roster_summary(self) -> dict[str, Any]:
        """Return only safe aggregates. No pricing, contacts, notes, or raw roster rows."""
        with self.connect() as conn:
            total_creators = conn.execute("SELECT count(*) AS n FROM creators").fetchone()["n"]
            total_accounts = conn.execute("SELECT count(*) AS n FROM accounts WHERE creator_id IS NOT NULL").fetchone()["n"]
            by_type = list(conn.execute(
                "SELECT list_type AS name,count(*) AS count FROM creators GROUP BY list_type ORDER BY count DESC"
            ).fetchall())
            by_region = list(conn.execute(
                "SELECT COALESCE(NULLIF(trim(region),''),'未知') AS name,count(*) AS count FROM creators GROUP BY 1 ORDER BY count DESC LIMIT 12"
            ).fetchall())
            by_platform = list(conn.execute(
                "SELECT platform AS name,count(*) AS count FROM accounts WHERE creator_id IS NOT NULL GROUP BY platform ORDER BY count DESC"
            ).fetchall())
            by_status = list(conn.execute(
                "SELECT COALESCE(NULLIF(trim(outreach_status),''),'未填写') AS name,count(*) AS count FROM creators GROUP BY 1 ORDER BY count DESC LIMIT 12"
            ).fetchall())
            published = conn.execute(
                "SELECT count(DISTINCT creator_id) AS n FROM campaign_deliverables WHERE published_url ~ '^https?://'"
            ).fetchone()["n"]
            matched = conn.execute(
                "SELECT count(DISTINCT lower(p.platform || ':' || p.author_handle)) AS n FROM posts p WHERE p.list_type <> 'organic'"
            ).fetchone()["n"]
        return {
            "total_creators": total_creators, "total_accounts": total_accounts,
            "by_list_type": by_type, "by_region": by_region, "by_platform": by_platform,
            "by_status": by_status, "published_creators": published, "matched_accounts": matched,
            "private_fields_excluded": True,
        }

    def posts(self, limit: int = 100, platform: str | None = None) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                """SELECT p.id,p.platform,p.external_id,p.canonical_url,p.author_handle,p.author_name,
                          p.title,p.body,p.language,p.region,p.list_type,p.sentiment,p.published_at,
                          p.first_seen_at,p.last_seen_at,s.views,s.likes,s.comments,s.shares
                   FROM posts p LEFT JOIN LATERAL (
                     SELECT views,likes,comments,shares FROM post_snapshots
                     WHERE post_id=p.id ORDER BY observed_at DESC LIMIT 1
                   ) s ON TRUE
                   WHERE (%s::text IS NULL OR p.platform=%s::text)
                   ORDER BY COALESCE(p.published_at,p.first_seen_at) DESC LIMIT %s""",
                (platform, platform, min(max(limit, 1), 1000)),
            ).fetchall()
        return list(rows)
