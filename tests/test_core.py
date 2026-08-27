from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from roco_monitor.db import Database
from roco_monitor.importers import import_accounts
from roco_monitor.connectors.xai import parse_x_posts


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


if __name__ == "__main__":
    unittest.main()
