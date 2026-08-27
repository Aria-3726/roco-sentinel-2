import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import postsData from "./data/posts.json";
import issuesData from "./data/issues.json";
import meta from "./data/meta.json";
import rosterFallback from "./data/roster-summary.json";

const PLATFORM = { x:"X", reddit:"Reddit", youtube:"YouTube", tiktok:"TikTok", instagram:"Instagram", twitch:"Twitch", media:"媒体", website:"网站" };
const PLATFORM_COLOR = { x:"#111827", reddit:"#f4511e", youtube:"#ef4444", tiktok:"#111827", instagram:"#db2777", twitch:"#7c3aed", media:"#6366f1", website:"#0f766e" };
const TYPE = { paid_kol:"商单 KOL", media:"媒体", platform:"平台", koc:"KOC", official:"官方", organic:"自然传播" };
const TYPE_COLOR = { paid_kol:"#7c3aed", media:"#2563eb", platform:"#0f766e", koc:"#d97706", official:"#db2777", organic:"#64748b" };
const LANG = { en:"英语", ja:"日语", zh:"中文", ko:"韩语", de:"德语", fr:"法语", es:"西班牙语", it:"意大利语", pt:"葡萄牙语" };

const fmt = (value) => {
  const n = Number(value || 0);
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString("zh-CN");
};

function mapPost(row) {
  return {
    p: row.platform, u: row.author_name || (row.author_handle ? `@${row.author_handle}` : "未知账号"),
    t: row.body || row.title || "", d: row.published_at ? String(row.published_at).slice(0, 10) : "",
    s: row.sentiment || "neu", l: LANG[row.language] || row.language || "未知",
    url: row.canonical_url, listType: row.list_type || "organic",
    stats: { views:Number(row.views || 0), likes:Number(row.likes || 0), comments:Number(row.comments || 0), shares:Number(row.shares || 0) },
    isNew: row.first_seen_at ? Date.now() - new Date(row.first_seen_at).getTime() < 36 * 3600 * 1000 : false,
  };
}

function Card({ children, className="" }) { return <section className={`card ${className}`}>{children}</section>; }
function Metric({ label, value, note, tone="blue" }) {
  return <Card className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></Card>;
}
function Chip({ children, color="#64748b" }) { return <span className="chip" style={{ color, background:`${color}14`, borderColor:`${color}28` }}>{children}</span>; }
function Empty({ children }) { return <div className="empty">{children}</div>; }

export default function App() {
  const [tab, setTab] = useState("overview");
  const [dbPosts, setDbPosts] = useState([]);
  const [dbMeta, setDbMeta] = useState(null);
  const [roster, setRoster] = useState(rosterFallback);
  const [platformFilter, setPlatformFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    Promise.allSettled([
      fetch("/api/posts?limit=1000").then(r => r.ok ? r.json() : Promise.reject()),
      fetch("/api/summary").then(r => r.ok ? r.json() : Promise.reject()),
      fetch("/api/roster-summary").then(r => r.ok ? r.json() : Promise.reject()),
    ]).then(([postsResult, summaryResult, rosterResult]) => {
      if (!alive) return;
      if (postsResult.status === "fulfilled") setDbPosts((postsResult.value.posts || []).map(mapPost));
      if (summaryResult.status === "fulfilled") setDbMeta(summaryResult.value);
      if (rosterResult.status === "fulfilled" && rosterResult.value.total_creators > 0) setRoster(rosterResult.value);
    });
    return () => { alive = false; };
  }, []);

  const posts = useMemo(() => {
    const merged = new Map(postsData.map(item => [item.url, { ...item, listType:item.listType || "organic", isNew:false }]));
    dbPosts.forEach(item => merged.set(item.url, { ...merged.get(item.url), ...item }));
    return [...merged.values()];
  }, [dbPosts]);

  const organic = posts.filter(item => item.listType === "organic");
  const rosterPosts = posts.filter(item => item.listType !== "organic");
  const totalViews = posts.reduce((sum, item) => sum + Number(item.stats?.views || 0), 0);
  const totalEngagement = posts.reduce((sum, item) => sum + Number(item.stats?.likes || 0) + Number(item.stats?.comments || 0) + Number(item.stats?.shares || 0), 0);
  const lastScan = dbMeta?.last_scan || meta.lastScan;
  const lastScanText = lastScan ? new Date(lastScan).toLocaleString("zh-CN", { timeZone:"Asia/Shanghai", month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:false }) : "等待首次扫描";

  const trend = useMemo(() => {
    const map = {};
    posts.forEach(item => {
      if (!item.d) return;
      map[item.d] ||= { date:item.d, posts:0, views:0, organic:0, roster:0 };
      map[item.d].posts += 1;
      map[item.d].views += Number(item.stats?.views || 0);
      map[item.d][item.listType === "organic" ? "organic" : "roster"] += 1;
    });
    return Object.values(map).sort((a,b) => a.date.localeCompare(b.date)).slice(-21).map(item => ({ ...item, label:item.date.slice(5) }));
  }, [posts]);

  const platformData = useMemo(() => {
    const map = {};
    posts.forEach(item => { map[item.p] = (map[item.p] || 0) + 1; });
    return Object.entries(map).map(([name,count]) => ({ name:PLATFORM[name] || name, count })).sort((a,b) => b.count - a.count);
  }, [posts]);

  const filtered = posts.filter(item => {
    const text = `${item.u} ${item.t}`.toLowerCase();
    return (platformFilter === "all" || item.p === platformFilter)
      && (typeFilter === "all" || item.listType === typeFilter)
      && (!query || text.includes(query.toLowerCase()));
  }).sort((a,b) => (b.d || "").localeCompare(a.d || ""));

  const statusTotal = (roster.by_status || []).reduce((sum, item) => sum + Number(item.count), 0) || 1;
  const tabItems = [
    ["overview", "传播总览"], ["execution", "名单执行"], ["organic", "自然声量"], ["feed", "内容明细"],
  ];

  return <main>
    <style>{`
      :root{font-family:Inter,"Noto Sans SC",system-ui,sans-serif;color:#14213d;background:#f4f7fb;font-synthesis:none}
      *{box-sizing:border-box} body{margin:0} button,input{font:inherit} a{color:inherit}
      main{min-height:100vh;background:linear-gradient(180deg,#edf5ff 0,#f7f9fc 300px)}
      .hero{background:radial-gradient(circle at 85% 15%,#8b5cf680,transparent 32%),linear-gradient(125deg,#0f3d73,#2367a6 56%,#0f766e);color:white;padding:28px max(24px,calc((100vw - 1380px)/2)) 82px}
      .heroTop,.row,.between{display:flex;align-items:center}.heroTop,.between{justify-content:space-between}.brand{display:flex;gap:14px;align-items:center}.logo{width:50px;height:50px;border-radius:15px;display:grid;place-items:center;background:#ffffff20;border:1px solid #ffffff40;font-weight:900}.brand h1{font-size:21px;margin:0}.brand p{font-size:12px;margin:4px 0 0;color:#dbeafe}.live{font-size:12px;padding:8px 12px;border:1px solid #ffffff30;border-radius:99px;background:#ffffff14}.live i{display:inline-block;width:8px;height:8px;border-radius:50%;background:#86efac;margin-right:7px;box-shadow:0 0 0 5px #86efac25}
      .wrap{max-width:1380px;margin:-56px auto 0;padding:0 24px 48px}.tabs{display:flex;gap:6px;background:#fff;border:1px solid #e2e8f0;padding:6px;border-radius:14px;box-shadow:0 12px 35px #164e6315;margin-bottom:16px;overflow:auto}.tabs button{border:0;background:transparent;color:#64748b;padding:10px 16px;border-radius:10px;cursor:pointer;white-space:nowrap;font-weight:650}.tabs button.active{color:#0f4c81;background:#e7f2ff}
      .grid{display:grid;gap:14px}.metrics{grid-template-columns:repeat(5,1fr);margin-bottom:14px}.two{grid-template-columns:1.35fr 1fr}.three{grid-template-columns:repeat(3,1fr)}.card{background:#fff;border:1px solid #e1e8f0;border-radius:16px;box-shadow:0 7px 24px #3341550a;overflow:hidden}.metric{padding:17px 18px;border-top:3px solid #3b82f6}.metric.purple{border-top-color:#8b5cf6}.metric.green{border-top-color:#10b981}.metric.orange{border-top-color:#f59e0b}.metric.slate{border-top-color:#64748b}.metric span{display:block;font-size:11px;color:#64748b;font-weight:700}.metric strong{display:block;font-size:27px;margin:7px 0 4px;letter-spacing:-1px}.metric small{color:#94a3b8;font-size:10px}.head{padding:16px 18px;border-bottom:1px solid #eef2f7}.head h2{font-size:14px;margin:0}.head p{font-size:11px;color:#94a3b8;margin:4px 0 0}.pad{padding:18px}.chart{height:300px}.privacy{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;background:#effaf6;border:1px solid #cceee1;border-radius:13px;color:#0f5f4b;margin-bottom:14px}.privacy strong{font-size:12px}.privacy p{font-size:11px;margin:3px 0 0;color:#438273}
      .bars{display:flex;flex-direction:column;gap:10px}.barLabel{display:flex;justify-content:space-between;font-size:11px;margin-bottom:5px}.barLabel span{color:#64748b}.track{height:8px;background:#eef2f7;border-radius:99px;overflow:hidden}.fill{height:100%;border-radius:99px;background:linear-gradient(90deg,#3b82f6,#8b5cf6)}
      .list{display:flex;flex-direction:column}.listRow{display:grid;grid-template-columns:minmax(160px,1.2fr) .7fr 1fr 100px;gap:12px;align-items:center;padding:13px 18px;border-bottom:1px solid #f0f3f7;font-size:12px}.listRow:last-child{border-bottom:0}.listRow strong{font-size:12px}.muted{color:#94a3b8}.chip{display:inline-flex;border:1px solid;padding:3px 8px;border-radius:99px;font-size:10px;font-weight:750;white-space:nowrap}.feed{display:flex;flex-direction:column;gap:9px}.post{padding:14px 16px;border:1px solid #e9eef4;border-radius:13px;background:#fbfdff}.post.new{border-left:4px solid #3b82f6;background:#f6faff}.postTop{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.postTop strong{font-size:12px}.postTop time{margin-left:auto;font-size:10px;color:#94a3b8}.post p{font-size:12px;line-height:1.65;margin:9px 0;color:#334155}.postFoot{display:flex;align-items:center;gap:12px;font-size:10px;color:#64748b}.postFoot a{margin-left:auto;color:#2563eb;text-decoration:none;font-weight:700}.filters{display:flex;gap:8px;flex-wrap:wrap;padding:12px 18px;border-bottom:1px solid #eef2f7}.filters select,.filters input{border:1px solid #dbe3ed;background:white;border-radius:9px;padding:8px 10px;font-size:11px;color:#475569}.filters input{min-width:230px}.issue{padding:12px 0;border-bottom:1px solid #eef2f7}.issue:last-child{border:0}.issue strong{font-size:12px}.issue p{font-size:11px;color:#64748b;line-height:1.6;margin:5px 0}.empty{padding:40px;text-align:center;color:#94a3b8;font-size:12px}.foot{text-align:center;color:#94a3b8;font-size:10px;margin-top:20px}
      @media(max-width:1000px){.metrics{grid-template-columns:repeat(2,1fr)}.two,.three{grid-template-columns:1fr}.heroTop{align-items:flex-start;gap:16px;flex-direction:column}.listRow{grid-template-columns:1fr 1fr}.listRow>:last-child{text-align:right}}
      @media(max-width:600px){.hero{padding-left:18px;padding-right:18px}.wrap{padding:0 12px 35px}.metrics{grid-template-columns:1fr 1fr}.metric{padding:14px}.metric strong{font-size:23px}.live{display:none}.filters input{min-width:100%;width:100%}.listRow{grid-template-columns:1fr}.listRow>:last-child{text-align:left}}
    `}</style>

    <header className="hero">
      <div className="heroTop">
        <div className="brand"><div className="logo">RK</div><div><h1>Roco Kingdom 海外传播哨塔</h1><p>商单执行、媒体释出、KOC 与自然声量统一监测</p></div></div>
        <div className="live"><i />数据库在线 · 北京时间 {lastScanText} 更新</div>
      </div>
    </header>

    <div className="wrap">
      <nav className="tabs">{tabItems.map(([key,label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}</nav>

      {tab === "overview" && <>
        <div className="grid metrics">
          <Metric label="名单条目" value={fmt(roster.total_creators)} note={`${fmt(roster.total_accounts)} 个可匹配账号`} />
          <Metric label="已采集内容" value={fmt(posts.length)} note={`${fmt(dbMeta?.total_posts || dbPosts.length)} 条来自实时数据库`} tone="purple" />
          <Metric label="名单内发布" value={fmt(rosterPosts.length)} note="按账号自动归类" tone="green" />
          <Metric label="自然传播" value={fmt(organic.length)} note="名单外自发内容" tone="orange" />
          <Metric label="累计播放" value={fmt(totalViews)} note={`${fmt(totalEngagement)} 次互动`} tone="slate" />
        </div>
        <div className="privacy"><span>🔒</span><div><strong>商业数据保持私有</strong><p>报价、联系人、邮箱、Discord 与供应商备注仅存于数据库，不通过公开接口或网页返回。</p></div></div>
        <div className="grid two">
          <Card><div className="head"><h2>21 日传播趋势</h2><p>名单内释出与自然传播分层观察</p></div><div className="pad chart"><ResponsiveContainer><AreaChart data={trend}><defs><linearGradient id="organic" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/><stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/></linearGradient><linearGradient id="roster" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/><stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#edf1f6" vertical={false}/><XAxis dataKey="label" tick={{fontSize:10,fill:"#94a3b8"}} axisLine={false} tickLine={false}/><YAxis tick={{fontSize:10,fill:"#94a3b8"}} axisLine={false} tickLine={false}/><Tooltip/><Area type="monotone" dataKey="organic" name="自然传播" stroke="#f59e0b" fill="url(#organic)"/><Area type="monotone" dataKey="roster" name="名单内" stroke="#3b82f6" fill="url(#roster)"/></AreaChart></ResponsiveContainer></div></Card>
          <Card><div className="head"><h2>渠道采集分布</h2><p>当前内容库的平台构成</p></div><div className="pad chart"><ResponsiveContainer><BarChart data={platformData} layout="vertical"><CartesianGrid stroke="#edf1f6" horizontal={false}/><XAxis type="number" tick={{fontSize:10,fill:"#94a3b8"}} axisLine={false}/><YAxis dataKey="name" type="category" width={72} tick={{fontSize:10,fill:"#64748b"}} axisLine={false} tickLine={false}/><Tooltip/><Bar dataKey="count" name="内容数" fill="#3b82f6" radius={[0,5,5,0]}/></BarChart></ResponsiveContainer></div></Card>
        </div>
      </>}

      {tab === "execution" && <>
        <div className="grid metrics">
          {(roster.by_list_type || []).map((item,index) => <Metric key={item.name} label={TYPE[item.name] || item.name} value={fmt(item.count)} note={index === 0 ? "已导入私有名单" : "按来源表去重账号"} tone={["blue","purple","orange","green"][index % 4]} />)}
          <Metric label="表内已填发布链接" value={fmt(roster.published_creators)} note="草稿与排期不计发布" tone="green" />
        </div>
        <div className="grid two">
          <Card><div className="head"><h2>建联与执行状态</h2><p>仅展示聚合数量，不展示联系人与报价</p></div><div className="pad bars">{(roster.by_status || []).map(item => <div key={item.name}><div className="barLabel"><span>{item.name}</span><b>{fmt(item.count)}</b></div><div className="track"><div className="fill" style={{width:`${Math.max(2, Number(item.count) / statusTotal * 100)}%`}}/></div></div>)}</div></Card>
          <Card><div className="head"><h2>可监测平台账号</h2><p>一位创作者可对应多个平台</p></div><div className="list">{(roster.by_platform || []).map(item => <div className="listRow" key={item.name}><strong>{PLATFORM[item.name] || item.name}</strong><span className="muted">账号</span><span><Chip color={PLATFORM_COLOR[item.name]}>{TYPE.koc} / KOL / 媒体</Chip></span><b>{fmt(item.count)}</b></div>)}</div></Card>
        </div>
      </>}

      {tab === "organic" && <>
        <div className="grid metrics"><Metric label="自然发布" value={fmt(organic.length)} note="已排除名单内账号" tone="orange"/><Metric label="覆盖平台" value={new Set(organic.map(item => item.p)).size} note="公开可检索来源"/><Metric label="自然播放" value={fmt(organic.reduce((s,p) => s + Number(p.stats?.views || 0),0))} note="平台返回的公开数据" tone="purple"/><Metric label="新增内容" value={organic.filter(item => item.isNew).length} note="最近 36 小时首次发现" tone="green"/></div>
        <div className="grid two"><Card><div className="head"><h2>自然声量趋势</h2><p>每日自发发布数量</p></div><div className="pad chart"><ResponsiveContainer><AreaChart data={trend}><CartesianGrid stroke="#edf1f6" vertical={false}/><XAxis dataKey="label" tick={{fontSize:10,fill:"#94a3b8"}} axisLine={false}/><YAxis tick={{fontSize:10,fill:"#94a3b8"}} axisLine={false}/><Tooltip/><Area type="monotone" dataKey="organic" name="自然发布" stroke="#f59e0b" fill="#fef3c7"/></AreaChart></ResponsiveContainer></div></Card><Card><div className="head"><h2>重点风险与议题</h2><p>基于当前样本的人工复核线索</p></div><div className="pad">{issuesData.length ? issuesData.map((item,index) => <div className="issue" key={index}><strong>{item.title}</strong><p>{item.desc}</p><Chip color={item.sev === "critical" ? "#dc2626" : "#d97706"}>{item.sev === "critical" ? "需响应" : "持续关注"}</Chip></div>) : <Empty>当前没有需要提示的议题</Empty>}</div></Card></div>
      </>}

      {tab === "feed" && <Card>
        <div className="head"><h2>内容明细</h2><p>名单内与名单外统一查看，支持来源跳转</p></div>
        <div className="filters"><select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}><option value="all">全部类型</option>{Object.entries(TYPE).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select><select value={platformFilter} onChange={e => setPlatformFilter(e.target.value)}><option value="all">全部平台</option>{[...new Set(posts.map(item => item.p))].map(key => <option key={key} value={key}>{PLATFORM[key] || key}</option>)}</select><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索账号或内容关键词"/><span className="muted">{filtered.length} 条</span></div>
        <div className="pad feed">{filtered.length ? filtered.map((item,index) => <article className={`post ${item.isNew ? "new" : ""}`} key={`${item.url}-${index}`}><div className="postTop"><Chip color={PLATFORM_COLOR[item.p]}>{PLATFORM[item.p] || item.p}</Chip><Chip color={TYPE_COLOR[item.listType]}>{TYPE[item.listType] || item.listType}</Chip><strong>{item.u}</strong>{item.isNew && <Chip color="#2563eb">NEW</Chip>}<time>{item.d || "日期待复核"}</time></div><p>{item.t}</p><div className="postFoot"><span>👁 {fmt(item.stats?.views)}</span><span>👍 {fmt(item.stats?.likes)}</span><span>💬 {fmt(item.stats?.comments)}</span><span>{item.l}</span><a href={item.url} target="_blank" rel="noreferrer">查看来源 ↗</a></div></article>) : <Empty>没有符合当前筛选条件的内容</Empty>}</div>
      </Card>}

      <div className="foot">Roco Kingdom Overseas Sentinel · 每日增量采集 · 商业字段不公开</div>
    </div>
  </main>;
}
