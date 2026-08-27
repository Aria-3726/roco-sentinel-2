from __future__ import annotations

import argparse
import json

from .api import serve
from .config import Settings
from .db import Database
from .exporter import export_frontend
from .importers import import_accounts, import_posts
from .service import Monitor


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="roco-monitor", description="Incremental Roco Kingdom launch monitor")
    sub = root.add_subparsers(dest="command", required=True)
    sub.add_parser("init")
    crawl = sub.add_parser("crawl")
    crawl.add_argument("--source", action="append", choices=["youtube", "x", "reddit", "rss"])
    accounts = sub.add_parser("import-accounts")
    accounts.add_argument("csv")
    posts = sub.add_parser("import-posts")
    posts.add_argument("csv")
    export = sub.add_parser("export")
    export.add_argument("--output", default="src/data/v3.json")
    api = sub.add_parser("serve")
    api.add_argument("--host", default="127.0.0.1")
    api.add_argument("--port", default=8787, type=int)
    sub.add_parser("summary")
    return root


def main(argv=None) -> int:
    args = parser().parse_args(argv)
    settings = Settings.from_env()
    db = Database(settings.database_path)
    db.init()
    if args.command == "init":
        print(f"initialized {db.path}")
    elif args.command == "crawl":
        print(json.dumps([x.__dict__ for x in Monitor(settings, db).crawl(args.source)], ensure_ascii=False, indent=2))
    elif args.command == "import-accounts":
        print(f"imported {import_accounts(db, args.csv)} accounts")
    elif args.command == "import-posts":
        print(f"imported {import_posts(db, args.csv)} posts")
    elif args.command == "export":
        export_frontend(db, args.output)
        print(f"exported {args.output}")
    elif args.command == "serve":
        serve(db, args.host, args.port)
    elif args.command == "summary":
        print(json.dumps(db.summary(), ensure_ascii=False, indent=2))
    return 0
