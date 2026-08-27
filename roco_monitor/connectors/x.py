from __future__ import annotations

from .base import CrawlResult
from ..http import request_json


class XConnector:
    name = "x"

    def __init__(self, bearer_token: str):
        self.bearer_token = bearer_token

    def enabled(self) -> bool:
        return bool(self.bearer_token)

    def search(self, query: str, cursor: str | None = None) -> CrawlResult:
        params = {
            "query": f'"{query}" -is:retweet', "max_results": 100,
            "tweet.fields": "created_at,lang,public_metrics,author_id",
            "expansions": "author_id", "user.fields": "username,name,location",
        }
        if cursor:
            params["next_token"] = cursor
        data = request_json(
            "https://api.x.com/2/tweets/search/recent", params=params,
            headers={"Authorization": f"Bearer {self.bearer_token}"},
        )
        users = {u["id"]: u for u in data.get("includes", {}).get("users", [])}
        posts = []
        for item in data.get("data", []):
            user = users.get(item.get("author_id"), {})
            metrics = item.get("public_metrics", {})
            username = user.get("username")
            posts.append({
                "platform": "x", "external_id": item["id"],
                "canonical_url": f"https://x.com/{username or 'i'}/status/{item['id']}",
                "author_handle": username, "author_name": user.get("name"),
                "body": item.get("text"), "language": item.get("lang"),
                "published_at": item.get("created_at"),
                "stats": {"likes": metrics.get("like_count"), "comments": metrics.get("reply_count"),
                          "shares": metrics.get("retweet_count")},
                "raw": item,
            })
        return CrawlResult(posts=posts, cursor=data.get("meta", {}).get("next_token"))
