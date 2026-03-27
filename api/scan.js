// Vercel Serverless Function — /api/scan
// Tavily 搜索 + DeepSeek 情感分析/中文摘要

const QUERIES = [
  '"Roco Kingdom World" latest 2026',
  '"Roco Kingdom World" controversy Pokemon copy',
  '"Roco Kingdom World" global release reaction',
  '洛克王国世界 overseas TikTok Reddit 2026',
];

const SYS = `你是"洛克王国：世界"(Roco Kingdom: World)的海外舆情分析师。
根据提供的搜索结果，返回纯JSON（不要markdown代码块）：
{"posts":[{"p":"x|reddit|youtube|tiktok|media|forum|threads","u":"来源名","t":"中文摘要(最多60字)","d":"YYYY-MM-DD","s":"pos|neg|neu","l":"语言","url":"完整https链接"}],"issues":[{"title":"中文(最多25字)","sev":"critical|warning|watch","desc":"中文(最多100字)","plats":["平台名"],"tip":"中文建议(最多50字)"}]}
规则：
- 只收录有完整https://链接的条目
- URL去重
- 根据URL判断平台：x.com→x, reddit.com→reddit, youtube.com→youtube, tiktok.com→tiktok, threads.net→threads, taptap/resetera/gamefaqs→forum, 其他→media
- 情感分析要准确：正面=pos, 负面=neg, 中性=neu
- 摘要用中文
- 生成2-5个核心议题(issues)
- 只返回JSON，不要其他任何文字`;

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
    // Step 1: Tavily search
    const chunks = [];
    for (const q of QUERIES) {
      logs.push(`🔍 Searching: ${q}`);
      try {
        const searchRes = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: tavilyKey,
            query: q,
            search_depth: 'advanced',
            max_results: 10,
            include_raw_content: false,
          }),
        });

        if (!searchRes.ok) {
          logs.push(`❌ Tavily failed: ${searchRes.status}`);
          continue;
        }

        const data = await searchRes.json();
        const results = (data.results || []).filter(r =>
          r.url?.startsWith('https://') && /roco|洛克|kingdom/i.test((r.title || '') + ' ' + (r.content || ''))
        );
        logs.push(`✅ Got ${results.length} relevant results`);

        const formatted = results.map(r =>
          `Title: ${r.title}\nURL: ${r.url}\nDate: ${r.published_date || 'unknown'}\nContent: ${(r.content || '').slice(0, 300)}`
        ).join('\n---\n');

        if (formatted.length > 50) chunks.push(formatted);
      } catch (e) {
        logs.push(`❌ Tavily error: ${e.message}`);
      }
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
        max_tokens: 3000,
        temperature: 0.3,
        messages: [
          { role: 'system', content: SYS },
          { role: 'user', content: chunks.join('\n\n===\n\n').slice(0, 12000) },
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
