from __future__ import annotations

import csv
import hashlib
from pathlib import Path

from .db import Database


ACCOUNT_FIELDS = {"platform", "handle", "display_name", "list_type", "region", "source", "active"}


def import_accounts(db: Database, path: str | Path) -> int:
    count = 0
    with Path(path).open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            clean = {k: v.strip() for k, v in row.items() if k in ACCOUNT_FIELDS and v is not None}
            if not clean.get("platform") or not clean.get("handle"):
                continue
            clean["active"] = clean.get("active", "true").lower() not in {"0", "false", "no"}
            db.upsert_account(clean)
            count += 1
    return count


def import_posts(db: Database, path: str | Path) -> int:
    """Compliance bridge for exports from approved vendors or manual review."""
    count = 0
    with Path(path).open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            url = row.get("canonical_url", "").strip()
            platform = row.get("platform", "").strip()
            if not url or not platform:
                continue
            external_id = row.get("external_id", "").strip() or hashlib.sha256(url.encode()).hexdigest()[:24]
            db.upsert_post({
                "platform": platform, "external_id": external_id, "canonical_url": url,
                "author_handle": row.get("author_handle"), "author_name": row.get("author_name"),
                "title": row.get("title"), "body": row.get("body"), "published_at": row.get("published_at"),
                "language": row.get("language"), "region": row.get("region"),
                "list_type": row.get("list_type") or None, "raw": {"import": str(path)},
            })
            count += 1
    return count
