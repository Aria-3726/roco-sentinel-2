from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from roco_monitor.postgres import PostgresDatabase
from roco_monitor.serverless import dumps


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        query = parse_qs(urlparse(self.path).query)
        try:
            limit = int(query.get("limit", ["100"])[0])
        except ValueError:
            limit = 100
        platform = query.get("platform", [None])[0]
        try:
            posts = PostgresDatabase().posts(limit=limit, platform=platform)
            payload, status = {"count": len(posts), "posts": posts}, 200
        except Exception as exc:
            payload, status = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}, 500
        body = dumps(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "s-maxage=30, stale-while-revalidate=60")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
