from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def load_dotenv(path: str | Path = ".env") -> None:
    """Small, dependency-free .env loader; existing environment wins."""
    file = Path(path)
    if not file.exists():
        return
    for raw in file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _csv(name: str, default: str = "") -> tuple[str, ...]:
    return tuple(x.strip() for x in os.getenv(name, default).split(",") if x.strip())


@dataclass(frozen=True)
class Settings:
    database_path: Path
    keywords: tuple[str, ...]
    regions: tuple[str, ...]
    youtube_api_key: str
    x_bearer_token: str
    reddit_client_id: str
    reddit_client_secret: str
    reddit_user_agent: str
    rss_feeds: tuple[str, ...]

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv()
        return cls(
            database_path=Path(os.getenv("ROCO_DATABASE_PATH", "data/roco_sentinel.db")),
            keywords=_csv("ROCO_KEYWORDS", "Roco Kingdom,ロコキングダム"),
            regions=_csv("ROCO_REGIONS", "US,GB,DE,FR,ES,IT,JP"),
            youtube_api_key=os.getenv("YOUTUBE_API_KEY", ""),
            x_bearer_token=os.getenv("X_BEARER_TOKEN", ""),
            reddit_client_id=os.getenv("REDDIT_CLIENT_ID", ""),
            reddit_client_secret=os.getenv("REDDIT_CLIENT_SECRET", ""),
            reddit_user_agent=os.getenv("REDDIT_USER_AGENT", "roco-sentinel/3.0"),
            rss_feeds=_csv("ROCO_RSS_FEEDS"),
        )
