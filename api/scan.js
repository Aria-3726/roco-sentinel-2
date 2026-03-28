// Vercel Serverless Function — /api/scan
// Tavily 搜索 + DeepSeek 情感分析/中文摘要

const QUERIES = [
  '"Roco Kingdom World" 2026 site:reddit.com OR site:youtube.com OR site:tiktok.com',
  '"Roco Kingdom World" review OR reaction OR controversy 2026',
  '洛克王国世界 海外 reaction global release 2026',
];

const TODAY = new Date().toISOString().slice(0, 10);

const SYS = `你是"洛克王国：世界"(Roco Kingdom: World)的海外舆情分析师。今天是${TODAY}。
根据搜索结果，返回纯JSON（不要markdown代码块、不要任何解释文字）：
{"posts":[...],"issues":[...]}

## posts 字段规范
每条post: {"p":"平台","u":"来源名","t":"中文摘要","d":"YYYY-MM-DD","s":"pos|neg|neu","l":"语言","url":"链接"}

### 平台(p) — 严格按URL域名判断：
x.com/twitter.com→"x", reddit.com→"reddit", youtube.com/youtu.be→"youtube", tiktok.com→"tiktok", threads.net→"threads", taptap.io/resetera.com/gamefaqs.gamespot.com→"forum", 其他所有→"media"

### 来源名(u) — 关键规则：
- X/Twitter: 从URL提取@用户名
- Reddit: r/子版块名
- YouTube: 从标题中提取频道名（通常在 " - " 或 " | " 后面），如果无法提取就用标题前10个字
- TikTok: 从URL提取@用户名
- 媒体: 从URL的域名提取网站品牌名（gamingonphone.com→GamingOnPhone, scmp.com→SCMP）
- 绝对不要输出"未知"、"Unknown"、"未知频道"这类占位符

### 日期(d) — 严格使用提供的Verified-date字段：
- 每条搜索结果都附带了"Verified-date"字段，这是从Tavily API获取的发布日期
- 直接使用Verified-date的值，不要自己推测日期
- 如果Verified-date是"none"，再从URL-date-hint或文章内容中判断
- 如果仍然无法确定，写"unknown"

### 情绪(s) — 基于内容实际态度：
- pos: 明确正面（喜爱/期待/推荐/赞美）
- neg: 明确负面（批评/不满/抄袭指控/P2W吐槽/锁区不满）
- neu: 中性（纯新闻/信息转发/无明显倾向）

### 语言(l) — 必须用中文标签：
英语/中文/日语/泰语/越南语/印尼语/韩语

### 摘要(t) — 60字以内中文，概括核心信息。

## issues 字段
2-5个核心议题: {"title":"中文≤25字","sev":"critical|warning|watch","desc":"中文≤100字","plats":["平台名"],"tip":"中文建议≤50字"}

## 过滤
- 只收录有完整https://链接的条目，URL去重
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
    // Reddit
    if (u.hostname.includes('reddit.com')) {
      const m = u.pathname.match(/\/r\/([^/]+)/);
      return m ? 'r/' + m[1] : 'Reddit';
    }
    // X/Twitter
    if (u.hostname.includes('x.com') || u.hostname.includes('twitter.com')) {
      const m = u.pathname.match(/\/([^/]+)/);
      return m && m[1] !== 'search' && m[1] !== 'hashtag' ? '@' + m[1] : 'X';
    }
    // YouTube - try to extract channel from title pattern "Video Title - Channel Name"
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
      if (title) {
        const parts = title.split(/\s[-–|]\s/);
        if (parts.length > 1) return parts[parts.length - 1].trim().slice(0, 25);
        return title.slice(0, 20);
      }
      return 'YouTube';
    }
    // TikTok
    if (u.hostname.includes('tiktok.com')) {
      const m = u.pathname.match(/@([^/]+)/);
      return m ? '@' + m[1] : 'TikTok';
    }
    // Media - extract brand name from hostname
    const host = u.hostname.replace('www.', '');
    // Known brand mappings
    const brands = {
      'scmp.com': 'SCMP', 'yahoo.com': 'Yahoo', 'finance.yahoo.com': 'Yahoo Finance',
      'gamingonphone.com': 'GamingOnPhone', 'gamerbraves.com': 'GamerBraves',
      'gamefaqs.gamespot.com': 'GameFAQs', 'enduins.com': 'Enduins',
      'pocketgamer.com': 'PocketGamer', 'toucharcade.com': 'TouchArcade',
    };
    if (brands[host]) return brands[host];
    // Fallback: capitalize first part of hostname
    const name = host.split('.')[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch { return 'Unknown'; }
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
    // Step 1: Tavily search (all queries in parallel, advanced for better metadata)
    const searchPromises = QUERIES.map(async (q) => {
      try {
        const searchRes = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: tavilyKey,
            query: q,
            search_depth: 'advanced',
            max_results: 5,
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

    // Deduplicate across all queries
    const seenUrls = new Set();
    const allFormatted = [];

    for (const { q, results, error } of searchResults) {
      logs.push(`🔍 ${q}`);
      if (error) { logs.push(`❌ Tavily failed: ${error}`); continue; }

      const filtered = (results || []).filter(r =>
        r.url?.startsWith('https://') &&
        !seenUrls.has(r.url) &&
        /roco|洛克|kingdom/i.test((r.title || '') + ' ' + (r.content || ''))
      );
      filtered.forEach(r => seenUrls.add(r.url));
      logs.push(`✅ ${filtered.length} relevant results`);

      for (const r of filtered) {
        // Build verified date from multiple sources
        const urlDateMatch = r.url.match(/\/(\d{4})\/(\d{2})\//);
        const urlDateHint = urlDateMatch ? `${urlDateMatch[1]}-${urlDateMatch[2]}` : null;
        const tavilyDate = r.published_date || null;
        // Validate Tavily date (reject future dates)
        let verifiedDate = 'none';
        if (tavilyDate) {
          const d = new Date(tavilyDate);
          if (!isNaN(d) && d <= new Date() && d >= new Date('2020-01-01')) {
            verifiedDate = d.toISOString().slice(0, 10);
          }
        }
        if (verifiedDate === 'none' && urlDateHint) {
          verifiedDate = urlDateHint + '-01'; // approximate
        }

        allFormatted.push([
          `Title: ${r.title}`,
          `URL: ${r.url}`,
          `Verified-date: ${verifiedDate}`,
          urlDateHint ? `URL-date-hint: ${urlDateHint}` : null,
          `Snippet: ${(r.content || '').slice(0, 400)}`,
        ].filter(Boolean).join('\n'));
      }
    }

    if (allFormatted.length === 0) {
      logs.push('⚠️ No relevant search results');
      return res.status(200).json({ posts: [], issues: [], logs });
    }

    logs.push(`📦 Total unique results: ${allFormatted.length}`);

    // Step 2: DeepSeek analysis
    logs.push(`🧠 DeepSeek 分析中...`);
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
          { role: 'user', content: allFormatted.join('\n---\n').slice(0, 20000) },
        ],
      }),
    });

    if (!llmRes.ok) {
      const errText = await llmRes.text().catch(() => '');
      logs.push(`❌ DeepSeek failed: ${llmRes.status} ${errText.slice(0, 200)}`);
      logs.push('⚠️ Falling back to keyword analysis...');
      return fallbackParse(allFormatted, logs, res);
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
      return fallbackParse(allFormatted, logs, res);
    }

    const posts = (parsed.posts || [])
      .filter(p => p.url?.startsWith('https://'))
      .map(p => postProcess(p))
      .filter(p => p.d); // Drop posts without verified date
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

// Post-process: validate and fix LLM output
function postProcess(p) {
  // 1. Date validation
  if (p.d && p.d !== 'unknown' && p.d !== 'none') {
    const date = new Date(p.d);
    const now = new Date();
    const minDate = new Date('2020-01-01');
    if (isNaN(date) || date > now || date < minDate) {
      p.d = '';
    }
  } else {
    p.d = '';
  }

  // 2. Language normalization
  const langMap = {
    'en': '英语', 'english': '英语', 'eng': '英语',
    'zh': '中文', 'chinese': '中文', 'cn': '中文', 'zh-cn': '中文', 'zh-tw': '中文',
    'ja': '日语', 'japanese': '日语', 'jp': '日语',
    'th': '泰语', 'thai': '泰语',
    'vi': '越南语', 'vietnamese': '越南语',
    'id': '印尼语', 'indonesian': '印尼语',
    'ko': '韩语', 'korean': '韩语',
  };
  if (p.l) {
    const normalized = langMap[p.l.toLowerCase()];
    if (normalized) p.l = normalized;
  }

  // 3. Platform (always override with URL-based detection)
  if (p.url) p.p = detectPlatform(p.url);

  // 4. Username (always override with URL-based extraction for reliability)
  const extracted = extractUsername(p.url, p.t);
  if (extracted && extracted !== 'Unknown') {
    // Keep LLM username only if it looks more specific than URL extraction
    if (!p.u || p.u === 'Unknown' || p.u === 'unknown' || p.u === '未知' ||
        p.u === '未知频道' || p.u === 'YouTube' || p.u === 'TikTok' || p.u === 'Reddit') {
      p.u = extracted;
    }
  }

  // 5. Sentiment validation
  if (!['pos', 'neg', 'neu'].includes(p.s)) p.s = 'neu';

  return p;
}

// Fallback: keyword sentiment when LLM fails
function fallbackParse(formatted, logs, res) {
  const NEG = /controversy|copy|plagiar|stolen|sue|lawsuit|ban|disappoint|boring|scam|p2w|predatory|rip.off|terrible|awful|backlash|trash|flop|抄袭|骗|垃圾|差评|失望/i;
  const POS = /amazing|beautiful|love|incredible|awesome|excited|hype|best|stunning|gorgeous|fantastic|great|wonderful|promising|fun|enjoy|好玩|期待|惊艳|推荐|喜欢|治愈/i;

  const posts = [];
  const seenUrls = new Set();

  for (const block of formatted) {
    const urlM = block.match(/URL:\s*(https:\/\/[^\s\n]+)/);
    const titleM = block.match(/Title:\s*([^\n]+)/);
    const dateM = block.match(/Verified-date:\s*(\d{4}-\d{2}-\d{2})/);
    if (!urlM) continue;
    const url = urlM[1];
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    if (!dateM) continue; // Skip undated posts in fallback too

    const text = (titleM?.[1] || '') + ' ' + block;
    const s = NEG.test(text) ? 'neg' : POS.test(text) ? 'pos' : 'neu';

    posts.push({
      p: detectPlatform(url),
      u: extractUsername(url, titleM?.[1]),
      t: (titleM?.[1] || '').slice(0, 60),
      d: dateM[1],
      s,
      l: /[\u4e00-\u9fff]/.test(text) ? '中文' : /[\u3040-\u30ff]/.test(text) ? '日语' : /[\u0e00-\u0e7f]/.test(text) ? '泰语' : '英语',
      url,
    });
  }

  logs.push(`📦 Fallback: ${posts.length} posts (keyword sentiment)`);
  return res.status(200).json({ posts, issues: [], logs });
}
