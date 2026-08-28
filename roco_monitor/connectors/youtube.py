from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

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

    def _resolve_channel(self, account: dict[str, Any]) -> dict[str, str] | None:
        channel_id = str(account.get("platform_account_id") or "").strip()
        params: dict[str, Any] = {
            "part": "snippet,contentDetails", "key": self.api_key,
        }
        if channel_id.startswith("UC"):
            params["id"] = channel_id
        else:
            url = str(account.get("canonical_url") or "")
            parts = urlparse(url).path.split("/") if url else []
            parts = [part for part in parts if part]
            if "channel" in parts:
                index = parts.index("channel")
                if index + 1 < len(parts) and parts[index + 1].startswith("UC"):
                    params["id"] = parts[index + 1]
            if len(params) == 2:
                handle = str(account.get("handle") or "").strip().lstrip("@")
                if parts and parts[0].startswith("@"):
                    handle = parts[0][1:]
                if not handle:
                    return None
                params["forHandle"] = handle
        data = request_json("https://www.googleapis.com/youtube/v3/channels", params=params)
        items = data.get("items", [])
        if not items:
            return None
        item = items[0]
        uploads = item.get("contentDetails", {}).get("relatedPlaylists", {}).get("uploads")
        if not uploads:
            return None
        return {
            "channel_id": item["id"], "uploads_playlist_id": uploads,
            "channel_title": item.get("snippet", {}).get("title") or account.get("display_name") or "",
        }

    def search_accounts(self, accounts: list[dict[str, Any]], published_after: str) -> CrawlResult:
        """Fetch recent uploads directly from named roster channels.

        This avoids keyword dependence: a roster video is collected even when its
        title or description does not contain the game name.
        """
        cutoff = datetime.fromisoformat(published_after.replace("Z", "+00:00"))
        posts: list[dict[str, Any]] = []
        updates: list[dict[str, Any]] = []
        for account in accounts:
            try:
                resolved = self._resolve_channel(account)
                if not resolved:
                    updates.append({"id": account["id"], "status": "unresolved", "error": "channel_not_found"})
                    continue
                data = request_json(
                    "https://www.googleapis.com/youtube/v3/playlistItems",
                    params={
                        "part": "snippet,contentDetails", "playlistId": resolved["uploads_playlist_id"],
                        "maxResults": 50, "key": self.api_key,
                    },
                )
                account_items = []
                for item in data.get("items", []):
                    content = item.get("contentDetails", {})
                    snippet = item.get("snippet", {})
                    published = content.get("videoPublishedAt") or snippet.get("publishedAt")
                    if not published:
                        continue
                    timestamp = datetime.fromisoformat(published.replace("Z", "+00:00"))
                    if timestamp < cutoff:
                        continue
                    video_id = content.get("videoId") or snippet.get("resourceId", {}).get("videoId")
                    if video_id:
                        account_items.append((video_id, snippet, published))
                ids = [item[0] for item in account_items]
                stats_by_id: dict[str, dict[str, Any]] = {}
                if ids:
                    stats = request_json(
                        "https://www.googleapis.com/youtube/v3/videos",
                        params={"part": "statistics", "id": ",".join(ids), "key": self.api_key},
                    )
                    stats_by_id = {item["id"]: item.get("statistics", {}) for item in stats.get("items", [])}
                for video_id, snippet, published in account_items:
                    stats = stats_by_id.get(video_id, {})
                    posts.append({
                        "platform": "youtube", "external_id": video_id,
                        "canonical_url": f"https://www.youtube.com/watch?v={video_id}",
                        "author_handle": resolved["channel_id"], "author_name": resolved["channel_title"],
                        "title": snippet.get("title"), "body": snippet.get("description"),
                        "published_at": published, "region": account.get("region"),
                        "list_type": account.get("list_type"),
                        "stats": {
                            "views": int(stats.get("viewCount", 0)), "likes": int(stats.get("likeCount", 0)),
                            "comments": int(stats.get("commentCount", 0)),
                        },
                        "raw": {"discovery": "youtube_roster_uploads", "account_id": account["id"]},
                    })
                updates.append({
                    "id": account["id"], "status": "ok", "error": None,
                    "platform_account_id": resolved["channel_id"],
                    "uploads_playlist_id": resolved["uploads_playlist_id"],
                })
            except Exception as exc:
                updates.append({"id": account["id"], "status": "error", "error": f"{type(exc).__name__}: {exc}"[:500]})
        return CrawlResult(
            posts=posts, cursor=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            account_updates=updates,
        )
