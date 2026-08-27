from __future__ import annotations

from datetime import datetime, timezone

from .base import CrawlResult
from ..http import request_json


class RedditConnector:
    name = "reddit"

    def __init__(self, client_id: str, client_secret: str, user_agent: str):
        self.client_id = client_id
        self.client_secret = client_secret
        self.user_agent = user_agent

    def enabled(self) -> bool:
        return bool(self.client_id and self.client_secret)

    def _token(self) -> str:
        data = request_json(
            "https://www.reddit.com/api/v1/access_token", method="POST",
            form={"grant_type": "client_credentials"}, basic_auth=(self.client_id, self.client_secret),
            headers={"User-Agent": self.user_agent},
        )
        return data["access_token"]

    def search(self, query: str, cursor: str | None = None) -> CrawlResult:
        token = self._token()
        params = {"q": f'"{query}"', "sort": "new", "limit": 100, "type": "link", "raw_json": 1}
        if cursor:
            params["after"] = cursor
        data = request_json(
            "https://oauth.reddit.com/search", params=params,
            headers={"Authorization": f"Bearer {token}", "User-Agent": self.user_agent},
        )["data"]
        posts = []
        for child in data.get("children", []):
            item = child["data"]
            posts.append({
                "platform": "reddit", "external_id": item["name"],
                "canonical_url": "https://www.reddit.com" + item["permalink"],
                "author_handle": item.get("author"), "title": item.get("title"), "body": item.get("selftext"),
                "published_at": datetime.fromtimestamp(item["created_utc"], timezone.utc).isoformat(),
                "stats": {"likes": item.get("score"), "comments": item.get("num_comments")},
                "raw": item,
            })
        return CrawlResult(posts=posts, cursor=data.get("after"))
