# Roco Sentinel v3 — 增量监测内核

v3 不是“刷网页的爬虫”，而是一个可审计的社媒监测数据模型与采集管道。

```text
官方 API / RSS / 合规供应商 CSV
              ↓
       connector adapters
              ↓
  crawl_state（每来源、每关键词游标）
              ↓
 posts（唯一内容） + post_snapshots（播放/互动时间序列）
              ↓
 KOL / 媒体 / 平台 / KOC / 自然量分类
              ↓
     JSON export 或只读 API
              ↓
        现有 React 看板
```

## 数据边界

- `accounts`：仅保存监测所需的平台账号、分组和地区。联系人、邮箱、报价等不应导入。
- `posts`：以 `(platform, external_id)` 和规范 URL 双重去重。
- `post_snapshots`：重复扫描不会新增帖子，只记录播放量与互动量变化。
- `crawl_state`：每个平台和关键词独立保存下一页游标，避免每次从头抓取。
- `crawl_runs`：记录成功、失败、抓取量和新增量，便于审计覆盖率。

## 平台策略

| 平台 | 默认方式 | 说明 |
|---|---|---|
| YouTube | YouTube Data API | 搜索 + 视频指标，官方接口 |
| X | X API v2 recent search | Bearer Token；受账号套餐与时间窗限制 |
| Reddit | Reddit OAuth API | client credentials，只读搜索 |
| 媒体/网站 | RSS / RSSHub | 低频、可缓存 |
| TikTok / Instagram | 合规供应商导出或人工 CSV | 不绕登录、不做高频浏览器抓取 |

SQLite 适合单机验证；长期实时服务应将同一逻辑迁移到 PostgreSQL，并把 API Key 放在部署平台的 Secret 中。
