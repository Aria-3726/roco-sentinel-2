from __future__ import annotations

import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from roco_monitor.db import Database
from roco_monitor.importers import import_accounts
from roco_monitor.connectors.xai import parse_x_posts
from roco_monitor.connectors.xai_web import parse_web_posts
from roco_monitor.connectors.tiktok_research import TikTokResearchConnector
from roco_monitor.connectors.youtube import YouTubeConnector
from roco_monitor.topics import build_topics
from datetime import datetime, timezone


class DatabaseTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = Database(Path(self.temp.name) / "test.db")
        self.db.init()

    def tearDown(self):
        self.temp.cleanup()

    def test_deduplicates_and_updates_snapshot(self):
        post = {
            "platform": "youtube", "external_id": "abc", "canonical_url": "https://youtu.be/abc",
            "author_handle": "channel", "title": "Roco Kingdom", "stats": {"views": 10},
        }
        self.assertEqual(self.db.upsert_post(post), "inserted")
        post["stats"] = {"views": 20}
        self.assertEqual(self.db.upsert_post(post), "updated")
        self.assertEqual(self.db.summary()["total_posts"], 1)
        self.assertEqual(self.db.posts()[0]["views"], 20)

    def test_roster_classifies_post(self):
        roster = Path(self.temp.name) / "accounts.csv"
        roster.write_text("platform,handle,list_type\nx,creator,koc\n", encoding="utf-8")
        import_accounts(self.db, roster)
        self.db.upsert_post({
            "platform": "x", "external_id": "1", "canonical_url": "https://x.com/creator/status/1",
            "author_handle": "creator", "body": "ロコキングダム",
        })
        self.assertEqual(self.db.posts()[0]["list_type"], "koc")

    def test_xai_parser_rejects_unverifiable_urls(self):
        text = '''```json
        [{"canonical_url":"https://x.com/creator/status/123","body":"Roco Kingdom"},
         {"canonical_url":"https://example.com/fake","body":"Roco Kingdom"}]
        ```'''
        posts = parse_x_posts(text)
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0]["external_id"], "123")

    def test_web_parser_requires_real_platform_post_urls(self):
        text = '''[{"canonical_url":"https://www.tiktok.com/@creator/video/123","body":"Roco Kingdom"},
                   {"canonical_url":"https://www.tiktok.com/search?q=roco","body":"Roco Kingdom"}]'''
        posts = parse_web_posts(text, "tiktok")
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0]["author_handle"], "creator")

    def test_topics_use_recent_posts_and_report_negative_share(self):
        posts = [
            {"canonical_url":"https://x.com/a/status/1","platform":"x","title":"Roco Kingdom Pokemon clone concern",
             "published_at":"2026-08-27T00:00:00+00:00","sentiment":"neu"},
            {"canonical_url":"https://x.com/b/status/2","platform":"x","title":"Cute creatures, can't wait",
             "published_at":"2026-08-27T01:00:00+00:00","sentiment":"neu"},
            {"canonical_url":"https://x.com/c/status/3","platform":"x","title":"Old Pokemon post",
             "published_at":"2026-05-01T00:00:00+00:00","sentiment":"neg"},
        ]
        result = build_topics(posts, days=7, now=datetime(2026, 8, 28, tzinfo=timezone.utc))
        ip = next(item for item in result["topics"] if item["id"] == "ip_similarity")
        self.assertEqual(ip["volume"], 1)
        self.assertEqual(ip["negative_pct"], 100)

    @patch("roco_monitor.connectors.youtube.request_json")
    def test_youtube_roster_fetch_does_not_require_keyword(self, request):
        request.side_effect = [
            {"items": [{"id": "UC123", "snippet": {"title": "Named creator"},
                        "contentDetails": {"relatedPlaylists": {"uploads": "UU123"}}}]},
            {"items": [{"contentDetails": {"videoId": "video1", "videoPublishedAt": "2026-08-27T10:00:00Z"},
                        "snippet": {"title": "A caption without the game name", "description": "campaign visual"}}]},
            {"items": [{"id": "video1", "statistics": {"viewCount": "12", "likeCount": "3"}}]},
        ]
        result = YouTubeConnector("key").search_accounts([{
            "id": 1, "handle": "creator", "canonical_url": "https://youtube.com/@creator",
            "display_name": "Named creator", "list_type": "paid_kol", "region": "EN",
        }], "2026-08-26T00:00:00+00:00")
        self.assertEqual(len(result.posts), 1)
        self.assertEqual(result.posts[0]["list_type"], "paid_kol")
        self.assertEqual(result.account_updates[0]["platform_account_id"], "UC123")

    @patch("roco_monitor.connectors.tiktok_research.request_json")
    def test_tiktok_research_filters_to_named_accounts(self, request):
        request.return_value = {"data": {"videos": [
            {"id": "123", "username": "creator", "video_description": "campaign", "create_time": 1787800000,
             "view_count": 10, "like_count": 2, "comment_count": 1, "share_count": 0},
            {"id": "456", "username": "other", "video_description": "unrelated", "create_time": 1787800000},
        ], "has_more": False}, "error": {"code": "ok"}}
        result = TikTokResearchConnector(access_token="token").search_accounts([{
            "id": 2, "handle": "creator", "display_name": "Creator", "list_type": "third_party", "region": "US",
        }], "2026-08-26", "2026-08-28")
        self.assertEqual(len(result.posts), 1)
        self.assertEqual(result.posts[0]["canonical_url"], "https://www.tiktok.com/@creator/video/123")
        self.assertEqual(result.posts[0]["list_type"], "third_party")


if __name__ == "__main__":
    unittest.main()
