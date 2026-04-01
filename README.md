# 🛡️ Roco Sentinel v2

**洛克王国：世界 (Roco Kingdom: World)** 海外舆情监控面板。

> 📊 **线上面板**: [roco-sentinel-2.vercel.app](https://roco-sentinel-2.vercel.app/)

## 架构

```
WorkBuddy Skill (每日自动扫描)
        ↓
┌──────────────────────────────────────────────┐
│  Phase 1:   准备 (git pull + 加载已有数据)       │
│  Phase 2:   web_search × 6 轮 (媒体报道)        │
│  Phase 2b:  Tavily API × 6 轮 (社交平台定向)     │
│  Phase 2c:  YouTube Data API × 5 组 (视频搜索)   │
│  Phase 2d:  Grok x_search × 2 轮 (X 推文核心)   │
│  Phase 2e:  Grok 多语种 × 6 轮 (韩/繁中/德/法...)│
│  Phase 3:   web_fetch 深度抓取 (日期/作者/语种)   │
│  Phase 4:   AI 结构化分析 (情绪/摘要/分类)        │
│  Phase 5:   确定性后处理校验 (Snowflake/域名/去重) │
│  Phase 6:   数据合并 (新旧帖子 merge)             │
│  Phase 6b:  议题智能分析 (全量聚类 + 趋势判断)    │
│  Phase 6c:  数据补充 (播放量/订阅数/互动量)       │
│  Phase 7:   git push → Vercel 自动部署           │
│  Phase 8b:  企微推送 (先预览 → 超时自动放行)      │
└──────────────────────────────────────────────┘
        ↓  生成 JSON 数据
  src/data/posts.json   — 帖子数据 (追加模式)
  src/data/issues.json  — 核心议题 (覆盖模式)
  src/data/meta.json    — 扫描元数据
        ↓  git push → Vercel 自动部署
  纯静态站 (所有人看到同一份数据)
```

## 数据源

| 数据源 | 覆盖平台 | 方式 | 费用 |
|--------|---------|------|------|
| `web_search` | 游戏媒体、新闻站 | 关键词搜索 × 6 轮 | 免费 |
| `Tavily API` | Reddit、Instagram、Facebook 等 | 社交媒体定向搜索 × 6 轮 | ~$0.01/次 |
| `YouTube Data API` | YouTube | 视频搜索 + 频道/日期精确提取 | 免费配额 |
| **`Grok x_search`** | **X/Twitter** | xAI API 直接搜索 X 平台内容 | ~$0.65/次 |
| `web_fetch` | 所有 | 逐页抓取提取作者/日期/语种 | 免费 |

### 为什么需要 Grok x_search？

`web_search` 对 X/Twitter 的索引极弱，几乎无法搜到任何推文。Grok API 的 `x_search` 工具可以直接搜索 X 平台的实时内容，单次 2 轮搜索即可获取 ~20 条真实推文。

## 脚本清单

| 脚本 | 功能 | API Key |
|------|------|---------|
| `grok_x_search.py` | X/Twitter 推文搜索 | XAI_API_KEY |
| `tavily_search.py` | 社交媒体多轮搜索 | TAVILY_API_KEY |
| `youtube_search.py` | YouTube 视频搜索 | YOUTUBE_API_KEY |
| `post_process.py` | 后处理校验 (Snowflake 解码/域名语言/日期校验) | — |
| `merge_data.py` | 新旧数据合并 + meta 更新 | — |
| `enrich_stats.py` | YouTube 播放量/点赞 + Reddit 互动补充 | YOUTUBE_API_KEY |
| `enrich_authors.py` | 频道订阅数/版块成员数/高频博主标记 | YOUTUBE_API_KEY |
| `wecom_notify.py` | 企微群推送 (支持预览/超时放行/取消) | — |
| `env_loader.py` | .env 文件加载器 (所有脚本自动引用) | — |

所有 API Key 统一存储在 `~/.workbuddy/skills/roco-sentinel/.env`，由 `env_loader.py` 自动加载。

## 企微推送

每日自动扫描后推送到企业微信群，分三条消息：

1. **📊 扫描概览** — 总帖子/新增/情绪分布/语种分布
2. **🚨 核心议题** — 按热度排序，上升优先、下降排后
3. **🆕 新增帖子** — 平台 emoji + 博主名 + 摘要 + 链接

### 超时自动放行机制

```
12:00  扫描完成
  ↓
  📱 个人企微收到预览 (带⚡标识)
  ↓
  ⏳ 等待 5 分钟
  ↓
  无取消 → ✅ 自动推群
  收到取消 → 🚫 跳过群推送
```

取消/操作命令：
```bash
python3 scripts/wecom_notify.py cancel    # 取消推群
python3 scripts/wecom_notify.py release   # 立即放行
python3 scripts/wecom_notify.py check     # 查看 gate 状态
```

## 与 v1 的区别

| | v1 | v2 |
|---|---|---|
| 数据生成 | Vercel Serverless (Tavily + DeepSeek) | WorkBuddy Skill (多源采集) |
| 数据存储 | localStorage (每人不同) | GitHub JSON (所有人一致) |
| X/Twitter | ❌ 无法获取 | ✅ Grok x_search |
| YouTube 数据 | ❌ 无播放量 | ✅ 播放量/订阅数/点赞 |
| Reddit 数据 | ❌ 无互动量 | ✅ 评论数/版块成员数 |
| 部署方式 | 前端 + API function | 纯静态站 |
| 需要 API Key | ✅ (前端配置) | ❌ 零配置查看 |
| 定时扫描 | ❌ | ✅ WorkBuddy Automation |
| 企微推送 | ❌ | ✅ 超时自动放行 + 预览审批 |

## 更新数据

在 WorkBuddy 中说：
```
扫描洛克王国舆情
```

Skill 会自动执行完整流程：多源搜索 → AI 分析 → 后处理校验 → 数据补充 → 合并数据 → git push → Vercel 自动部署。

## 本地开发

```bash
npm install
npm run dev
```

## 技术栈

- **前端**: React 18 + Vite + Recharts
- **数据采集**: WorkBuddy Skill + Grok API + Tavily + YouTube API
- **后处理**: Python 脚本 (Snowflake 解码、域名语言映射、URL 去重、互动数据补充)
- **部署**: Vercel (静态) + GitHub (数据推送)
- **通知**: 企业微信 Webhook 群机器人 (超时自动放行)
