# 🛡️ Roco Sentinel v2

**洛克王国：世界 (Roco Kingdom: World)** 海外舆情监控面板。

> 📊 **线上面板**: [roco-sentinel-2.vercel.app](https://roco-sentinel-2.vercel.app/)

## 架构

```
WorkBuddy Skill (多源搜索 + AI 分析 + 后处理)
        ↓
┌──────────────────────────────────┐
│  Phase 2:  web_search (媒体报道)   │
│  Phase 2b: Tavily (社交平台补充)    │
│  Phase 2c: YouTube API (视频)     │
│  Phase 2d: Grok x_search (X推文) │ ← 🆕
│  Phase 3:  web_fetch (深度抓取)    │
│  Phase 4:  AI 结构化分析           │
│  Phase 5:  确定性后处理校验         │
└──────────────────────────────────┘
        ↓  生成 JSON 数据
  src/data/posts.json   — 帖子数据 (追加模式)
  src/data/issues.json  — 核心议题 (覆盖模式)
  src/data/meta.json    — 扫描元数据
        ↓  git push → Vercel 自动部署
  纯静态站 (所有人看到同一份数据)
```

## 数据源

| 数据源 | 覆盖平台 | 方式 |
|--------|---------|------|
| `web_search` | 游戏媒体、新闻站 | 关键词搜索 |
| `Tavily API` | Reddit、TikTok 等 | 社交媒体定向搜索 |
| `YouTube Data API` | YouTube | 视频搜索 + 频道/日期精确提取 |
| **`Grok x_search`** | **X/Twitter** | xAI API 直接搜索 X 平台内容 |
| `web_fetch` | 所有 | 逐页抓取提取作者/日期/语种 |

### 为什么需要 Grok x_search？

`web_search` 对 X/Twitter 的索引极弱，几乎无法搜到任何推文。Grok API 的 `x_search` 工具可以直接搜索 X 平台的实时内容，单次 2 轮搜索即可获取 ~20 条真实推文，费用约 $0.37/次。

## 与 v1 的区别

| | v1 | v2 |
|---|---|---|
| 数据生成 | Vercel Serverless (Tavily + DeepSeek) | WorkBuddy Skill (多源采集) |
| 数据存储 | localStorage (每人不同) | GitHub JSON (所有人一致) |
| X/Twitter | ❌ 无法获取 | ✅ Grok x_search |
| 部署方式 | 前端 + API function | 纯静态站 |
| 需要 API Key | ✅ (Tavily + DeepSeek) | ❌ 零配置查看 |
| 定时扫描 | ❌ | ✅ WorkBuddy Automation |
| 企微推送 | ❌ | ✅ Webhook 日报 |

## 更新数据

在 WorkBuddy 中说：
```
扫描洛克王国舆情
```

Skill 会自动执行完整流程：多源搜索 → AI 分析 → 后处理校验 → 合并数据 → git push → Vercel 自动部署。

也可以单独运行 Grok 搜索补充 X 推文：
```bash
XAI_API_KEY=xxx python3 scripts/grok_x_search.py /tmp/results.json
```

## 本地开发

```bash
npm install
npm run dev
```

## 技术栈

- **前端**: React 18 + Vite + Recharts
- **数据采集**: WorkBuddy Skill + Grok API + Tavily + YouTube API
- **后处理**: Python 脚本 (Snowflake 解码、域名语言映射、URL 去重)
- **部署**: Vercel (静态) + GitHub Actions (数据推送)
- **通知**: 企业微信 Webhook 群机器人
