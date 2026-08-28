from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .base import CrawlResult
from ..http import request_json


FIELDS = (
    "id,video_description,create_time,region_code,share_count,view_count,"
    "like_count,comment_count,username,hashtag_names"
)


def _chunks(items: list[Any], size: int) -> list[list[Any]]:
    return [items[index:index + size] for index in range(0, len(items), size)]


class TikTokResearchConnector:
    name = "tiktok_research"

    def __init__(self, client_key: str = "", client_secret: str = "", access_token: str = ""):
        self.client_key = client_key
        self.client_secret = client_secret
        self.access_token = access_token

    def enabled(self) -> bool:
        return bool(self.access_token or (self.client_key and self.client_secret))

    def _token(self) -> str:
        if self.access_token:
            return self.access_token
        data = request_json(
            "https://open.tiktokapis.com/v2/oauth/token/", method="POST",
            form={
                "client_key": self.client_key, "client_secret": self.client_secret,
                "grant_type": "client_credentials",
            },
        )
        token = data.get("access_token")
        if not token:
            raise RuntimeError(data.get("error_description") or data.get("error") or "TikTok token unavailable")
        self.access_token = str(token)
        return self.access_token

    def search_accounts(self, accounts: list[dict[str, Any]], from_date: str, to_date: str) -> CrawlResult:
        token = self._token()
        account_by_handle = {
            str(account.get("handle") or "").strip().lstrip("@").lower(): account
            for account in accounts if account.get("handle")
        }
        posts: list[dict[str, Any]] = []
        for handles in _chunks(list(account_by_handle), 50):
            cursor = 0
            search_id = None
            for _ in range(10):
                body: dict[str, Any] = {
                    "query": {"and": [{
                        "operation": "IN", "field_name": "username", "field_values": handles,
                    }]},
                    "max_count": 100, "cursor": cursor,
                    "start_date": from_date.replace("-", ""), "end_date": to_date.replace("-", ""),
                    "is_random": False,
                }
                if search_id:
                    body["search_id"] = search_id
                payload = request_json(
                    f"https://open.tiktokapis.com/v2/research/video/query/?fields={FIELDS}",
                    method="POST", headers={"Authorization": f"Bearer {token}"}, json_body=body,
                    timeout=120,
                )
                error = payload.get("error") or {}
                if error.get("code") not in {None, "", "ok"}:
                    raise RuntimeError(error.get("message") or error.get("code"))
                data = payload.get("data") or {}
                for item in data.get("videos", []):
                    username = str(item.get("username") or "").strip().lstrip("@")
                    account = account_by_handle.get(username.lower())
                    if not account or not item.get("id"):
                        continue
                    timestamp = item.get("create_time")
                    published_at = None
                    if timestamp is not None:
                        published_at = datetime.fromtimestamp(int(timestamp), tz=timezone.utc).isoformat()
                    video_id = str(item["id"])
                    posts.append({
                        "platform": "tiktok", "external_id": video_id,
                        "canonical_url": f"https://www.tiktok.com/@{username}/video/{video_id}",
                        "author_handle": username, "author_name": account.get("display_name"),
                        "title": item.get("video_description"), "body": item.get("video_description"),
                        "published_at": published_at, "region": item.get("region_code") or account.get("region"),
                        "list_type": account.get("list_type"),
                        "stats": {
                            "views": item.get("view_count"), "likes": item.get("like_count"),
                            "comments": item.get("comment_count"), "shares": item.get("share_count"),
                        },
                        "raw": {"discovery": "tiktok_research_roster", **item},
                    })
                if not data.get("has_more"):
                    break
                cursor = int(data.get("cursor") or 0)
                search_id = data.get("search_id")
        return CrawlResult(
            posts=posts,
            cursor=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            account_updates=[{"id": account["id"], "status": "ok", "error": None} for account in accounts],
        )
