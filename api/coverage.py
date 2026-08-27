from http.server import BaseHTTPRequestHandler

from roco_monitor.postgres import PostgresDatabase
from roco_monitor.serverless import dumps


SOURCE_META = {
    "youtube": {"label": "YouTube", "method": "官方 Data API", "coverage": "每关键词最多3页/150条；按最近时间增量", "level": "高"},
    "x": {"label": "X", "method": "xAI X Search", "coverage": "多轮关键词与语义发现；不是全量 firehose", "level": "中"},
    "tiktok_web": {"label": "TikTok", "method": "xAI Web Search 公开索引", "coverage": "仅覆盖可被搜索引擎索引的视频；Research API待申请", "level": "低"},
    "reddit_web": {"label": "Reddit", "method": "xAI Web Search 公开索引", "coverage": "公开网页发现；官方 Reddit API待配置", "level": "中低"},
    "open_web": {"label": "媒体/平台/公开网页", "method": "xAI Web Search", "coverage": "新闻、商店及公开页面发现；长尾网页可能遗漏", "level": "中"},
}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            db = PostgresDatabase()
            live = db.coverage()
            latest = {item["source"]: item for item in live["latest_runs"]}
            sources = [{**meta, "source": source, "latest_run": latest.get(source)} for source, meta in SOURCE_META.items()]
            payload, status = {**live, "sources": sources, "archive_excluded": True}, 200
        except Exception as exc:
            payload, status = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}, 500
        body = dumps(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "s-maxage=30, stale-while-revalidate=60")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
