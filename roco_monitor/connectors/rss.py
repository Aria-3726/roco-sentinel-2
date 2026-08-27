from __future__ import annotations

import hashlib
import urllib.request
import xml.etree.ElementTree as ET

from .base import CrawlResult


class RssConnector:
    name = "rss"

    def __init__(self, feeds: tuple[str, ...]):
        self.feeds = feeds

    def enabled(self) -> bool:
        return bool(self.feeds)

    def search(self, query: str, cursor: str | None = None) -> CrawlResult:
        posts = []
        needle = query.casefold()
        for feed in self.feeds:
            req = urllib.request.Request(feed, headers={"User-Agent": "RocoSentinel/3.0"})
            with urllib.request.urlopen(req, timeout=30) as response:
                root = ET.fromstring(response.read())
            for item in root.findall(".//item"):
                title = item.findtext("title") or ""
                body = item.findtext("description") or ""
                if needle not in f"{title} {body}".casefold():
                    continue
                url = item.findtext("link") or item.findtext("guid") or ""
                external_id = hashlib.sha256(url.encode()).hexdigest()[:24]
                posts.append({
                    "platform": "media", "external_id": external_id, "canonical_url": url,
                    "title": title, "body": body, "published_at": item.findtext("pubDate"),
                    "raw": {"feed": feed},
                })
        return CrawlResult(posts=posts, cursor=None)
