import hmac
import json
import os
from http.server import BaseHTTPRequestHandler

from roco_monitor.postgres import PostgresDatabase
from roco_monitor.serverless import dumps


MAX_BODY_BYTES = 3_500_000


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        expected = os.environ.get("ROSTER_IMPORT_SECRET", "")
        supplied = self.headers.get("Authorization", "")
        if not expected or not hmac.compare_digest(supplied, f"Bearer {expected}"):
            return self._send({"ok": False, "error": "unauthorized"}, 401)
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self._send({"ok": False, "error": "invalid_content_length"}, 400)
        if length <= 0 or length > MAX_BODY_BYTES:
            return self._send({"ok": False, "error": "invalid_body_size"}, 413)
        try:
            bundle = json.loads(self.rfile.read(length))
            db = PostgresDatabase()
            db.init()
            result = db.import_roster_bundle_once(bundle)
            return self._send(result, 200 if result.get("ok") else 409)
        except Exception as exc:
            return self._send({"ok": False, "error": f"{type(exc).__name__}: {exc}"}, 500)

    def _send(self, payload, status):
        body = dumps(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
