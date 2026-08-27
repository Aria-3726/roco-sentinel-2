from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from .db import Database


def handler_for(db: Database):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, payload, status=200):
            body = json.dumps(payload, ensure_ascii=False, default=str).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "http://localhost:5173")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            parsed = urlparse(self.path)
            query = parse_qs(parsed.query)
            if parsed.path == "/health":
                return self._send({"status": "ok"})
            if parsed.path == "/api/summary":
                return self._send(db.summary())
            if parsed.path == "/api/posts":
                return self._send(db.posts(int(query.get("limit", [100])[0]), query.get("platform", [None])[0]))
            return self._send({"error": "not found"}, 404)

        def log_message(self, format, *args):
            return

    return Handler


def serve(db: Database, host: str = "127.0.0.1", port: int = 8787) -> None:
    server = ThreadingHTTPServer((host, port), handler_for(db))
    print(f"Roco Sentinel API listening on http://{host}:{port}")
    server.serve_forever()
