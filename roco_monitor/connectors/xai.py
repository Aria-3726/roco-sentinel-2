from __future__ import annotations

import json
import re
from typing import Any

from .base import CrawlResult
from ..http import request_json


STATUS_RE = re.compile(r"https?://(?:www\.)?(?:x\.com|twitter\.com)/([^/]+)/status/(\d+)")


def _response_text(payload: dict[str, Any]) -> str:
    chunks: list[str] = []
    for item in payload.get("output", []):
        if item.get("type") != "message":
            continue
        for content in item.get("content", []):
            text = content.get("text")
            if text:
                chunks.append(text)
    return "\n".join(chunks)


def parse_x_posts(text: str) -> list[dict[str, Any]]:
    fenced = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.S | re.I)
    candidate = fenced.group(1) if fenced else text.strip()
    try:
        data = json.loads(candidate)
    except json.JSONDecodeError:
        array = re.search(r"\[.*\]", candidate, re.S)
        if not array:
            return []
        data = json.loads(array.group(0))
    if isinstance(data, dict):
        data = data.get("posts", [])
    if not isinstance(data, list):
        return []

    posts: list[dict[str, Any]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        url = str(item.get("canonical_url") or item.get("url") or "")
        match = STATUS_RE.search(url)
        if not match:
            continue
        stats = item.get("stats") if isinstance(item.get("stats"), dict) else {}
        posts.append({
            "platform": "x",
            "external_id": match.group(2),
            "canonical_url": f"https://x.com/{match.group(1)}/status/{match.group(2)}",
            "author_handle": str(item.get("author_handle") or match.group(1)).lstrip("@"),
            "author_name": item.get("author_name"),
            "title": item.get("title"),
            "body": item.get("body") or item.get("text"),
            "language": item.get("language"),
            "region": item.get("region"),
            "published_at": item.get("published_at"),
            "stats": {
                "views": stats.get("views"), "likes": stats.get("likes"),
                "comments": stats.get("comments"), "shares": stats.get("shares"),
            },
            "raw": item,
        })
    return posts


class XaiConnector:
    name = "x"

    def __init__(self, api_key: str, model: str = "grok-4.6"):
        self.api_key = api_key
        self.model = model

    def enabled(self) -> bool:
        return bool(self.api_key)

    def search(self, query: str, from_date: str, to_date: str) -> CrawlResult:
        prompt = f"""Search X thoroughly for posts that genuinely mention the exact game keyword {query!r}.
Run multiple keyword and semantic searches so that small accounts, replies, quote posts, and posts in
English, Japanese, German, French, Spanish, Italian, and Portuguese are represented. Only include posts
published from {from_date} through {to_date}. Exclude unrelated uses, duplicates, and invented URLs.
Return up to 100 distinct results as ONLY a JSON array. Each item must contain canonical_url, author_handle, author_name,
body, published_at (ISO 8601), language, region, and stats with views/likes/comments/shares.
Every canonical_url must be a real x.com/<handle>/status/<numeric_id> URL found by X Search."""
        payload = request_json(
            "https://api.x.ai/v1/responses",
            method="POST",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json_body={
                "model": self.model,
                "input": prompt,
                "tools": [{"type": "x_search", "from_date": from_date, "to_date": to_date}],
            },
            timeout=120,
        )
        return CrawlResult(posts=parse_x_posts(_response_text(payload)))

    def search_accounts(self, accounts: list[dict[str, Any]], from_date: str, to_date: str) -> CrawlResult:
        handles = [str(item.get("handle") or "").strip().lstrip("@") for item in accounts]
        handles = [handle for handle in handles if handle][:50]
        account_by_handle = {str(item.get("handle") or "").strip().lstrip("@").lower(): item for item in accounts}
        prompt = f"""For every named X account below, search its posts published from {from_date} through {to_date}:
{', '.join('@' + handle for handle in handles)}.
Return posts related to the Roco Kingdom / ロコキングダム campaign, including announcement, trailer,
quote-post, reply, artwork, or sponsored deliverable posts even when the exact game name is absent.
Use separate from:<handle> searches as needed. Return only a JSON array with real
x.com/<handle>/status/<numeric_id> canonical URLs, author_handle, author_name, body, published_at ISO 8601,
language, region, and public stats. Do not invent URLs, dates, or metrics."""
        payload = request_json(
            "https://api.x.ai/v1/responses", method="POST",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json_body={
                "model": self.model, "input": prompt,
                "tools": [{"type": "x_search", "from_date": from_date, "to_date": to_date}],
            }, timeout=120,
        )
        posts = []
        for post in parse_x_posts(_response_text(payload)):
            account = account_by_handle.get(str(post.get("author_handle") or "").lower())
            if not account:
                continue
            post["list_type"] = account.get("list_type")
            post["region"] = post.get("region") or account.get("region")
            post["raw"]["discovery"] = "x_roster_search"
            post["raw"]["account_id"] = account.get("id")
            posts.append(post)
        return CrawlResult(
            posts=posts,
            account_updates=[{"id": account["id"], "status": "ok", "error": None} for account in accounts],
        )
