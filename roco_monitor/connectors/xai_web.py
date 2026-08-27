from __future__ import annotations

import hashlib
import json
import re
from typing import Any
from urllib.parse import urlparse

from .base import CrawlResult
from .xai import _response_text
from ..http import request_json


TIKTOK_RE = re.compile(r"https?://(?:www\.)?tiktok\.com/@([^/?#]+)/video/(\d+)", re.I)
REDDIT_RE = re.compile(r"https?://(?:www\.)?reddit\.com/r/[^/]+/comments/([a-z0-9]+)", re.I)


def parse_web_posts(text: str, expected_platform: str) -> list[dict[str, Any]]:
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
        data = data.get("posts") or data.get("results") or []
    if not isinstance(data, list):
        return []

    posts = []
    for item in data:
        if not isinstance(item, dict):
            continue
        url = str(item.get("canonical_url") or item.get("url") or "").strip()
        try:
            parsed = urlparse(url)
        except ValueError:
            continue
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            continue
        platform = expected_platform
        external_id = ""
        author_handle = str(item.get("author_handle") or "").lstrip("@") or None
        if expected_platform == "tiktok":
            match = TIKTOK_RE.match(url)
            if not match:
                continue
            author_handle, external_id = match.groups()
            url = f"https://www.tiktok.com/@{author_handle}/video/{external_id}"
        elif expected_platform == "reddit":
            match = REDDIT_RE.match(url)
            if not match:
                continue
            external_id = match.group(1)
        else:
            external_id = hashlib.sha256(url.encode()).hexdigest()[:24]
            platform = "media"
        stats = item.get("stats") if isinstance(item.get("stats"), dict) else {}
        posts.append({
            "platform": platform, "external_id": external_id, "canonical_url": url,
            "author_handle": author_handle, "author_name": item.get("author_name") or item.get("source_name"),
            "title": item.get("title"), "body": item.get("body") or item.get("text") or item.get("snippet"),
            "language": item.get("language"), "region": item.get("region"),
            "published_at": item.get("published_at"),
            "stats": {"views": stats.get("views"), "likes": stats.get("likes"),
                      "comments": stats.get("comments"), "shares": stats.get("shares")},
            "raw": {"discovery": "xai_web_search", **item},
        })
    return posts


class XaiWebConnector:
    """Compliant discovery fallback for public pages indexed by web search."""

    def __init__(self, api_key: str, platform: str, model: str = "grok-4.6"):
        self.api_key = api_key
        self.platform = platform
        self.model = model

    def enabled(self) -> bool:
        return bool(self.api_key)

    def search(self, query: str, from_date: str, to_date: str) -> CrawlResult:
        domain = {"tiktok": "tiktok.com", "reddit": "reddit.com"}.get(self.platform)
        target = {"tiktok": "TikTok videos", "reddit": "Reddit posts", "web": "news, media, store, and public web pages"}[self.platform]
        url_rule = {
            "tiktok": "Every URL must be a real https://www.tiktok.com/@<handle>/video/<numeric_id> URL.",
            "reddit": "Every URL must be a real reddit.com/r/<subreddit>/comments/<id>/... post URL.",
            "web": "Every URL must be the direct article, store, or platform page, never a search-results page.",
        }[self.platform]
        prompt = f"""Search the public web thoroughly for {target} that genuinely mention either exact game name
"Roco Kingdom" or "ロコキングダム" and were published from {from_date} through {to_date}.
Search English, Japanese, and European-language results. Exclude unrelated uses and duplicates.
{url_rule} Return up to 100 results as ONLY a JSON array with canonical_url, author_handle,
author_name/source_name, title, body/snippet, published_at ISO 8601, language, region, and public stats when visible.
Do not invent URLs, dates, or metrics; use null when a metric is not visible."""
        tool: dict[str, Any] = {"type": "web_search"}
        if domain:
            tool["filters"] = {"allowed_domains": [domain]}
        payload = request_json(
            "https://api.x.ai/v1/responses", method="POST",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json_body={"model": self.model, "input": prompt, "tools": [tool]}, timeout=120,
        )
        return CrawlResult(posts=parse_web_posts(_response_text(payload), self.platform))
