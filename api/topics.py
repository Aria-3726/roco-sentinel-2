from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from roco_monitor.postgres import PostgresDatabase
from roco_monitor.serverless import dumps
from roco_monitor.topics import build_topics


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        query = parse_qs(urlparse(self.path).query)
        try:
            days = int(query.get("days", ["7"])[0])
        except ValueError:
            days = 7
        try:
            db = PostgresDatabase()
            payload, status = build_topics(db.posts(limit=1000), days=days), 200
        except Exception as exc:
            payload, status = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}, 500
        body = dumps(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "s-maxage=60, stale-while-revalidate=120")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
