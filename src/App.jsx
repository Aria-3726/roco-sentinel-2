import { useState, useEffect, useRef } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { SEED_POSTS, SEED_ISSUES } from "./data.js";

const C = { pos:'#34d399', neg:'#f87171', neu:'#64748b', x:'#60a5fa', reddit:'#fbbf24', youtube:'#f87171', tiktok:'#f472b6', instagram:'#e879f9', facebook:'#60a5fa', media:'#a78bfa', forum:'#22d3ee', threads:'#22d3ee' };
const PN = { x:'𝕏', reddit:'Reddit', youtube:'YouTube', tiktok:'TikTok', instagram:'Instagram', facebook:'Facebook', media:'媒体', forum:'论坛', threads:'Threads' };
const SN = { pos:'正面', neg:'负面', neu:'中性' };
const bg='#0a0c10', sf='#12151c', bd='#252b3b', bdH='#3a4560', t1='#e4e8f1', t2='#8e99b3', t3='#5a6580';

export default function App() {
  const [posts, setPosts] = useState(SEED_POSTS);
  const [issues, setIssues] = useState(SEED_ISSUES);
  const [scanning, setScanning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [logOpen, setLogOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const [scanN, setScanN] = useState(0);
  const [cd, setCd] = useState("");
  const ref = useRef(null);

  // Load from localStorage + clean bad data using URL-based corrections
  useEffect(() => {
    try {
      const saved = localStorage.getItem("roco-sentinel-data");
      if (saved) {
        const d = JSON.parse(saved);
        if (d.posts?.length > 0) {
          const langMap = { en:'英语', english:'英语', zh:'中文', chinese:'中文', ja:'日语', japanese:'日语', th:'泰语', thai:'泰语', vi:'越南语', id:'印尼语', ko:'韩语' };
          // Platform detection from URL
          const detectPlat = (url) => {
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
          };
          // Username extraction from URL
          const extractUser = (url) => {
            try {
              const u = new URL(url);
              if (u.hostname.includes('reddit.com')) { const m = u.pathname.match(/\/r\/([^/]+)/); return m ? 'r/'+m[1] : null; }
              if (u.hostname.includes('x.com') || u.hostname.includes('twitter.com')) { const m = u.pathname.match(/\/([^/]+)/); return m && !['search','hashtag','explore','i','settings','home'].includes(m[1]) ? '@'+m[1] : null; }
              if (u.hostname.includes('tiktok.com')) { const m = u.pathname.match(/@([^/]+)/); return m ? '@'+m[1] : null; }
              if (u.hostname.includes('instagram.com')) { const m = u.pathname.match(/^\/([^/]+)/); return m && !['p','reel','reels','stories','explore','accounts'].includes(m[1]) ? '@'+m[1] : null; }
              if (u.hostname.includes('facebook.com') || u.hostname.includes('fb.com')) { const m = u.pathname.match(/^\/([^/]+)/); return m && !['watch','reel','groups','pages','events','marketplace','profile.php','share','sharer'].includes(m[1]) ? m[1] : null; }
              return null;
            } catch { return null; }
          };
          const cleaned = d.posts.map(p => {
            // Fix language
            if (p.l && langMap[p.l.toLowerCase()]) p.l = langMap[p.l.toLowerCase()];
            // Fix bad dates
            if (p.d === 'unknown' || p.d === 'none' || p.d === 'null') p.d = '';
            if (p.d) { const dt = new Date(p.d); if (isNaN(dt) || dt > new Date() || dt < new Date('2020-01-01')) p.d = ''; }
            // Fix platform from URL
            if (p.url) p.p = detectPlat(p.url);
            // Fix username from URL for reliable platforms
            if (p.url && (p.p === 'x' || p.p === 'reddit' || p.p === 'tiktok' || p.p === 'instagram' || p.p === 'facebook')) {
              const u = extractUser(p.url);
              if (u) p.u = u;
            }
            // Fix bad usernames
            if (p.u === '未知频道' || p.u === '未知' || p.u === 'Unknown') p.u = p.p === 'youtube' ? 'YouTube' : p.p;
            return p;
          }).filter(p => p._new ? p.d : true);
          setPosts(cleaned);
          setIssues(d.issues || SEED_ISSUES);
          setScanN(d.n || 0);
          localStorage.setItem("roco-sentinel-data", JSON.stringify({ posts: cleaned, issues: d.issues || SEED_ISSUES, n: d.n || 0 }));
        }
      }
    } catch(e) { /* no saved data */ }
  }, []);

  // Countdown
  useEffect(() => {
    const tick = () => {
      const ms = Math.max(0, new Date("2026-03-26T00:00:00+08:00") - Date.now());
      const dd = Math.floor(ms / 864e5);
      const hh = String(Math.floor((ms % 864e5) / 36e5)).padStart(2, "0");
      const mm = String(Math.floor((ms % 36e5) / 6e4)).padStart(2, "0");
      const ss = String(Math.floor((ms % 6e4) / 1e3)).padStart(2, "0");
      setCd(dd + "天 " + hh + ":" + mm + ":" + ss);
    };
    tick(); const iv = setInterval(tick, 1000); return () => clearInterval(iv);
  }, []);

  useEffect(() => { ref.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  function log(m) { setLogs(p => [...p, { time: new Date().toLocaleTimeString("en", { hour12: false }), msg: m }]); }

  async function scan() {
    setScanning(true); setLogs([]); setLogOpen(true);
    log("🚀 调用 /api/scan ...");
    try {
      const res = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" } });
      if (!res.ok) { log("❌ 服务器错误: " + res.status + " (可能超时，请重试)"); setScanning(false); return; }
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { log("❌ 返回数据解析失败（可能超时），请重试"); setScanning(false); return; }
      (data.logs || []).forEach(l => log(l));
      const urls = new Set(posts.map(p => p.url));
      const merged = [...posts];
      let added = 0;
      (data.posts || []).forEach(p => {
        if (p.url && !urls.has(p.url)) { merged.push({ ...p, _new: true }); urls.add(p.url); added++; }
      });
      const ni = data.issues?.length > 0 ? data.issues : issues;
      const n = scanN + 1;
      setPosts(merged); setIssues(ni); setScanN(n);
      localStorage.setItem("roco-sentinel-data", JSON.stringify({ posts: merged, issues: ni, n }));
      log("🎉 新增 " + added + " 条，总计 " + merged.length);
    } catch(e) { log("❌ " + e.message); }
    setScanning(false);
  }

  function reset() {
    localStorage.removeItem("roco-sentinel-data");
    setPosts(SEED_POSTS); setIssues(SEED_ISSUES); setScanN(0); setLogs([]);
  }

  // Computed
  const posN = posts.filter(x => x.s === "pos").length;
  const negN = posts.filter(x => x.s === "neg").length;
  const neuN = posts.filter(x => x.s === "neu").length;
  const sentData = [{ name: "正面", value: posN, color: C.pos }, { name: "中性", value: neuN, color: C.neu }, { name: "负面", value: negN, color: C.neg }].filter(x => x.value > 0);
  const platMap = {}; posts.forEach(x => { platMap[x.p] = (platMap[x.p] || 0) + 1; });
  const platData = Object.entries(platMap).map(([k, v]) => ({ name: PN[k] || k, value: v, color: C[k] || "#64748b" })).sort((a, b) => b.value - a.value);
  const allPlats = ["all", ...Object.keys(platMap)];
  const list = (filter === "all" ? posts : posts.filter(x => x.p === filter)).sort((a, b) => (b.d || "").localeCompare(a.d || ""));

  // Daily growth
  const dailyMap = {};
  posts.forEach(x => { if (!x.d) return; if (!dailyMap[x.d]) dailyMap[x.d] = { date: x.d, total: 0, pos: 0, neg: 0, neu: 0 }; dailyMap[x.d].total++; dailyMap[x.d][x.s]++; });
  const dailyData = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)).map(d => ({ name: d.date.slice(5), ...d }));

  const Badge = ({ type, children }) => {
    const m = { pos:[C.pos,"rgba(52,211,153,.1)"], neg:[C.neg,"rgba(248,113,113,.1)"], neu:[C.neu,"rgba(100,116,139,.12)"], critical:[C.neg,"rgba(248,113,113,.1)"], warning:["#fbbf24","rgba(251,191,36,.1)"], watch:[C.x,"rgba(96,165,250,.1)"], verified:[C.pos,"rgba(52,211,153,.1)"] };
    const [fg, bgc] = m[type] || [t3, "rgba(100,116,139,.1)"];
    return <span style={{ fontSize:10, fontWeight:700, padding:"2px 6px", borderRadius:3, color:fg, background:bgc, whiteSpace:"nowrap" }}>{children}</span>;
  };

  return (
    <div style={{ minHeight:"100vh", background:bg, color:t1, fontFamily:"system-ui,-apple-system,'Noto Sans SC',sans-serif", padding:"0 20px 40px", maxWidth:1400, margin:"0 auto" }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 0", borderBottom:"1px solid "+bd, marginBottom:16, flexWrap:"wrap", gap:10 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:36, height:36, borderRadius:9, background:"linear-gradient(135deg,#60a5fa,#a78bfa)", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:13, color:"#fff", fontFamily:"monospace" }}>RK</div>
          <div>
            <div style={{ fontWeight:700, fontSize:14 }}>ROCO KINGDOM: WORLD 实时舆情监控</div>
            <div style={{ fontSize:10.5, color:t3 }}>覆盖英/日/泰/越/印尼语 · YouTube / TikTok / Reddit / X / 海外媒体</div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          <div style={{ background:sf, border:"1px solid "+bd, borderRadius:7, padding:"4px 10px", fontSize:11.5, fontFamily:"monospace", color:"#fbbf24", fontWeight:600 }}>{"⏱ "+cd}</div>
          <button onClick={scan} disabled={scanning} style={{ background:scanning?"#181c27":"linear-gradient(135deg,#60a5fa,#a78bfa)", border:"none", borderRadius:7, padding:"7px 16px", color:"#fff", fontWeight:600, fontSize:11.5, cursor:scanning?"wait":"pointer", opacity:scanning?.6:1, fontFamily:"inherit" }}>{scanning?"⏳ 扫描中...":"🔄 扫描更新"}</button>
          <button onClick={reset} style={{ background:"transparent", border:"1px solid "+bd, borderRadius:7, padding:"6px 10px", color:t3, fontSize:10.5, cursor:"pointer", fontFamily:"inherit" }}>重置</button>
        </div>
      </div>

      {/* Methodology */}
      <div style={{ background:sf, border:"1px solid "+bd, borderRadius:9, padding:"9px 14px", marginBottom:14, fontSize:10.5, color:t2, lineHeight:1.6 }}>
        <strong style={{ color:t1 }}>ℹ️ 数据说明</strong> · 预加载 {SEED_POSTS.length} 条验证帖子。「扫描更新」调用 Anthropic API + Web Search 搜索新数据。
        {scanN > 0 && <span style={{ color:t3 }}> · 已扫描{scanN}次</span>}
      </div>

      {/* KPI */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:14 }}>
        {[
          { label:"已采集帖子", val:posts.length, color:"#60a5fa" },
          { label:"正面率", val:(posts.length?Math.round(posN/posts.length*100):0)+"%", color:C.pos },
          { label:"负面率", val:(posts.length?Math.round(negN/posts.length*100):0)+"%", color:C.neg },
          { label:"活跃议题", val:issues.length, color:"#fbbf24" },
        ].map((k,i) => (
          <div key={i} style={{ background:sf, border:"1px solid "+bd, borderRadius:12, padding:"13px 15px" }}>
            <div style={{ fontSize:9.5, color:t3, textTransform:"uppercase", letterSpacing:1, fontWeight:600, marginBottom:5 }}>{k.label}</div>
            <div style={{ fontFamily:"monospace", fontSize:24, fontWeight:700, color:k.color }}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* Scan Log */}
      {logOpen && logs.length > 0 && (
        <div style={{ background:sf, border:"1px solid "+bd, borderRadius:9, marginBottom:14, overflow:"hidden" }}>
          <div style={{ display:"flex", justifyContent:"space-between", padding:"7px 14px", borderBottom:"1px solid "+bd }}>
            <span style={{ fontSize:11.5, fontWeight:600, color:t2 }}>📡 扫描日志</span>
            <button onClick={() => setLogOpen(false)} style={{ background:"none", border:"none", color:t3, cursor:"pointer", fontSize:10, fontFamily:"inherit" }}>收起 ▲</button>
          </div>
          <div style={{ maxHeight:140, overflowY:"auto", padding:"6px 14px", fontFamily:"monospace", fontSize:10.5, lineHeight:1.8 }}>
            {logs.map((l,i) => <div key={i} style={{ color:l.msg.startsWith("❌")?C.neg:l.msg.startsWith("✅")||l.msg.startsWith("🎉")?C.pos:t2 }}><span style={{ color:t3, marginRight:6 }}>{l.time}</span>{l.msg}</div>)}
            <div ref={ref} />
          </div>
        </div>
      )}

      {/* Issues + Charts */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
        <div style={{ background:sf, border:"1px solid "+bd, borderRadius:12, overflow:"hidden" }}>
          <div style={{ padding:"12px 16px", borderBottom:"1px solid "+bd, fontWeight:600, fontSize:13 }}>🔴 核心议题追踪 ({issues.length})</div>
          <div style={{ padding:12, maxHeight:380, overflowY:"auto" }}>
            {issues.map((a,i) => {
              const sevC = a.sev==="critical"?C.neg:a.sev==="warning"?"#fbbf24":"#60a5fa";
              return (
                <div key={i} style={{ background:bg, border:"1px solid "+bd, borderRadius:8, padding:11, marginBottom:i<issues.length-1?9:0, borderLeft:"3px solid "+sevC }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:5, flexWrap:"wrap" }}>
                    <Badge type={a.sev}>{a.sev==="critical"?"⚡需响应":a.sev==="warning"?"👁关注":"📌背景"}</Badge>
                    {(a.plats||[]).map((p,j)=><span key={j} style={{ fontSize:9, fontWeight:600, padding:"1px 5px", borderRadius:3, background:"#181c27", color:t2 }}>{p}</span>)}
                  </div>
                  <div style={{ fontSize:12.5, fontWeight:600, marginBottom:3 }}>{a.title}</div>
                  <div style={{ fontSize:10.5, color:t2, lineHeight:1.5, marginBottom:5 }}>{a.desc}</div>
                  {a.tip && <div style={{ fontSize:10, color:"#fbbf24", fontStyle:"italic" }}>💡 {a.tip}</div>}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ background:sf, border:"1px solid "+bd, borderRadius:12, overflow:"hidden", flex:1 }}>
            <div style={{ padding:"12px 16px", borderBottom:"1px solid "+bd, fontWeight:600, fontSize:13 }}>🟢 情绪分布 ({posts.length}条)</div>
            <div style={{ padding:"8px 14px", display:"flex", alignItems:"center", gap:16 }}>
              <div style={{ width:120, height:120 }}><ResponsiveContainer><PieChart><Pie data={sentData} cx="50%" cy="50%" innerRadius={25} outerRadius={48} dataKey="value" stroke="none">{sentData.map((d,i)=><Cell key={i} fill={d.color}/>)}</Pie><Tooltip contentStyle={{ background:"#181c27", border:"1px solid "+bd, borderRadius:6, fontSize:10, color:t1 }} formatter={(v,n)=>[v+"条",n]} /></PieChart></ResponsiveContainer></div>
              <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                {sentData.map((d,i)=><div key={i} style={{ display:"flex", alignItems:"center", gap:6 }}><span style={{ width:8, height:8, borderRadius:2, background:d.color }}/><span style={{ fontSize:11, color:t2 }}>{d.name}</span><span style={{ fontSize:12, fontWeight:700, color:d.color, fontFamily:"monospace" }}>{d.value}</span><span style={{ fontSize:10, color:t3 }}>({Math.round(d.value/posts.length*100)}%)</span></div>)}
              </div>
            </div>
          </div>
          <div style={{ background:sf, border:"1px solid "+bd, borderRadius:12, overflow:"hidden", flex:1 }}>
            <div style={{ padding:"12px 16px", borderBottom:"1px solid "+bd, fontWeight:600, fontSize:13 }}>🔵 渠道分布</div>
            <div style={{ padding:"8px 14px", display:"flex", alignItems:"center", gap:16 }}>
              <div style={{ width:120, height:120 }}><ResponsiveContainer><PieChart><Pie data={platData} cx="50%" cy="50%" innerRadius={25} outerRadius={48} dataKey="value" stroke="none">{platData.map((d,i)=><Cell key={i} fill={d.color}/>)}</Pie><Tooltip contentStyle={{ background:"#181c27", border:"1px solid "+bd, borderRadius:6, fontSize:10, color:t1 }} formatter={(v,n)=>[v+"条",n]} /></PieChart></ResponsiveContainer></div>
              <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                {platData.map((d,i)=><div key={i} style={{ display:"flex", alignItems:"center", gap:5 }}><span style={{ width:8, height:8, borderRadius:2, background:d.color }}/><span style={{ fontSize:10.5, color:t2 }}>{d.name}</span><span style={{ fontSize:11, fontWeight:700, color:d.color, fontFamily:"monospace" }}>{d.value}</span></div>)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Daily Growth Chart */}
      <div style={{ background:sf, border:"1px solid "+bd, borderRadius:12, overflow:"hidden", marginBottom:14 }}>
        <div style={{ padding:"12px 16px", borderBottom:"1px solid "+bd, fontWeight:600, fontSize:13 }}>📊 舆情每日增长 <span style={{ fontSize:11, fontWeight:400, color:t3 }}>({dailyData.length}个活跃日)</span></div>
        <div style={{ padding:"12px 16px", height:260 }}>
          <ResponsiveContainer>
            <BarChart data={dailyData} barGap={1} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2333" vertical={false} />
              <XAxis dataKey="name" tick={{ fill:t3, fontSize:10 }} axisLine={{ stroke:bd }} tickLine={false} angle={-35} textAnchor="end" height={50} />
              <YAxis tick={{ fill:t3, fontSize:10 }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
              <Tooltip contentStyle={{ background:"#181c27", border:"1px solid "+bd, borderRadius:6, fontSize:11, color:t1 }} />
              <Bar dataKey="pos" name="正面" stackId="a" fill="#34d399" />
              <Bar dataKey="neu" name="中性" stackId="a" fill="#64748b" />
              <Bar dataKey="neg" name="负面" stackId="a" fill="#f87171" radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Feed */}
      <div style={{ background:sf, border:"1px solid "+bd, borderRadius:12, overflow:"hidden", marginBottom:14 }}>
        <div style={{ padding:"12px 16px", borderBottom:"1px solid "+bd, fontWeight:600, fontSize:13 }}>🔗 动态流 <span style={{ fontSize:11, fontWeight:400, color:t3 }}>{posts.length}条 · 全部附原始链接</span></div>
        <div style={{ display:"flex", gap:4, padding:"8px 14px 0", flexWrap:"wrap" }}>
          {allPlats.map(pp => {
            const cnt = pp==="all"?posts.length:posts.filter(x=>x.p===pp).length;
            return <button key={pp} onClick={()=>setFilter(pp)} style={{ padding:"3px 9px", borderRadius:4, fontSize:10.5, fontWeight:600, cursor:"pointer", border:"1px solid "+(filter===pp?"#60a5fa":"transparent"), background:filter===pp?"rgba(96,165,250,.1)":"transparent", color:filter===pp?"#60a5fa":t3, fontFamily:"inherit" }}>{pp==="all"?"全部":(PN[pp]||pp)} ({cnt})</button>;
          })}
        </div>
        <div style={{ maxHeight:500, overflowY:"auto", padding:"8px 14px 12px", display:"flex", flexDirection:"column", gap:7 }}>
          {list.map((f,i) => (
            <div key={i} style={{ background:bg, border:"1px solid "+(f._new?bdH:bd), borderRadius:7, padding:"9px 11px", borderLeft:f._new?"3px solid #60a5fa":"3px solid transparent" }}>
              <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:4 }}>
                <span style={{ fontSize:10, fontWeight:700, padding:"2px 5px", borderRadius:3, background:(C[f.p]||"#64748b")+"1e", color:C[f.p]||t2 }}>{PN[f.p]||f.p}</span>
                <span style={{ fontSize:11.5, fontWeight:500, color:t2 }}>{f.u}</span>
                {f._new && <span style={{ fontSize:9, fontWeight:700, color:"#60a5fa", background:"rgba(96,165,250,.1)", padding:"1px 5px", borderRadius:3 }}>NEW</span>}
                <span style={{ fontSize:10, color:t3, marginLeft:"auto" }}>{f.d}</span>
              </div>
              <div style={{ fontSize:12.5, color:t1, lineHeight:1.5, marginBottom:5 }}>{f.t}</div>
              <div style={{ display:"flex", alignItems:"center", gap:5, flexWrap:"wrap" }}>
                <Badge type={f.s}>{SN[f.s]||f.s}</Badge>
                {f.l && <span style={{ fontSize:9.5, padding:"1px 5px", borderRadius:3, background:"#181c27", color:t3 }}>{f.l}</span>}
                <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ marginLeft:"auto", fontSize:10, color:"#60a5fa", textDecoration:"none", background:"rgba(96,165,250,.08)", padding:"2px 7px", borderRadius:3, fontWeight:500 }}>🔗 来源</a>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ textAlign:"center", padding:"12px 0", fontSize:9.5, color:t3 }}>
        Roco Kingdom: World Overseas Sentinel · {posts.length}条海外验证数据 · 覆盖英/日/泰/越/印尼语
      </div>
    </div>
  );
}
