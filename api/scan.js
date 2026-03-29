// Vercel Serverless Function — /api/scan
// Tavily 搜索 + DeepSeek 情感分析/中文摘要

const QUERIES = [
  '"Roco Kingdom World" OR "洛克王国世界" latest news reaction',
  '"Roco Kingdom World" site:reddit.com OR site:youtube.com OR site:x.com OR site:tiktok.com',
  '"Roco Kingdom World" review OR controversy OR reaction',
];

const TODAY = new Date().toISOString().slice(0, 10);

const SYS = `你是"洛克王国：世界"(Roco Kingdom: World)的海外舆情分析师。今天是${TODAY}。
根据搜索结果，返回纯JSON（不要markdown代码块、不要任何解释文字）：
{"posts":[...],"issues":[...]}

## posts 字段规范
每条post: {"p":"平台","u":"来源名","t":"中文摘要","d":"YYYY-MM-DD","s":"pos|neg|neu","l":"语言","url":"链接"}

### 平台(p) — 严格按URL域名判断：
x.com/twitter.com→"x", reddit.com→"reddit", youtube.com/youtu.be→"youtube", tiktok.com→"tiktok", instagram.com→"instagram", facebook.com/fb.com→"facebook", threads.net→"threads", taptap.io/resetera.com/gamefaqs.gamespot.com→"forum", 其他所有→"media"

### 来源名(u) — 严格使用提供的Author-hint字段：
- 每条搜索结果附带了"Author-hint"字段，这是从URL精确提取的作者名
- 直接使用Author-hint的值作为u字段
- 如果没有Author-hint，再从标题或内容推断
- 绝对不要输出"未知"、"Unknown"、"未知频道"这类占位符

### 日期(d) — 严格使用提供的Verified-date字段：
- 每条搜索结果都附带了"Verified-date"字段，这是从API和URL提取的验证日期
- 必须直接使用Verified-date的值，不要自己推测或编造日期
- 如果Verified-date是"none"，再从URL-date-hint或文章内容中提取明确日期
- 如果仍然无法确定，写"unknown"，不要猜测

### 语言(l) — 优先使用Lang-hint字段：
- 如果搜索结果提供了"Lang-hint"字段，直接使用该值
- 否则根据文章实际语言判断
- 必须用中文标签：英语/中文/日语/泰语/越南语/印尼语/韩语

### 情绪(s) — 基于内容实际态度：
- pos: 明确正面（喜爱/期待/推荐/赞美）
- neg: 明确负面（批评/不满/抄袭指控/P2W吐槽/锁区不满）
- neu: 中性（纯新闻/信息转发/无明显倾向）

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
  if (url.includes('instagram.com')) return 'instagram';
  if (url.includes('facebook.com') || url.includes('fb.com') || url.includes('fb.watch')) return 'facebook';
  if (url.includes('threads.net')) return 'threads';
  if (url.includes('taptap.io') || url.includes('resetera.com') || url.includes('gamefaqs.')) return 'forum';
  return 'media';
}

// Known media brand mappings (hostname → display name)
const BRANDS = {
  'scmp.com': 'SCMP', 'yahoo.com': 'Yahoo', 'finance.yahoo.com': 'Yahoo Finance',
  'gamingonphone.com': 'GamingOnPhone', 'gamerbraves.com': 'GamerBraves',
  'gamefaqs.gamespot.com': 'GameFAQs', 'enduins.com': 'Enduins',
  'pocketgamer.com': 'PocketGamer', 'toucharcade.com': 'TouchArcade',
  'gamemonday.com': 'GameMonday', 'game-ded.com': 'Game-Ded',
  'gachagame.net': 'GachaGame', 'harmonyoshub.com': 'HarmonyOSHub',
  'seagm.com': 'SEAGM', 'daikama.com': 'Daikama', 'awnchina.cn': 'AWNChina',
  'kotaku.com': 'Kotaku', 'ign.com': 'IGN', 'gamerant.com': 'GameRant',
  'dualshockers.com': 'DualShockers', 'siliconera.com': 'Siliconera',
  'mmorpg.com': 'MMORPG', 'massivelyop.com': 'MassivelyOP',
  'mmobomb.com': 'MMOBomb', 'mein-mmo.de': 'Mein-MMO',
  'resetera.com': 'ResetEra', 'nme.com': 'NME',
  'theloadout.com': 'TheLoadout', 'pcinvasion.com': 'PCInvasion',
};

// Domain → language hint for post-processing validation
const DOMAIN_LANG = {
  'gamemonday.com': '泰语', 'game-ded.com': '泰语', 'sanook.com': '泰语',
  'gachagame.net': '越南语', 'vietgame.asia': '越南语',
  'duniagames.co.id': '印尼语', 'gamebrott.com': '印尼语',
  'awnchina.cn': '中文', 'gamersky.com': '中文', '3dmgame.com': '中文',
  'famitsu.com': '日语', '4gamer.net': '日语', 'automaton-media.com': '日语',
};

function extractUsername(url, title) {
  try {
    const u = new URL(url);
    // Reddit
    if (u.hostname.includes('reddit.com')) {
      const m = u.pathname.match(/\/r\/([^/]+)/);
      return m ? 'r/' + m[1] : 'Reddit';
    }
    // X/Twitter — also filter out common non-user paths
    if (u.hostname.includes('x.com') || u.hostname.includes('twitter.com')) {
      const m = u.pathname.match(/\/([^/]+)/);
      const skip = new Set(['search', 'hashtag', 'explore', 'i', 'settings', 'home']);
      return m && !skip.has(m[1]) ? '@' + m[1] : 'X';
    }
    // YouTube — title-based extraction (oEmbed called separately for better results)
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
      if (title) {
        const parts = title.split(/\s[-–—|]\s/);
        if (parts.length > 1) return parts[parts.length - 1].trim().slice(0, 25);
      }
      return 'YouTube';
    }
    // TikTok
    if (u.hostname.includes('tiktok.com')) {
      const m = u.pathname.match(/@([^/]+)/);
      return m ? '@' + m[1] : 'TikTok';
    }
    // Instagram
    if (u.hostname.includes('instagram.com')) {
      const m = u.pathname.match(/^\/([^/]+)/);
      const skip = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts']);
      return m && !skip.has(m[1]) ? '@' + m[1] : 'Instagram';
    }
    // Facebook
    if (u.hostname.includes('facebook.com') || u.hostname.includes('fb.com')) {
      const m = u.pathname.match(/^\/([^/]+)/);
      const skip = new Set(['watch', 'reel', 'groups', 'pages', 'events', 'marketplace', 'profile.php', 'share', 'sharer']);
      return m && !skip.has(m[1]) ? m[1] : 'Facebook';
    }
    // Media — use brand mapping or derive from hostname
    const host = u.hostname.replace('www.', '');
    if (BRANDS[host]) return BRANDS[host];
    const name = host.split('.')[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch { return 'Unknown'; }
}

// Fetch real YouTube channel name via free oEmbed API
async function fetchYouTubeAuthor(url) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.author_name || null;
  } catch { return null; }
}

// Extract date from URL with multiple patterns
function extractUrlDate(url) {
  // Pattern: /2026/03/ or /2026/03/24/
  let m = url.match(/\/(\d{4})\/(\d{2})(?:\/(\d{2}))?/);
  if (m) return m[3] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}-01`;
  // Pattern: /2026-03-24/ or -2026-03-24
  m = url.match(/[/-](\d{4}-\d{2}-\d{2})[/-]/);
  if (m) return m[1];
  // Pattern: /20260324/ (compact date in path)
  m = url.match(/\/(\d{4})(\d{2})(\d{2})\//);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

// Detect language from domain hostname
function detectLangFromDomain(url) {
  try {
    const host = new URL(url).hostname.replace('www.', '');
    if (DOMAIN_LANG[host]) return DOMAIN_LANG[host];
    // TLD-based hints
    if (host.endsWith('.th')) return '泰语';
    if (host.endsWith('.vn')) return '越南语';
    if (host.endsWith('.jp')) return '日语';
    if (host.endsWith('.kr')) return '韩语';
    if (host.endsWith('.id') || host.endsWith('.co.id')) return '印尼语';
    if (host.endsWith('.cn')) return '中文';
    return null;
  } catch { return null; }
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
  const startTime = Date.now();

  try {
    // Step 1: Tavily search (parallel; first query advanced for dates, rest basic for speed)
    const searchPromises = QUERIES.map(async (q, idx) => {
      try {
        const searchRes = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: tavilyKey,
            query: q,
            search_depth: idx === 0 ? 'advanced' : 'basic',
            max_results: 6,
            include_raw_content: false,
            days: 14,
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
    const metadataMap = new Map(); // URL → { verifiedDate, urlDateHint, authorHint, langHint }

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
        const urlDateHint = extractUrlDate(r.url);
        const tavilyDate = r.published_date || null;
        // Validate Tavily date (reject future dates and ancient dates)
        let verifiedDate = 'none';
        if (tavilyDate) {
          const d = new Date(tavilyDate);
          if (!isNaN(d) && d <= new Date() && d >= new Date('2020-01-01')) {
            verifiedDate = d.toISOString().slice(0, 10);
          }
        }
        if (verifiedDate === 'none' && urlDateHint) {
          const d = new Date(urlDateHint);
          if (!isNaN(d) && d <= new Date() && d >= new Date('2020-01-01')) {
            verifiedDate = urlDateHint;
          }
        }

        // Detect language from domain as a hint
        const langHint = detectLangFromDomain(r.url);
        // Pre-extract username from URL
        const authorHint = extractUsername(r.url, r.title);

        allFormatted.push([
          `Title: ${r.title}`,
          `URL: ${r.url}`,
          `Verified-date: ${verifiedDate}`,
          urlDateHint ? `URL-date-hint: ${urlDateHint}` : null,
          authorHint && authorHint !== 'Unknown' ? `Author-hint: ${authorHint}` : null,
          langHint ? `Lang-hint: ${langHint}` : null,
          `Snippet: ${(r.content || '').slice(0, 600)}`,
        ].filter(Boolean).join('\n'));

        // Store metadata for post-processing cross-validation
        metadataMap.set(r.url, { verifiedDate, urlDateHint, authorHint, langHint });
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
          { role: 'user', content: allFormatted.join('\n---\n').slice(0, 10000) },
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

    const rawPosts = (parsed.posts || []).filter(p => p.url?.startsWith('https://'));
    logs.push(`📋 DeepSeek 原始返回: ${rawPosts.length} posts`);

    let posts = rawPosts.map(p => postProcess(p, metadataMap));

    // Log date stats
    const withDate = posts.filter(p => p.d).length;
    const noDate = posts.filter(p => !p.d).length;
    if (withDate > 0) logs.push(`✅ ${withDate} posts 有确切日期`);
    if (noDate > 0) logs.push(`⚠️ ${noDate} posts 无确切日期`);

    // Resolve YouTube channel names via oEmbed (2s timeout per request, all parallel)
    const ytPosts = posts.filter(p => p.p === 'youtube');
    if (ytPosts.length > 0) {
      const ytResults = await Promise.all(ytPosts.map(p => fetchYouTubeAuthor(p.url)));
      ytPosts.forEach((p, i) => { if (ytResults[i]) p.u = ytResults[i]; });
      logs.push(`🎬 YouTube oEmbed: resolved ${ytResults.filter(Boolean).length}/${ytPosts.length} channel names`);
    }

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

// Post-process: validate and fix LLM output using metadata from Tavily
function postProcess(p, metadataMap) {
  const meta = metadataMap?.get(p.url) || {};

  // 1. Date — cross-validate LLM date against Tavily verified date
  const llmDate = (p.d && p.d !== 'unknown' && p.d !== 'none') ? p.d : '';
  const tavilyDate = (meta.verifiedDate && meta.verifiedDate !== 'none') ? meta.verifiedDate : '';

  if (tavilyDate) {
    // Tavily/URL date is our ground truth
    if (llmDate) {
      // If LLM date differs by more than 30 days from Tavily date, trust Tavily
      const diff = Math.abs(new Date(llmDate) - new Date(tavilyDate)) / 864e5;
      p.d = diff > 30 ? tavilyDate : llmDate;
    } else {
      p.d = tavilyDate;
    }
  } else if (llmDate) {
    p.d = llmDate;
  } else {
    p.d = '';
  }

  // Validate final date is sane
  if (p.d) {
    const date = new Date(p.d);
    const now = new Date();
    if (isNaN(date) || date > now || date < new Date('2020-01-01')) {
      p.d = '';
    }
  }

  // 2. Language — normalize then cross-check with domain hint
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
  // If domain has a strong language signal and LLM said "英语", override
  if (meta.langHint && (!p.l || p.l === '英语')) {
    p.l = meta.langHint;
  }

  // 3. Platform (always override with URL-based detection)
  if (p.url) p.p = detectPlatform(p.url);

  // 4. Username — for X/Reddit/TikTok, always use URL-extracted name (most reliable)
  //    For YouTube, keep LLM name only if it looks specific; oEmbed resolves later
  //    For media, use brand mapping
  const extracted = extractUsername(p.url, p.t);
  if (p.p === 'x' || p.p === 'reddit' || p.p === 'tiktok' || p.p === 'instagram' || p.p === 'facebook') {
    // URL parsing is deterministic and reliable for these platforms
    if (extracted && extracted !== 'Unknown') p.u = extracted;
  } else if (p.p === 'youtube') {
    // LLM username is unreliable for YouTube; use extracted unless it's generic
    if (!p.u || p.u === 'Unknown' || p.u === 'unknown' || p.u === '未知' || p.u === '未知频道') {
      p.u = (extracted && extracted !== 'YouTube') ? extracted : 'YouTube';
    }
  } else {
    // Media/forum: prefer brand mapping over LLM
    if (extracted && extracted !== 'Unknown') {
      if (!p.u || p.u === 'Unknown' || p.u === 'unknown' || p.u === '未知') {
        p.u = extracted;
      }
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

    const text = (titleM?.[1] || '') + ' ' + block;
    const s = NEG.test(text) ? 'neg' : POS.test(text) ? 'pos' : 'neu';

    // Detect language: domain hint first, then Unicode script detection
    const domainLang = detectLangFromDomain(url);
    let lang = domainLang;
    if (!lang) {
      if (/[\u0e00-\u0e7f]/.test(text)) lang = '泰语';
      else if (/[\u3040-\u30ff\u30a0-\u30ff]/.test(text)) lang = '日语';
      else if (/[\uac00-\ud7af]/.test(text)) lang = '韩语';
      else if (/[\u4e00-\u9fff]/.test(text) && !/[a-zA-Z]{20}/.test(text)) lang = '中文';
      else lang = '英语';
    }

    posts.push({
      p: detectPlatform(url),
      u: extractUsername(url, titleM?.[1]),
      t: (titleM?.[1] || '').slice(0, 60),
      d: dateM?.[1] || '',
      s,
      l: lang,
      url,
    });
  }

  logs.push(`📦 Fallback: ${posts.length} posts (keyword sentiment)`);
  return res.status(200).json({ posts, issues: [], logs });
}
