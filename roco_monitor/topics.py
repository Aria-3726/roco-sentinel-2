from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any


NEGATIVE = re.compile(
    r"\b(copy|clone|rip[ -]?off|plagiari|lawsuit|legal risk|scam|bad|boring|ugly|fake|"
    r"disappoint|concern|worried|problem|issue|hate)\b|パクリ|盗作|訴訟|法務|不安|懸念|"
    r"ひどい|微妙|失望|問題|抄袭|山寨|侵权|担心|失望|问题",
    re.I,
)
POSITIVE = re.compile(
    r"\b(cute|beautiful|excited|love|amazing|awesome|fun|impressed|can't wait|wishlisted)\b|"
    r"かわいい|可愛い|楽しみ|期待|すごい|好き|面白い|喜欢|可爱|期待|惊艳",
    re.I,
)

TOPICS = [
    {
        "id": "ip_similarity", "name": "宝可梦相似度 / IP与法务风险",
        "pattern": r"pok[eé]mon|pokemon|ポケモン|宝可梦|精灵宝可梦|パクリ|抄袭|clone|copy|rip[ -]?off|lawsuit|legal|任天堂|nintendo",
        "positive": "部分讨论认为魔法世界观与原创宠物设计形成了差异化。",
        "negative": "负面内容主要质疑与宝可梦的相似度，以及潜在的版权或法务风险。",
    },
    {
        "id": "visual_creatures", "name": "美术风格 / 宠物设计 / 世界观",
        "pattern": r"art|visual|graphic|creature|monster|pet|design|world.?view|魔法|美术|画面|宠物|精灵|世界观|デザイン|グラフィック|モンスター|ペット|世界観|かわいい|可愛い",
        "positive": "非负面讨论多集中在可爱宠物、美术表现和魔法世界观。",
        "negative": "负面反馈主要涉及设计辨识度、画面完成度或既视感。",
    },
    {
        "id": "gameplay_world", "name": "玩法 / 开放世界 / 探索与建造",
        "pattern": r"gameplay|open world|explor|combat|battle|building|craft|farm|catch|collect|玩法|开放世界|探索|战斗|建造|捕捉|收集|ゲームプレイ|オープンワールド|探索|戦闘|建築|捕獲",
        "positive": "讨论关注开放世界探索、宠物收集、战斗与建造等核心循环。",
        "negative": "负面意见主要担心玩法同质化、系统深度或实际操作手感。",
    },
    {
        "id": "launch_platform", "name": "上线时间 / Steam·主机平台 / 愿望单",
        "pattern": r"release|launch|steam|epic|xbox|playstation|\bps5\b|console|wishlist|上线|发售|平台|愿望单|発売|リリース|スチーム|ウィッシュリスト",
        "positive": "用户主要询问发售时间、可用平台并表达愿望单或关注意向。",
        "negative": "负面反馈多来自平台信息不清晰、地区可用性或等待时间。",
    },
    {
        "id": "test_cologne", "name": "科隆首曝 / 试玩 / 测试资格",
        "pattern": r"gamescom|cologne|playtest|beta|test|demo|signup|register|科隆|试玩|测试|报名|资格|ケルン|試遊|テスト|ベータ|応募",
        "positive": "正向讨论集中在首曝内容、线下试玩体验和测试报名期待。",
        "negative": "负面反馈主要涉及资格、地区限制、流程或信息透明度。",
    },
    {
        "id": "performance", "name": "性能 / 网络 / 稳定性",
        "pattern": r"performance|fps|frame|lag|latency|server|network|disconnect|bug|crash|性能|帧率|延迟|服务器|网络|掉线|崩溃|バグ|ラグ|サーバー|クラッシュ",
        "positive": "非负面内容以技术信息确认和稳定性期待为主。",
        "negative": "负面反馈主要涉及帧率、延迟、服务器或程序稳定性。",
    },
    {
        "id": "monetization", "name": "商业化 / 抽卡 / 价格",
        "pattern": r"gacha|moneti|microtransaction|price|paid|free.?to.?play|抽卡|氪金|付费|价格|免费|ガチャ|課金|価格|基本無料",
        "positive": "讨论主要关注商业模式、是否免费及付费内容边界。",
        "negative": "负面内容担心抽卡、付费强度或商业化影响体验。",
    },
]


def _as_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _sentiment(post: dict[str, Any], text: str) -> str:
    stored = str(post.get("sentiment") or "neu").lower()
    if stored in {"neg", "negative"}:
        return "neg"
    if stored in {"pos", "positive"}:
        return "pos"
    if NEGATIVE.search(text):
        return "neg"
    if POSITIVE.search(text):
        return "pos"
    return "neu"


def build_topics(posts: list[dict[str, Any]], days: int = 7, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=max(1, min(days, 30)))
    recent = []
    for post in posts:
        when = _as_datetime(post.get("published_at")) or _as_datetime(post.get("first_seen_at"))
        if when and when >= cutoff:
            recent.append((post, when))

    buckets = []
    matched_urls: set[str] = set()
    for topic in TOPICS:
        pattern = re.compile(topic["pattern"], re.I)
        matches = []
        for post, when in recent:
            text = " ".join(str(post.get(key) or "") for key in ("title", "body"))
            if pattern.search(text):
                matches.append((post, when, _sentiment(post, text)))
                if post.get("canonical_url"):
                    matched_urls.add(str(post["canonical_url"]))
        if not matches:
            continue
        negative = sum(1 for _, _, sentiment in matches if sentiment == "neg")
        total = len(matches)
        negative_pct = round(negative / total * 100)
        latest = max(when for _, when, _ in matches)
        summary = topic["negative"] if negative_pct >= 35 else topic["positive"]
        if 0 < negative_pct < 35:
            summary = f"{topic['positive']} 少量负面反馈仍需复核。"
        samples = sorted(matches, key=lambda item: item[1], reverse=True)[:3]
        buckets.append({
            "id": topic["id"], "name": topic["name"], "volume": total,
            "negative": negative, "negative_pct": negative_pct,
            "non_negative_pct": 100 - negative_pct, "latest_at": latest,
            "summary": summary,
            "samples": [{"url": post.get("canonical_url"), "author": post.get("author_name") or post.get("author_handle"),
                         "platform": post.get("platform")} for post, _, _ in samples],
        })
    buckets.sort(key=lambda item: (item["latest_at"], item["volume"]), reverse=True)
    return {
        "window_days": days, "generated_at": now, "sample_posts": len(recent),
        "classified_posts": len(matched_urls), "topics": buckets,
        "method": "keyword_topic_and_sentiment_heuristics",
    }
