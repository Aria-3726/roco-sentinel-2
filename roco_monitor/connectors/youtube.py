from __future__ import annotations

from datetime import datetime, timezone

from .base import CrawlResult
from ..http import request_json


class YouTubeConnector:
    name = "youtube"

    def __init__(self, api_key: str):
        self.api_key = api_key

    def enabled(self) -> bool:
        return bool(self.api_key)

    def search(self, query: str, cursor: str | None = None) -> CrawlResult:
        params = {
            "part": "snippet", "type": "video", "order": "date", "maxResults": 50,
            "q": query, "key": self.api_key,
        }
        # Daily jobs always start from the newest result. The cursor is an ISO
        # timestamp (with an overlap supplied by the caller), not a page token.
        if cursor and "T" in cursor:
            params["publishedAfter"] = cursor.replace("+00:00", "Z")
        data = request_json("https://www.googleapis.com/youtube/v3/search", params=params)
        ids = [x["id"]["videoId"] for x in data.get("items", [])]
        stats_by_id = {}
        if ids:
            stats = request_json(
                "https://www.googleapis.com/youtube/v3/videos",
                params={"part": "statistics", "id": ",".join(ids), "key": self.api_key},
            )
            stats_by_id = {x["id"]: x.get("statistics", {}) for x in stats.get("items", [])}
        posts = []
        for item in data.get("items", []):
            video_id = item["id"]["videoId"]
            snippet = item["snippet"]
            stats = stats_by_id.get(video_id, {})
            posts.append({
                "platform": "youtube", "external_id": video_id,
                "canonical_url": f"https://www.youtube.com/watch?v={video_id}",
                "author_handle": snippet.get("channelId"), "author_name": snippet.get("channelTitle"),
                "title": snippet.get("title"), "body": snippet.get("description"),
                "published_at": snippet.get("publishedAt"),
                "stats": {"views": int(stats.get("viewCount", 0)), "likes": int(stats.get("likeCount", 0)),
                          "comments": int(stats.get("commentCount", 0))},
                "raw": item,
            })
        return CrawlResult(
            posts=posts,
            cursor=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        )
