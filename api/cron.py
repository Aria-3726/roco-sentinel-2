import hmac
import os
from http.server import BaseHTTPRequestHandler

from roco_monitor.postgres import PostgresDatabase
from roco_monitor.serverless import dumps, run_collection


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        expected = os.environ.get("CRON_SECRET", "")
        supplied = self.headers.get("Authorization", "")
        if not expected or not hmac.compare_digest(supplied, f"Bearer {expected}"):
            payload, status = {"ok": False, "error": "unauthorized"}, 401
        else:
            try:
                db = PostgresDatabase()
                db.init()
                with db.collection_lock() as locked:
                    if not locked:
                        payload, status = {"ok": False, "error": "collection_already_running"}, 409
                    else:
                        payload, status = {"ok": True, **run_collection(db)}, 200
            except Exception as exc:
                payload, status = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}, 500
        body = dumps(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
