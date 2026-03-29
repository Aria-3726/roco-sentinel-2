import { useState, useMemo } from "react";
import { ResponsiveContainer, Tooltip, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import postsData from "./data/posts.json";
import issuesData from "./data/issues.json";
import meta from "./data/meta.json";

/* ─── 洛克王国画风配色 ─── */
const C = {
  pos:'#43a047', neg:'#e53935', neu:'#78909c',
  x:'#1d9bf0', reddit:'#ff6d00', youtube:'#ff0000', tiktok:'#e040fb', instagram:'#e91e63',
  facebook:'#1877f2', media:'#7c4dff', forum:'#00bcd4', threads:'#424242'
};
const PN = { x:'𝕏', reddit:'Reddit', youtube:'YouTube', tiktok:'TikTok', instagram:'Instagram', facebook:'Facebook', media:'媒体', forum:'论坛', threads:'Threads' };
const SN = { pos:'正面', neg:'负面', neu:'中性' };
const LC = { '英语':'#1d9bf0', '中文':'#e53935', '日语':'#e040fb', '泰语':'#ff9800', '印尼语':'#43a047', '越南语':'#7c4dff', '韩语':'#00bcd4', '西班牙语':'#ff6d00', '德语':'#78909c' };

/* ─── 全局样式 token ─── */
const T = {
  bg: '#f0f7ff',            // 淡天蓝背景
  card: '#ffffff',          // 白色卡片
  cardAlt: '#f8fbff',       // 浅蓝卡片
  border: '#d6e4f0',        // 淡蓝灰边框
  borderLight: '#e8f0fe',
  hero: 'linear-gradient(135deg, #42a5f5 0%, #7e57c2 50%, #66bb6a 100%)', // 天蓝→紫→绿
  accent: '#42a5f5',        // 天蓝主色
  accent2: '#66bb6a',       // 草绿辅色
  accent3: '#ffb74d',       // 暖橙点缀
  t1: '#1a237e',            // 深蓝文字
  t2: '#546e7a',            // 灰蓝二级文字
  t3: '#90a4ae',            // 浅灰三级
  radius: 16,
  radiusSm: 10,
  shadow: '0 2px 12px rgba(66,165,245,0.08)',
  shadowHover: '0 4px 20px rgba(66,165,245,0.15)',
  font: "'Noto Sans SC', system-ui, -apple-system, sans-serif",
};

export default function App() {
  const posts = postsData;
  const issues = issuesData;
  const [filter, setFilter] = useState("all");
  const [langFilter, setLangFilter] = useState("all");

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
  const sentData = [{ name:"正面", value:posN, color:C.pos }, { name:"中性", value:neuN, color:C.neu }, { name:"负面", value:negN, color:C.neg }].filter(x => x.value > 0);
  const platMap = {}; posts.forEach(x => { platMap[x.p] = (platMap[x.p]||0)+1; });
  const platData = Object.entries(platMap).map(([k,v]) => ({ name:PN[k]||k, value:v, color:C[k]||"#78909c" })).sort((a,b) => b.value-a.value);
  const langMap = {}; posts.forEach(x => { const l=x.l||'未知'; langMap[l]=(langMap[l]||0)+1; });
  const langData = Object.entries(langMap).map(([k,v]) => ({ name:k, value:v, color:LC[k]||"#78909c" })).sort((a,b) => b.value-a.value);
  const allPlats = ["all", ...Object.keys(platMap)];
  const allLangs = ["all", ...Object.keys(langMap)];
  const list = posts.filter(x => (filter==="all" || x.p===filter) && (langFilter==="all" || x.l===langFilter)).sort((a,b) => (b.d||"0").localeCompare(a.d||"0"));

  const dailyMap = {};
  posts.forEach(x => { if(!x.d) return; if(!dailyMap[x.d]) dailyMap[x.d]={date:x.d,total:0,pos:0,neg:0,neu:0}; dailyMap[x.d].total++; dailyMap[x.d][x.s]++; });
  const dailyData = Object.values(dailyMap).sort((a,b) => a.date.localeCompare(b.date)).map(d => ({ name:d.date.slice(5), ...d }));

  // 每日声量 (帖子数 + 播放量 + 互动量)
  const volumeMap = {};
  posts.forEach(x => {
    if (!x.d) return;
    if (!volumeMap[x.d]) volumeMap[x.d] = { date:x.d, posts:0, views:0, likes:0, comments:0, engagement:0 };
    const v = volumeMap[x.d];
    v.posts++;
    if (x.stats) {
      v.views += (x.stats.views || 0);
      v.likes += (x.stats.likes || 0);
      v.comments += (x.stats.comments || 0);
    }
    v.engagement = v.views + v.likes * 10 + v.comments * 20; // 加权声量
  });
  const volumeData = Object.values(volumeMap).sort((a,b) => a.date.localeCompare(b.date)).map(d => ({ name:d.date.slice(5), ...d }));
  const totalViews = posts.reduce((s,p) => s + (p.stats?.views||0), 0);
  const totalLikes = posts.reduce((s,p) => s + (p.stats?.likes||0), 0);
  const totalComments = posts.reduce((s,p) => s + (p.stats?.comments||0), 0);

  /* ─── 通用组件 ─── */
  const Card = ({ children, style }) => (
    <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:T.radius, boxShadow:T.shadow, overflow:'hidden', ...style }}>{children}</div>
  );
  const CardHeader = ({ icon, title, sub }) => (
    <div style={{ padding:'14px 18px', borderBottom:`1px solid ${T.borderLight}`, display:'flex', alignItems:'center', gap:8 }}>
      <span style={{ fontSize:16 }}>{icon}</span>
      <span style={{ fontWeight:700, fontSize:14, color:T.t1 }}>{title}</span>
      {sub && <span style={{ fontSize:11, color:T.t3, fontWeight:400 }}>{sub}</span>}
    </div>
  );
  const Badge = ({ type, children }) => {
    const m = {
      pos:[C.pos,'#e8f5e9'], neg:[C.neg,'#ffebee'], neu:[C.neu,'#eceff1'],
      critical:[C.neg,'#ffebee'], warning:['#f57f17','#fff8e1'], watch:[T.accent,'#e3f2fd']
    };
    const [fg, bgc] = m[type] || [T.t3, '#f5f5f5'];
    return <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20, color:fg, background:bgc, whiteSpace:'nowrap' }}>{children}</span>;
  };
  const HBar = ({ data, labelWidth=56 }) => (
    <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
      {data.map((d,i) => {
        const maxVal = data[0]?.value || 1;
        const pct = Math.round(d.value/maxVal*100);
        return (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:11, color:T.t2, width:labelWidth, textAlign:'right', flexShrink:0, fontWeight:500 }}>{d.name}</span>
            <div style={{ flex:1, height:18, background:T.bg, borderRadius:20, overflow:'hidden' }}>
              <div style={{ height:'100%', width:pct+'%', background:`linear-gradient(90deg, ${d.color}, ${d.color}cc)`, borderRadius:20, minWidth:4, transition:'width 0.6s ease' }}/>
            </div>
            <span style={{ fontSize:12, fontWeight:700, color:d.color, fontFamily:'monospace', width:30, textAlign:'right', flexShrink:0 }}>{d.value}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ minHeight:'100vh', background:T.bg, color:T.t1, fontFamily:T.font, paddingBottom:40 }}>

      {/* ═══ Hero Header ═══ */}
      <div style={{ background:T.hero, padding:'28px 0 24px', marginBottom:20 }}>
        <div style={{ maxWidth:1360, margin:'0 auto', padding:'0 24px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
            <div style={{ display:'flex', alignItems:'center', gap:14 }}>
              <div style={{ width:48, height:48, borderRadius:14, background:'rgba(255,255,255,0.2)', backdropFilter:'blur(8px)', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:900, fontSize:18, color:'#fff', fontFamily:'monospace', border:'2px solid rgba(255,255,255,0.3)' }}>RK</div>
              <div>
                <div style={{ fontWeight:800, fontSize:20, color:'#fff', letterSpacing:0.5 }}>洛克王国: 世界</div>
                <div style={{ fontSize:12, color:'rgba(255,255,255,0.8)', marginTop:2 }}>海外舆情实时监控 · Overseas Sentinel</div>
              </div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
              <div style={{ background:'rgba(255,255,255,0.15)', backdropFilter:'blur(8px)', border:'1px solid rgba(255,255,255,0.2)', borderRadius:20, padding:'6px 14px', fontSize:11.5, color:'#fff', fontWeight:500 }}>
                📡 {lastScanText} 更新 {meta.scanCount > 0 && <span>· 第{meta.scanCount}次扫描</span>}
              </div>
              <div style={{ background:'rgba(255,255,255,0.15)', backdropFilter:'blur(8px)', border:'1px solid rgba(255,255,255,0.2)', borderRadius:20, padding:'6px 14px', fontSize:11.5, color:'#fff' }}>
                🌏 覆盖 英/日/泰/越/印尼/西 6种语言
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth:1360, margin:'0 auto', padding:'0 24px' }}>

        {/* ═══ KPI Cards ═══ */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:14, marginBottom:18 }}>
          {[
            { label:'已采集帖子', val:posts.length, icon:'📊', color:T.accent, bg:'#e3f2fd' },
            { label:'总播放量', val:totalViews>=1e6?(totalViews/1e6).toFixed(1)+'M':totalViews>=1e3?(totalViews/1e3).toFixed(1)+'K':totalViews, icon:'👁', color:'#7c4dff', bg:'#ede7f6' },
            { label:'活跃议题', val:issues.length, icon:'🔥', color:'#f57f17', bg:'#fff8e1' },
          ].map((k,i) => (
            <Card key={i} style={{ padding:'16px 18px', borderLeft:`4px solid ${k.color}` }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div>
                  <div style={{ fontSize:10, color:T.t3, textTransform:'uppercase', letterSpacing:1.5, fontWeight:600, marginBottom:6 }}>{k.label}</div>
                  <div style={{ fontFamily:'monospace', fontSize:28, fontWeight:800, color:k.color }}>{k.val}</div>
                </div>
                <div style={{ width:42, height:42, borderRadius:12, background:k.bg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20 }}>{k.icon}</div>
              </div>
            </Card>
          ))}
        </div>

        {/* ═══ 三栏分布图: 情绪 + 渠道 + 语种 ═══ */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14, marginBottom:18 }}>
          {/* 情绪分布 */}
          <Card>
            <CardHeader icon="🎭" title="情绪分布" sub={`${posts.length}条`} />
            <div style={{ padding:'16px 18px', display:'flex', flexDirection:'column', gap:14 }}>
              {sentData.map((d,i) => {
                const pct = Math.round(d.value/posts.length*100);
                return (
                  <div key={i}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:6 }}>
                      <span style={{ fontSize:13, fontWeight:600, color:T.t1 }}>{d.name}</span>
                      <div style={{ display:'flex', alignItems:'baseline', gap:4 }}>
                        <span style={{ fontSize:22, fontWeight:800, color:d.color, fontFamily:'monospace' }}>{pct}%</span>
                        <span style={{ fontSize:10, color:T.t3 }}>({d.value})</span>
                      </div>
                    </div>
                    <div style={{ height:8, background:T.bg, borderRadius:20, overflow:'hidden' }}>
                      <div style={{ height:'100%', width:pct+'%', background:`linear-gradient(90deg, ${d.color}, ${d.color}aa)`, borderRadius:20, transition:'width 0.6s ease' }}/>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* 渠道分布 */}
          <Card>
            <CardHeader icon="📱" title="渠道分布" sub={`${Object.keys(platMap).length}个平台`} />
            <div style={{ padding:'12px 18px' }}><HBar data={platData} labelWidth={62} /></div>
          </Card>

          {/* 语种分布 */}
          <Card>
            <CardHeader icon="🌐" title="语种分布" sub={`${langData.length}种语言`} />
            <div style={{ padding:'12px 18px' }}><HBar data={langData} labelWidth={52} /></div>
          </Card>
        </div>

        {/* ═══ 核心议题 + 每日趋势 ═══ */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:18 }}>
          {/* 核心议题 */}
          <Card>
            <CardHeader icon="🚨" title="核心议题追踪" sub={`${issues.length}个`} />
            <div style={{ padding:14, maxHeight:440, overflowY:'auto' }}>
              {issues.map((a,i) => {
                const sevC = a.sev==='critical'?C.neg:a.sev==='warning'?'#f57f17':T.accent;
                return (
                  <div key={i} style={{ background:T.cardAlt, border:`1px solid ${T.borderLight}`, borderRadius:T.radiusSm, padding:13, marginBottom:i<issues.length-1?10:0, borderLeft:`4px solid ${sevC}` }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:6, flexWrap:'wrap' }}>
                      <Badge type={a.sev}>{a.sev==='critical'?'⚡ 需响应':a.sev==='warning'?'👁 关注':'📌 背景'}</Badge>
                      {(a.plats||[]).map((p,j)=><span key={j} style={{ fontSize:9, fontWeight:600, padding:'2px 6px', borderRadius:20, background:'#e8eaf6', color:'#3f51b5' }}>{p}</span>)}
                    </div>
                    <div style={{ fontSize:13, fontWeight:700, color:T.t1, marginBottom:4 }}>{a.title}</div>
                    <div style={{ fontSize:11, color:T.t2, lineHeight:1.6, marginBottom:6 }}>{a.desc}</div>
                    {a.tip && <div style={{ fontSize:10.5, color:'#f57f17', fontWeight:500, background:'#fff8e1', padding:'4px 8px', borderRadius:6, display:'inline-block' }}>💡 {a.tip}</div>}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* 每日趋势 */}
          <Card>
            <CardHeader icon="📈" title="舆情每日趋势" sub={`${dailyData.length}个活跃日`} />
            <div style={{ padding:'12px 16px', height:420 }}>
              <ResponsiveContainer>
                <BarChart data={dailyData} barGap={1} barCategoryGap="18%">
                  <CartesianGrid strokeDasharray="3 3" stroke={T.borderLight} vertical={false} />
                  <XAxis dataKey="name" tick={{ fill:T.t3, fontSize:10 }} axisLine={{ stroke:T.border }} tickLine={false} angle={-35} textAnchor="end" height={50} />
                  <YAxis tick={{ fill:T.t3, fontSize:10 }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
                  <Tooltip contentStyle={{ background:'#fff', border:`1px solid ${T.border}`, borderRadius:8, fontSize:11, color:T.t1, boxShadow:T.shadow }} />
                  <Bar dataKey="pos" name="正面" stackId="a" fill={C.pos} radius={[0,0,0,0]} />
                  <Bar dataKey="neu" name="中性" stackId="a" fill={C.neu} />
                  <Bar dataKey="neg" name="负面" stackId="a" fill={C.neg} radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {/* ═══ 每日声量变化 (全宽) ═══ */}
        <Card style={{ marginBottom:18 }}>
          <CardHeader icon="📢" title="每日声量变化" sub={`播放量 + 互动量 · ${volumeData.length}个活跃日`} />
          <div style={{ padding:'6px 18px 0', display:'flex', gap:16, flexWrap:'wrap' }}>
            <span style={{ fontSize:10, color:T.t2, display:'flex', alignItems:'center', gap:4 }}><span style={{ width:10, height:10, borderRadius:2, background:'#42a5f5' }}/> 播放量</span>
            <span style={{ fontSize:10, color:T.t2, display:'flex', alignItems:'center', gap:4 }}><span style={{ width:10, height:10, borderRadius:2, background:'#66bb6a' }}/> 点赞</span>
            <span style={{ fontSize:10, color:T.t2, display:'flex', alignItems:'center', gap:4 }}><span style={{ width:10, height:10, borderRadius:2, background:'#ffb74d' }}/> 评论</span>
            <span style={{ fontSize:10, color:T.t2, display:'flex', alignItems:'center', gap:4 }}><span style={{ width:10, height:3, borderRadius:2, background:'#e53935' }}/> 帖子数</span>
          </div>
          <div style={{ padding:'8px 16px 16px', height:260 }}>
            <ResponsiveContainer>
              <AreaChart data={volumeData}>
                <defs>
                  <linearGradient id="gViews" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#42a5f5" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#42a5f5" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="gLikes" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#66bb6a" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#66bb6a" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={T.borderLight} vertical={false} />
                <XAxis dataKey="name" tick={{ fill:T.t3, fontSize:10 }} axisLine={{ stroke:T.border }} tickLine={false} angle={-35} textAnchor="end" height={50} />
                <YAxis yAxisId="left" tick={{ fill:T.t3, fontSize:10 }} axisLine={false} tickLine={false} width={50} tickFormatter={v => v>=1e3?(v/1e3).toFixed(0)+'K':v} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill:T.t3, fontSize:10 }} axisLine={false} tickLine={false} width={30} />
                <Tooltip contentStyle={{ background:'#fff', border:`1px solid ${T.border}`, borderRadius:8, fontSize:11, color:T.t1, boxShadow:T.shadow }} formatter={(v,name) => [name==='播放量'?(v>=1e3?(v/1e3).toFixed(1)+'K':v):v, name]} />
                <Area yAxisId="left" type="monotone" dataKey="views" name="播放量" stroke="#42a5f5" strokeWidth={2} fill="url(#gViews)" />
                <Area yAxisId="left" type="monotone" dataKey="likes" name="点赞" stroke="#66bb6a" strokeWidth={2} fill="url(#gLikes)" />
                <Bar yAxisId="right" dataKey="comments" name="评论" fill="#ffb74d" radius={[3,3,0,0]} barSize={14} />
                <Bar yAxisId="right" dataKey="posts" name="帖子数" fill="#e5393580" radius={[3,3,0,0]} barSize={8} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        {/* ═══ 动态流 ═══ */}
        <Card style={{ marginBottom:18 }}>
          <CardHeader icon="🔗" title="动态流" sub={`${list.length}/${posts.length}条 · 全部附原始链接`} />
          <div style={{ padding:'10px 18px 0', display:'flex', flexDirection:'column', gap:6 }}>
            {/* 平台筛选 */}
            <div style={{ display:'flex', gap:5, flexWrap:'wrap', alignItems:'center' }}>
              <span style={{ fontSize:10, color:T.t3, fontWeight:600, marginRight:2 }}>📱 平台</span>
              {allPlats.map(pp => {
                const cnt = pp==='all'?posts.length:posts.filter(x=>x.p===pp).length;
                const active = filter===pp;
                return <button key={pp} onClick={()=>setFilter(pp)} style={{
                  padding:'4px 12px', borderRadius:20, fontSize:11, fontWeight:600, cursor:'pointer',
                  border:`1.5px solid ${active?T.accent:'transparent'}`,
                  background:active?'#e3f2fd':'#f5f7fa', color:active?T.accent:T.t3,
                  fontFamily:'inherit', transition:'all 0.2s'
                }}>{pp==='all'?'全部':(PN[pp]||pp)} ({cnt})</button>;
              })}
            </div>
            {/* 语种筛选 */}
            <div style={{ display:'flex', gap:5, flexWrap:'wrap', alignItems:'center' }}>
              <span style={{ fontSize:10, color:T.t3, fontWeight:600, marginRight:2 }}>🌐 语种</span>
              {allLangs.map(ll => {
                const cnt = ll==='all'?posts.length:posts.filter(x=>x.l===ll).length;
                const active = langFilter===ll;
                const clr = LC[ll] || '#5c6bc0';
                return <button key={ll} onClick={()=>setLangFilter(ll)} style={{
                  padding:'4px 12px', borderRadius:20, fontSize:11, fontWeight:600, cursor:'pointer',
                  border:`1.5px solid ${active?clr:'transparent'}`,
                  background:active?(clr+'18'):'#f5f7fa', color:active?clr:T.t3,
                  fontFamily:'inherit', transition:'all 0.2s'
                }}>{ll==='all'?'全部':ll} ({cnt})</button>;
              })}
            </div>
          </div>
          <div style={{ maxHeight:520, overflowY:'auto', padding:'10px 18px 16px', display:'flex', flexDirection:'column', gap:8 }}>
            {list.map((f,i) => (
              <div key={i} style={{
                background:f._new?'#f3f8ff':T.cardAlt, border:`1px solid ${f._new?'#bbdefb':T.borderLight}`,
                borderRadius:T.radiusSm, padding:'11px 14px', borderLeft:f._new?`4px solid ${T.accent}`:'4px solid transparent',
                transition:'box-shadow 0.2s'
              }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5 }}>
                  <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20, background:(C[f.p]||'#78909c')+'18', color:C[f.p]||T.t2 }}>{PN[f.p]||f.p}</span>
                  <span style={{ fontSize:12, fontWeight:600, color:T.t2 }}>{f.u}</span>
                  {f.author?.followers > 0 && (
                    <span style={{ fontSize:9, padding:'2px 7px', borderRadius:20, background:'#fff3e0', color:'#e65100', fontWeight:600 }} title={f.author.followerLabel==='成员'?'论坛成员数':'订阅/粉丝数'}>
                      {f.author.followerLabel==='成员'?'👥':'🔔'} {f.author.followers>=1e6?(f.author.followers/1e6).toFixed(1)+'M':f.author.followers>=1e3?(f.author.followers/1e3).toFixed(1)+'K':f.author.followers}
                    </span>
                  )}
                  {f.author?.postCount >= 2 && (
                    <span style={{ fontSize:9, padding:'2px 7px', borderRadius:20, background:'#e8f5e9', color:'#2e7d32', fontWeight:700 }} title={`该博主共出现${f.author.postCount}次`}>
                      🔄 频繁×{f.author.postCount}
                    </span>
                  )}
                  {f._new && <span style={{ fontSize:9, fontWeight:700, color:'#fff', background:T.accent, padding:'1px 7px', borderRadius:20 }}>NEW</span>}
                  <span style={{ fontSize:10, color:f.d?T.t3:'#f57f17', marginLeft:'auto' }}>{f.d || '日期未知'}</span>
                </div>
                <div style={{ fontSize:13, color:T.t1, lineHeight:1.6, marginBottom:6 }}>{f.t}</div>
                <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                  <Badge type={f.s}>{SN[f.s]||f.s}</Badge>
                  {f.l && <span style={{ fontSize:9.5, padding:'2px 8px', borderRadius:20, background:'#e8eaf6', color:'#5c6bc0', fontWeight:500 }}>{f.l}</span>}
                  {f.stats && (f.stats.views > 0 || f.stats.likes > 0 || f.stats.comments > 0) && (
                    <span style={{ display:'inline-flex', gap:8, fontSize:10, color:T.t3, marginLeft:4 }}>
                      {f.stats.views > 0 && <span title="播放量/浏览量">👁 {f.stats.views>=1e6?(f.stats.views/1e6).toFixed(1)+'M':f.stats.views>=1e3?(f.stats.views/1e3).toFixed(1)+'K':f.stats.views}</span>}
                      {f.stats.likes > 0 && <span title="点赞/Upvotes">👍 {f.stats.likes>=1e3?(f.stats.likes/1e3).toFixed(1)+'K':f.stats.likes}</span>}
                      {f.stats.comments > 0 && <span title="评论数">💬 {f.stats.comments}</span>}
                    </span>
                  )}
                  <a href={f.url} target="_blank" rel="noopener noreferrer" style={{
                    marginLeft:'auto', fontSize:10.5, color:T.accent, textDecoration:'none',
                    background:'#e3f2fd', padding:'3px 10px', borderRadius:20, fontWeight:600
                  }}>🔗 来源</a>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* ═══ Footer ═══ */}
        <div style={{ textAlign:'center', padding:'16px 0', fontSize:10, color:T.t3 }}>
          🌟 洛克王国: 世界 Overseas Sentinel · {posts.length}条海外验证数据 · Powered by WorkBuddy Skill
        </div>
      </div>
    </div>
  );
}
