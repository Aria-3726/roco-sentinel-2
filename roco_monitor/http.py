from __future__ import annotations

import base64
import json
import urllib.parse
import urllib.request
from typing import Any


def request_json(
    url: str,
    *,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    method: str = "GET",
    form: dict[str, str] | None = None,
    basic_auth: tuple[str, str] | None = None,
    timeout: int = 30,
) -> dict[str, Any]:
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    body = urllib.parse.urlencode(form).encode() if form else None
    merged = {"Accept": "application/json", **(headers or {})}
    if form:
        merged["Content-Type"] = "application/x-www-form-urlencoded"
    if basic_auth:
        token = base64.b64encode(f"{basic_auth[0]}:{basic_auth[1]}".encode()).decode()
        merged["Authorization"] = f"Basic {token}"
    req = urllib.request.Request(url, data=body, headers=merged, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))
