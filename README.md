# 🛡️ Roco Sentinel v2

**洛克王国：世界 (Roco Kingdom: World)** 海外舆情监控面板。

## 架构

```
WorkBuddy Skill (搜索+分析+后处理)
        ↓  生成 JSON 数据
  src/data/posts.json
  src/data/issues.json
  src/data/meta.json
        ↓  git push → 自动部署
  Vercel 纯静态站 (所有人看到同一份数据)
```

## 与 v1 的区别

| | v1 | v2 |
|---|---|---|
| 数据生成 | Vercel Serverless + Tavily + DeepSeek | WorkBuddy Skill |
| 数据存储 | localStorage (每人不同) | GitHub JSON (所有人一致) |
| 部署方式 | 前端 + API function | 纯静态站 |
| 需要 API Key | ✅ (Tavily + DeepSeek) | ❌ 零配置 |

## 更新数据

在 WorkBuddy 中说：
```
扫描洛克王国舆情
```

Skill 会自动搜索 → 分析 → 更新 JSON → git push → Vercel 自动部署。

## 本地开发

```bash
npm install
npm run dev
```

## 技术栈

- React 18 + Vite + Recharts (前端)
- WorkBuddy Skill (数据采集)
- Vercel (静态部署)
