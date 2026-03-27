// Vercel Serverless Function — /api/scan
// Tavily 搜索 + DeepSeek 情感分析/中文摘要

const QUERIES = [
  '"Roco Kingdom World" latest 2026',
  '"Roco Kingdom World" controversy Pokemon copy',
  '"Roco Kingdom World" global release reaction',
  '洛克王国世界 overseas TikTok Reddit 2026',
];

const TODAY = new Date().toISOString().slice(0, 10);

const SYS = `你是"洛克王国：世界"(Roco Kingdom: World)的海外舆情分析师。今天是${TODAY}。
根据搜索结果，返回纯JSON（不要markdown代码块、不要任何解释文字）：
{"posts":[...],"issues":[...]}

## posts 字段规范
每条post: {"p":"平台","u":"来源名","t":"中文摘要","d":"YYYY-MM-DD","s":"pos|neg|neu","l":"语言","url":"链接"}

### 平台(p) — 严格按URL域名判断：
x.com/twitter.com→"x", reddit.com→"reddit", youtube.com/youtu.be→"youtube", tiktok.com→"tiktok", threads.net→"threads", taptap.io/resetera.com/gamefaqs.gamespot.com→"forum", 其他所有→"media"

### 来源名(u) — 必须从内容/URL中提取真实名称：
- X/Twitter: @用户名
- Reddit: r/子版块名
- YouTube: 频道名（从标题或内容提取，不要写"YouTube"）
- TikTok: @用户名
- 媒体: 网站名称（如GamingOnPhone、South China Morning Post，不要写域名）
- 如果是转载/聚合，写原始来源名

### 日期(d) — 这是最重要的字段，必须准确：
- 从文章内容、URL路径中的日期、明确提到的发布时间来判断
- 如果内容提到"June 2024 batch"或类似历史事件，日期应为2024年，不是今天
- 如果内容讨论的是过去事件的回顾/存档页面，用原始事件日期
- 绝对不要把搜索抓取时间当作发布日期
- 如果实在无法判断准确日期，写"unknown"而不是猜测

### 情绪(s) — 基于内容实际态度判断：
- pos: 明确表达喜爱、期待、推荐、赞美
- neg: 明确表达批评、不满、担忧、反对（如抄袭指控、P2W吐槽、锁区不满）
- neu: 纯新闻报道、信息转发、中立讨论、无明显倾向

### 语言(l) — 根据原文实际语言：
英语/中文/日语/泰语/越南语/印尼语/韩语。如果是英文媒体报道中国游戏，语言是"英语"不是"中文"。

### 摘要(t) — 60字以内中文：
概括核心信息，不要复述标题，要体现该条目的独特价值。

## issues 字段规范
2-5个核心议题: {"title":"中文≤25字","sev":"critical|warning|watch","desc":"中文≤100字","plats":["平台名"],"tip":"中文建议≤50字"}
- critical: 需要立即响应的危机
- warning: 需要关注的趋势
- watch: 背景性风险

## 过滤规则
- 只收录有完整https://链接的条目
- URL去重
- 过滤掉与洛克王国无关的结果`;

function detectPlatform(url) {
  if (!url) return 'media';
  if (url.includes('x.com') || url.includes('twitter.com')) return 'x';
  if (url.includes('reddit.com')) return 'reddit';
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('tiktok.com')) return 'tiktok';
  if (url.includes('threads.net')) return 'threads';
  if (url.includes('taptap.io') || url.includes('resetera.com') || url.includes('gamefaqs.')) return 'forum';
  return 'media';
}

function extractUsername(url, title) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('reddit.com')) {
      const m = u.pathname.match(/\/r\/([^/]+)/);
      return m ? 'r/' + m[1] : 'Reddit';
    }
    if (u.hostname.includes('x.com') || u.hostname.includes('twitter.com')) {
      const m = u.pathname.match(/\/([^/]+)/);
      return m ? '@' + m[1] : 'X';
    }
    if (u.hostname.includes('youtube.com')) return title?.split(/[-–|]/).pop()?.trim()?.slice(0, 20) || 'YouTube';
    if (u.hostname.includes('tiktok.com')) {
      const m = u.pathname.match(/@([^/]+)/);
      return m ? '@' + m[1] : 'TikTok';
    }
    return u.hostname.replace('www.', '').split('.')[0];
  } catch { return 'Unknown'; }
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const tavilyKey = process.env.TAVILY_API_KEY;
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (!tavilyKey) return res.status(500).json({ error: 'TAVILY_API_KEY not configured' });
  if (!deepseekKey) return res.status(500).json({ error: 'DEEPSEEK_API_KEY not configured' });

  const logs = [];

  try {
    // Step 1: Tavily search (all queries in parallel)
    const chunks = [];
    const searchPromises = QUERIES.map(async (q) => {
      try {
        const searchRes = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: tavilyKey,
            query: q,
            search_depth: 'basic',
            max_results: 8,
            include_raw_content: false,
          }),
        });
        if (!searchRes.ok) return { q, error: searchRes.status };
        const data = await searchRes.json();
        return { q, results: data.results || [] };
      } catch (e) {
        return { q, error: e.message };
      }
    });

    const searchResults = await Promise.all(searchPromises);

    for (const { q, results, error } of searchResults) {
      logs.push(`🔍 ${q}`);
      if (error) { logs.push(`❌ Tavily failed: ${error}`); continue; }

      const filtered = results.filter(r =>
        r.url?.startsWith('https://') && /roco|洛克|kingdom/i.test((r.title || '') + ' ' + (r.content || ''))
      );
      logs.push(`✅ ${filtered.length} relevant results`);

      const formatted = filtered.map(r => {
        const urlDateHint = r.url.match(/\/(\d{4})\/(\d{2})\//);
        const dateInfo = urlDateHint
          ? `URL-date-hint: ${urlDateHint[1]}-${urlDateHint[2]}`
          : `Tavily-date: ${r.published_date || 'unknown'}`;
        return `Title: ${r.title}\nURL: ${r.url}\n${dateInfo}\nSnippet: ${(r.content || '').slice(0, 300)}`;
      }).join('\n---\n');

      if (formatted.length > 50) chunks.push(formatted);
    }

    if (chunks.length === 0) {
      logs.push('⚠️ No relevant search results');
      return res.status(200).json({ posts: [], issues: [], logs });
    }

    // Step 2: DeepSeek analysis
    logs.push(`🧠 DeepSeek 分析 ${chunks.length} 组结果...`);
    const llmRes = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${deepseekKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 4000,
        temperature: 0.1,
        messages: [
          { role: 'system', content: SYS },
          { role: 'user', content: chunks.join('\n\n===\n\n').slice(0, 20000) },
        ],
      }),
    });

    if (!llmRes.ok) {
      const errText = await llmRes.text().catch(() => '');
      logs.push(`❌ DeepSeek failed: ${llmRes.status} ${errText.slice(0, 200)}`);

      // Fallback: return raw Tavily results with basic keyword sentiment
      logs.push('⚠️ Falling back to keyword analysis...');
      return fallbackParse(chunks, logs, res);
    }

    const llmData = await llmRes.json();
    const raw = (llmData.choices?.[0]?.message?.content || '')
      .replace(/```json|```/g, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      logs.push(`❌ JSON parse failed, falling back: ${e.message}`);
      return fallbackParse(chunks, logs, res);
    }

    const posts = (parsed.posts || []).filter(p => p.url?.startsWith('https://'));
    logs.push(`🎉 DeepSeek: ${posts.length} posts, ${(parsed.issues || []).length} issues`);

    return res.status(200).json({
      posts,
      issues: parsed.issues || [],
      logs,
    });

  } catch (e) {
    logs.push(`❌ Fatal: ${e.message}`);
    return res.status(200).json({ posts: [], issues: [], logs });
  }
}

// Fallback: basic keyword sentiment when LLM fails
function fallbackParse(chunks, logs, res) {
  const NEG = /controversy|copy|plagiar|stolen|sue|lawsuit|ban|disappoint|boring|scam|p2w|predatory|rip.off|terrible|awful|backlash|trash|flop|抄袭|骗|垃圾|差评|失望/i;
  const POS = /amazing|beautiful|love|incredible|awesome|excited|hype|best|stunning|gorgeous|fantastic|great|wonderful|promising|fun|enjoy|好玩|期待|惊艳|推荐|喜欢|治愈/i;

  const posts = [];
  const seenUrls = new Set();
  const urlRegex = /URL:\s*(https:\/\/[^\s\n]+)/g;
  const combined = chunks.join('\n');

  // Extract entries from raw text blocks
  const blocks = combined.split('---');
  for (const block of blocks) {
    const urlM = block.match(/URL:\s*(https:\/\/[^\s\n]+)/);
    const titleM = block.match(/Title:\s*([^\n]+)/);
    const dateM = block.match(/(\d{4}-\d{2}-\d{2})/);
    if (!urlM) continue;
    const url = urlM[1];
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    const text = (titleM?.[1] || '') + ' ' + block;
    const s = NEG.test(text) ? 'neg' : POS.test(text) ? 'pos' : 'neu';

    posts.push({
      p: detectPlatform(url),
      u: extractUsername(url, titleM?.[1]),
      t: truncate(titleM?.[1] || '', 60),
      d: dateM?.[1] || new Date().toISOString().slice(0, 10),
      s,
      l: /[\u4e00-\u9fff]/.test(text) ? '中文' : /[\u3040-\u30ff]/.test(text) ? '日语' : /[\u0e00-\u0e7f]/.test(text) ? '泰语' : '英语',
      url,
    });
  }

  logs.push(`📦 Fallback: ${posts.length} posts (keyword sentiment)`);
  return res.status(200).json({ posts, issues: [], logs });
}
