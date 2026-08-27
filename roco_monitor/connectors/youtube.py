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

    def search(self, query: str, cursor: str | None = None, max_pages: int = 3) -> CrawlResult:
        base_params = {
            "part": "snippet", "type": "video", "order": "date", "maxResults": 50,
            "q": query, "key": self.api_key,
        }
        # Daily jobs always start from the newest result. The cursor is an ISO
        # timestamp (with an overlap supplied by the caller), not a page token.
        if cursor and "T" in cursor:
            base_params["publishedAfter"] = cursor.replace("+00:00", "Z")
        items = []
        page_token = None
        for _ in range(max(1, min(max_pages, 3))):
            params = {**base_params}
            if page_token:
                params["pageToken"] = page_token
            data = request_json("https://www.googleapis.com/youtube/v3/search", params=params)
            items.extend(data.get("items", []))
            page_token = data.get("nextPageToken")
            if not page_token:
                break
        ids = list(dict.fromkeys(x["id"]["videoId"] for x in items if x.get("id", {}).get("videoId")))
        stats_by_id = {}
        for start in range(0, len(ids), 50):
            batch = ids[start:start + 50]
            stats = request_json(
                "https://www.googleapis.com/youtube/v3/videos",
                params={"part": "statistics", "id": ",".join(batch), "key": self.api_key},
            )
            stats_by_id.update({x["id"]: x.get("statistics", {}) for x in stats.get("items", [])})
        posts = []
        for item in items:
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
