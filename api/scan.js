// Vercel Serverless Function — /api/scan
// Tavily 搜索 + Anthropic Claude 分析

const QUERIES = [
  '"Roco Kingdom World" latest 2026',
  '"Roco Kingdom World" controversy Pokemon copy',
  '"Roco Kingdom World" global release reaction',
  '洛克王国世界 overseas TikTok Reddit 2026',
];

const SYS = `You are a bilingual gaming sentiment analyst for "Roco Kingdom: World" (洛克王国：世界).
Return ONLY valid JSON. No backticks, markdown, or preamble.
{"posts":[{"p":"x|reddit|youtube|tiktok|media|forum|threads","u":"name","t":"Chinese summary max 60 chars","d":"YYYY-MM-DD","s":"pos|neg|neu","l":"language","url":"full https URL"}],"issues":[{"title":"Chinese max 25 chars","sev":"critical|warning|watch","desc":"Chinese max 100 chars","plats":["names"],"tip":"Chinese max 50 chars"}]}
Only include items with real complete https:// URLs from the search results provided. Deduplicate. Summarize in Chinese. 2-5 issues.
Classify platform by URL: x.com→x, reddit.com→reddit, youtube.com→youtube, tiktok.com→tiktok, threads.net→threads, taptap→forum, everything else→media.`;

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const tavilyKey = process.env.TAVILY_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!tavilyKey) return res.status(500).json({ error: 'TAVILY_API_KEY not configured' });
  if (!anthropicKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const logs = [];

  try {
    // Step 1: Search via Tavily API
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
          logs.push(`❌ Tavily search failed: ${searchRes.status}`);
          continue;
        }

        const data = await searchRes.json();
        const results = (data.results || []).map(r =>
          `Title: ${r.title}\nURL: ${r.url}\nDate: ${r.published_date || 'unknown'}\nSnippet: ${r.content}`
        ).join('\n---\n');

        if (results.length > 50) {
          chunks.push(`[Search: ${q}]\n${results}`);
          logs.push(`✅ Got ${data.results.length} results`);
        } else {
          logs.push('⚠️ Too few results');
        }
      } catch (e) {
        logs.push(`❌ Tavily error: ${e.message}`);
      }
    }

    if (chunks.length === 0) {
      logs.push('⚠️ No search results from any query');
      return res.status(200).json({ posts: [], issues: [], logs });
    }

    // Step 2: Analyze with Claude (no web_search tool needed)
    logs.push(`📦 Analyzing ${chunks.length} result sets with Claude...`);
    const analysisRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: SYS,
        messages: [{
          role: 'user',
          content: chunks.join('\n\n===\n\n').slice(0, 15000),
        }],
      }),
    });

    if (!analysisRes.ok) {
      const errText = await analysisRes.text().catch(() => '');
      logs.push(`❌ Claude analysis failed: ${analysisRes.status} ${errText.slice(0, 200)}`);
      return res.status(200).json({ posts: [], issues: [], logs });
    }

    const analysisData = await analysisRes.json();
    const jsonStr = (analysisData.content || [])
      .map(c => c.type === 'text' ? c.text : '')
      .filter(Boolean)
      .join('\n')
      .replace(/```json|```/g, '')
      .trim();

    const parsed = JSON.parse(jsonStr);
    logs.push(`🎉 Found ${(parsed.posts || []).length} posts, ${(parsed.issues || []).length} issues`);

    return res.status(200).json({
      posts: (parsed.posts || []).filter(p => p.url && p.url.startsWith('https://')),
      issues: parsed.issues || [],
      logs,
    });

  } catch (e) {
    logs.push(`❌ Fatal: ${e.message}`);
    return res.status(200).json({ posts: [], issues: [], logs });
  }
}
