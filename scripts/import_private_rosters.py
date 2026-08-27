from __future__ import annotations

import argparse
import json
from pathlib import Path

from roco_monitor.postgres import PostgresDatabase


def main() -> None:
    parser = argparse.ArgumentParser(description="Import a private roster bundle into Neon Postgres.")
    parser.add_argument("path", nargs="?", default="data/private/rosters.json")
    args = parser.parse_args()
    path = Path(args.path)
    if not path.exists():
        raise SystemExit(f"Private roster bundle not found: {path}")
    db = PostgresDatabase()
    db.init()
    result = db.import_roster_bundle(json.loads(path.read_text(encoding="utf-8")))
    print(json.dumps({"ok": True, **result}, ensure_ascii=False))


if __name__ == "__main__":
    main()
