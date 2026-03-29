import { useState, useMemo } from "react";
import { ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import postsData from "./data/posts.json";
import issuesData from "./data/issues.json";
import meta from "./data/meta.json";

// 配置常量
const C = { pos:'#34d399', neg:'#f87171', neu:'#64748b', x:'#60a5fa', reddit:'#fbbf24', youtube:'#f87171', tiktok:'#f472b6', instagram:'#e879f9', facebook:'#60a5fa', media:'#a78bfa', forum:'#22d3ee', threads:'#22d3ee' };
const PN = { x:'𝕏', reddit:'Reddit', youtube:'YouTube', tiktok:'TikTok', instagram:'Instagram', facebook:'Facebook', media:'媒体', forum:'论坛', threads:'Threads' };
const SN = { pos:'正面', neg:'负面', neu:'中性' };
const bg='#0a0c10', sf='#12151c', bd='#252b3b', bdH='#3a4560', t1='#e4e8f1', t2='#8e99b3', t3='#5a6580';

export default function App() {
  const posts = postsData;
  const issues = issuesData;
  const [filter, setFilter] = useState("all");

  // 格式化上次扫描时间
  const lastScanText = useMemo(() => {
    if (!meta.lastScan) return '未知';
    try {
      const d = new Date(meta.lastScan);
      return d.toLocaleString('zh-CN', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false });
    } catch { return meta.lastScan; }
  }, []);

  // Computed
  const posN = posts.filter(x => x.s === "pos").length;
  const negN = posts.filter(x => x.s === "neg").length;
  const neuN = posts.filter(x => x.s === "neu").length;
  const sentData = [{ name: "正面", value: posN, color: C.pos }, { name: "中性", value: neuN, color: C.neu }, { name: "负面", value: negN, color: C.neg }].filter(x => x.value > 0);
  const platMap = {}; posts.forEach(x => { platMap[x.p] = (platMap[x.p] || 0) + 1; });
  const platData = Object.entries(platMap).map(([k, v]) => ({ name: PN[k] || k, value: v, color: C[k] || "#64748b" })).sort((a, b) => b.value - a.value);

  // Language distribution
  const LC = { '英语':'#60a5fa', '中文':'#f87171', '日语':'#f472b6', '泰语':'#fbbf24', '印尼语':'#34d399', '越南语':'#a78bfa', '韩语':'#22d3ee', '西班牙语':'#fb923c', '德语':'#64748b' };
  const langMap = {}; posts.forEach(x => { const l = x.l || '未知'; langMap[l] = (langMap[l] || 0) + 1; });
  const langData = Object.entries(langMap).map(([k, v]) => ({ name: k, value: v, color: LC[k] || "#64748b" })).sort((a, b) => b.value - a.value);
  const allPlats = ["all", ...Object.keys(platMap)];
  const list = (filter === "all" ? posts : posts.filter(x => x.p === filter)).sort((a, b) => (b.d || "0").localeCompare(a.d || "0"));

  // Daily growth
  const dailyMap = {};
  posts.forEach(x => { if (!x.d) return; if (!dailyMap[x.d]) dailyMap[x.d] = { date: x.d, total: 0, pos: 0, neg: 0, neu: 0 }; dailyMap[x.d].total++; dailyMap[x.d][x.s]++; });
  const dailyData = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)).map(d => ({ name: d.date.slice(5), ...d }));

  const Badge = ({ type, children }) => {
    const m = { pos:[C.pos,"rgba(52,211,153,.1)"], neg:[C.neg,"rgba(248,113,113,.1)"], neu:[C.neu,"rgba(100,116,139,.12)"], critical:[C.neg,"rgba(248,113,113,.1)"], warning:["#fbbf24","rgba(251,191,36,.1)"], watch:[C.x,"rgba(96,165,250,.1)"] };
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
          <div style={{ background:sf, border:"1px solid "+bd, borderRadius:7, padding:"4px 10px", fontSize:11, color:t3 }}>
            📡 上次更新: {lastScanText} {meta.scanCount > 0 && <span>· 已扫描{meta.scanCount}次</span>}
          </div>
        </div>
      </div>

      {/* Methodology */}
      <div style={{ background:sf, border:"1px solid "+bd, borderRadius:9, padding:"9px 14px", marginBottom:14, fontSize:10.5, color:t2, lineHeight:1.6 }}>
        <strong style={{ color:t1 }}>ℹ️ 数据说明</strong> · 共 {posts.length} 条海外平台验证帖子，全部附原始链接。数据由 WorkBuddy Skill 自动采集并推送更新。
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
          {/* 情绪分布 — 横向进度条 + 大号百分比 */}
          <div style={{ background:sf, border:"1px solid "+bd, borderRadius:12, overflow:"hidden", flex:1 }}>
            <div style={{ padding:"12px 16px", borderBottom:"1px solid "+bd, fontWeight:600, fontSize:13 }}>🟢 情绪分布 <span style={{ fontSize:11, fontWeight:400, color:t3 }}>({posts.length}条)</span></div>
            <div style={{ padding:"14px 16px", display:"flex", flexDirection:"column", gap:12 }}>
              {sentData.map((d,i) => {
                const pct = Math.round(d.value/posts.length*100);
                return (
                  <div key={i}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:5 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <span style={{ width:8, height:8, borderRadius:2, background:d.color, flexShrink:0 }}/>
                        <span style={{ fontSize:12, fontWeight:600, color:t1 }}>{d.name}</span>
                      </div>
                      <div style={{ display:"flex", alignItems:"baseline", gap:4 }}>
                        <span style={{ fontSize:20, fontWeight:700, color:d.color, fontFamily:"monospace" }}>{pct}%</span>
                        <span style={{ fontSize:10, color:t3 }}>({d.value}条)</span>
                      </div>
                    </div>
                    <div style={{ height:6, background:bg, borderRadius:3, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:pct+"%", background:d.color, borderRadius:3, transition:"width 0.5s ease" }}/>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 渠道分布 — 横向柱状图 */}
          <div style={{ background:sf, border:"1px solid "+bd, borderRadius:12, overflow:"hidden", flex:1 }}>
            <div style={{ padding:"12px 16px", borderBottom:"1px solid "+bd, fontWeight:600, fontSize:13 }}>🔵 渠道分布 <span style={{ fontSize:11, fontWeight:400, color:t3 }}>({Object.keys(platMap).length}个平台)</span></div>
            <div style={{ padding:"10px 16px", display:"flex", flexDirection:"column", gap:6 }}>
              {platData.map((d,i) => {
                const maxVal = platData[0]?.value || 1;
                const barPct = Math.round(d.value/maxVal*100);
                return (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:10, color:t2, width:62, textAlign:"right", flexShrink:0, fontWeight:500 }}>{d.name}</span>
                    <div style={{ flex:1, height:14, background:bg, borderRadius:3, overflow:"hidden", position:"relative" }}>
                      <div style={{ height:"100%", width:barPct+"%", background:d.color, borderRadius:3, minWidth:2, transition:"width 0.5s ease" }}/>
                    </div>
                    <span style={{ fontSize:11, fontWeight:700, color:d.color, fontFamily:"monospace", width:28, textAlign:"right", flexShrink:0 }}>{d.value}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 语种分布 — 横向柱状图 */}
          <div style={{ background:sf, border:"1px solid "+bd, borderRadius:12, overflow:"hidden", flex:1 }}>
            <div style={{ padding:"12px 16px", borderBottom:"1px solid "+bd, fontWeight:600, fontSize:13 }}>🌐 语种分布 <span style={{ fontSize:11, fontWeight:400, color:t3 }}>({langData.length}种语言)</span></div>
            <div style={{ padding:"10px 16px", display:"flex", flexDirection:"column", gap:6 }}>
              {langData.map((d,i) => {
                const maxVal = langData[0]?.value || 1;
                const barPct = Math.round(d.value/maxVal*100);
                return (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:10, color:t2, width:52, textAlign:"right", flexShrink:0, fontWeight:500 }}>{d.name}</span>
                    <div style={{ flex:1, height:14, background:bg, borderRadius:3, overflow:"hidden", position:"relative" }}>
                      <div style={{ height:"100%", width:barPct+"%", background:d.color, borderRadius:3, minWidth:2, transition:"width 0.5s ease" }}/>
                    </div>
                    <span style={{ fontSize:11, fontWeight:700, color:d.color, fontFamily:"monospace", width:28, textAlign:"right", flexShrink:0 }}>{d.value}</span>
                  </div>
                );
              })}
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
                <span style={{ fontSize:10, color:f.d?t3:'#fbbf24', marginLeft:"auto" }}>{f.d || '日期未知'}</span>
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
        Roco Kingdom: World Overseas Sentinel · {posts.length}条海外验证数据 · 覆盖英/日/泰/越/印尼语 · Powered by WorkBuddy Skill
      </div>
    </div>
  );
}
