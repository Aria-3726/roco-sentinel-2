from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class CrawlResult:
    posts: list[dict[str, Any]] = field(default_factory=list)
    cursor: str | None = None
    account_updates: list[dict[str, Any]] = field(default_factory=list)


class Connector(Protocol):
    name: str

    def enabled(self) -> bool: ...
    def search(self, query: str, cursor: str | None = None) -> CrawlResult: ...
