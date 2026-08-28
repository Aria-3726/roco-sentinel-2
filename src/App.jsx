import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import archiveData from "./data/posts.json";
import rosterFallback from "./data/roster-summary.json";

const PLATFORM = { x:"X", reddit:"Reddit", youtube:"YouTube", tiktok:"TikTok", instagram:"Instagram", twitch:"Twitch", media:"媒体", website:"网站", forum:"论坛", store:"商店", discord:"Discord", substack:"Substack", facebook:"Facebook", threads:"Threads", taptap:"TapTap" };
const PLATFORM_COLOR = { x:"#111827", reddit:"#f4511e", youtube:"#ef4444", tiktok:"#111827", instagram:"#db2777", twitch:"#7c3aed", media:"#6366f1", website:"#0f766e" };
const TYPE = { paid_kol:"商单 KOL", media:"媒体", platform:"平台", koc:"KOC", third_party:"三方号", official:"官方", organic:"自然传播" };
const TYPE_COLOR = { paid_kol:"#7c3aed", media:"#2563eb", platform:"#0f766e", koc:"#d97706", third_party:"#0891b2", official:"#db2777", organic:"#64748b" };
const LANG = { en:"英语", ja:"日语", zh:"中文", ko:"韩语", de:"德语", fr:"法语", es:"西班牙语", it:"意大利语", pt:"葡萄牙语" };
const COVERAGE_FALLBACK = [
  { source:"youtube_roster", label:"YouTube 名单账号", method:"官方频道上传列表", coverage:"逐账号采集，不依赖标题关键词", level:"高" },
  { source:"youtube", label:"YouTube", method:"官方 Data API", coverage:"每关键词最多3页/150条；最近时间增量", level:"高" },
  { source:"x", label:"X", method:"xAI X Search", coverage:"多轮发现，不等同全量 firehose", level:"中" },
  { source:"x_roster", label:"X 名单账号", method:"逐账号 X Search", coverage:"按账号核验商单与 KOC 发布", level:"中高" },
  { source:"tiktok_web", label:"TikTok", method:"公开网页索引", coverage:"Research API 未配置，短期覆盖有限", level:"低" },
  { source:"tiktok_roster_research", label:"TikTok 名单账号", method:"官方 Research API", coverage:"审批并配置后可按用户名分页采集", level:"高" },
  { source:"tiktok_roster_web", label:"TikTok 名单账号", method:"逐账号公开索引巡检", coverage:"无官方权限时轮询补充，仍可能遗漏", level:"中低" },
  { source:"reddit_web", label:"Reddit", method:"公开网页索引", coverage:"官方 API 未配置", level:"中低" },
  { source:"open_web", label:"媒体/平台网页", method:"xAI Web Search", coverage:"新闻、商店与公开页面发现", level:"中" },
];

const fmt = value => {
  const n = Number(value || 0);
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString("zh-CN");
};
const dateTime = value => value ? new Date(value).toLocaleString("zh-CN", { timeZone:"Asia/Shanghai", month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:false }) : "待首次运行";

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

function mapArchivePost(row, index) {
  const aliases = { "媒体":"media", "网站":"website" };
  return {
    p: aliases[row.p] || row.p || "website", u: row.u || row.channel || "未知账号",
    t: row.t || row.title || row.description || row.snippet || "", d: row.d || row.published_date || "",
    s: row.s || "neu", l: row.l || "未知", url: row.url || `archive-${index}`,
    listType: "organic", stats: row.stats || {}, isNew:false,
  };
}

function Card({ children, className="", style }) { return <section className={`card ${className}`} style={style}>{children}</section>; }
function Metric({ label, value, note, tone="blue" }) { return <Card className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></Card>; }
function Chip({ children, color="#64748b" }) { return <span className="chip" style={{ color, background:`${color}14`, borderColor:`${color}28` }}>{children}</span>; }
function Empty({ children }) { return <div className="empty">{children}</div>; }

export default function App() {
  const [tab, setTab] = useState("overview");
  const [dbPosts, setDbPosts] = useState([]);
  const [dbMeta, setDbMeta] = useState(null);
  const [roster, setRoster] = useState(rosterFallback);
  const [topics, setTopics] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [apiError, setApiError] = useState(false);
  const [scope, setScope] = useState("live");
  const [topicDays, setTopicDays] = useState(7);
  const [platformFilter, setPlatformFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    const load = () => Promise.allSettled([
      fetch("/api/posts?limit=1000").then(r => r.ok ? r.json() : Promise.reject()),
      fetch("/api/summary").then(r => r.ok ? r.json() : Promise.reject()),
      fetch("/api/roster-summary").then(r => r.ok ? r.json() : Promise.reject()),
      fetch("/api/coverage").then(r => r.ok ? r.json() : Promise.reject()),
    ]).then(([postResult, summaryResult, rosterResult, coverageResult]) => {
      if (!alive) return;
      setApiError(postResult.status !== "fulfilled");
      if (postResult.status === "fulfilled") setDbPosts((postResult.value.posts || []).map(mapPost));
      if (summaryResult.status === "fulfilled") setDbMeta(summaryResult.value);
      if (rosterResult.status === "fulfilled" && rosterResult.value.total_creators > 0) setRoster(rosterResult.value);
      if (coverageResult.status === "fulfilled") setCoverage(coverageResult.value);
    });
    load();
    const timer = setInterval(load, 5 * 60 * 1000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  useEffect(() => {
    let alive = true;
    fetch(`/api/topics?days=${topicDays}`).then(r => r.ok ? r.json() : Promise.reject()).then(result => { if (alive) setTopics(result); }).catch(() => { if (alive) setTopics(null); });
    return () => { alive = false; };
  }, [topicDays]);

  const archivePosts = useMemo(() => archiveData.map(mapArchivePost), []);
  const livePosts = dbPosts;
  const posts = scope === "live" ? livePosts : archivePosts;
  const organic = livePosts.filter(item => item.listType === "organic");
  const rosterPosts = livePosts.filter(item => item.listType !== "organic");
  const totalViews = livePosts.reduce((sum, item) => sum + Number(item.stats?.views || 0), 0);
  const totalEngagement = livePosts.reduce((sum, item) => sum + Number(item.stats?.likes || 0) + Number(item.stats?.comments || 0) + Number(item.stats?.shares || 0), 0);
  const lastScanText = dateTime(dbMeta?.last_scan);

  const trend = useMemo(() => {
    const map = {};
    livePosts.forEach(item => {
      if (!item.d) return;
      map[item.d] ||= { date:item.d, posts:0, views:0, organic:0, roster:0 };
      map[item.d].posts += 1;
      map[item.d].views += Number(item.stats?.views || 0);
      map[item.d][item.listType === "organic" ? "organic" : "roster"] += 1;
    });
    return Object.values(map).sort((a,b) => a.date.localeCompare(b.date)).slice(-21).map(item => ({ ...item, label:item.date.slice(5) }));
  }, [livePosts]);

  const platformData = useMemo(() => {
    const map = {};
    livePosts.forEach(item => { map[item.p] = (map[item.p] || 0) + 1; });
    return Object.entries(map).map(([name,count]) => ({ name:PLATFORM[name] || name, count })).sort((a,b) => b.count - a.count);
  }, [livePosts]);

  const typeOptions = useMemo(() => Object.entries(TYPE).map(([key,label]) => ({ key, label, count:posts.filter(item => item.listType === key).length })).filter(item => item.count > 0), [posts]);
  const platformOptions = useMemo(() => [...new Set(posts.map(item => item.p))].filter(Boolean).map(key => ({ key, label:PLATFORM[key] || key, count:posts.filter(item => item.p === key).length })).sort((a,b) => b.count - a.count), [posts]);
  const filtered = posts.filter(item => {
    const text = `${item.u} ${item.t}`.toLowerCase();
    return (platformFilter === "all" || item.p === platformFilter) && (typeFilter === "all" || item.listType === typeFilter) && (!query || text.includes(query.toLowerCase()));
  }).sort((a,b) => (b.d || "").localeCompare(a.d || ""));
  const changeType = value => {
    setTypeFilter(value);
    if (platformFilter !== "all" && value !== "all" && !posts.some(item => item.p === platformFilter && item.listType === value)) setPlatformFilter("all");
  };
  const changePlatform = value => {
    setPlatformFilter(value);
    if (typeFilter !== "all" && value !== "all" && !posts.some(item => item.p === value && item.listType === typeFilter)) setTypeFilter("all");
  };
  const changeScope = value => { setScope(value); setTypeFilter("all"); setPlatformFilter("all"); setQuery(""); };
  const resetFilters = () => { setTypeFilter("all"); setPlatformFilter("all"); setQuery(""); };
  const statusTotal = (roster.by_status || []).reduce((sum, item) => sum + Number(item.count), 0) || 1;
  const sources = coverage?.sources || COVERAGE_FALLBACK;
  const monitoring = roster.monitoring_by_type || [];
  const tabItems = [["overview","传播总览"],["execution","名单执行"],["organic","自然声量"],["feed","内容明细"]];

  return <main>
    <style>{`
      :root{font-family:Inter,"Noto Sans SC",system-ui,sans-serif;color:#14213d;background:#f4f7fb;font-synthesis:none}*{box-sizing:border-box}body{margin:0}button,input,select{font:inherit}a{color:inherit}main{min-height:100vh;background:linear-gradient(180deg,#edf5ff 0,#f7f9fc 300px)}
      .hero{background:radial-gradient(circle at 85% 15%,#8b5cf680,transparent 32%),linear-gradient(125deg,#0f3d73,#2367a6 56%,#0f766e);color:white;padding:28px max(24px,calc((100vw - 1380px)/2)) 82px}.heroTop,.between{display:flex;align-items:center;justify-content:space-between}.brand{display:flex;gap:14px;align-items:center}.logo{width:50px;height:50px;border-radius:15px;display:grid;place-items:center;background:#ffffff20;border:1px solid #ffffff40;font-weight:900}.brand h1{font-size:21px;margin:0}.brand p{font-size:12px;margin:4px 0 0;color:#dbeafe}.live{font-size:12px;padding:8px 12px;border:1px solid #ffffff30;border-radius:99px;background:#ffffff14}.live i{display:inline-block;width:8px;height:8px;border-radius:50%;background:#86efac;margin-right:7px;box-shadow:0 0 0 5px #86efac25}
      .wrap{max-width:1380px;margin:-56px auto 0;padding:0 24px 48px}.tabs{display:flex;gap:6px;background:#fff;border:1px solid #e2e8f0;padding:6px;border-radius:14px;box-shadow:0 12px 35px #164e6315;margin-bottom:16px;overflow:auto}.tabs button{border:0;background:transparent;color:#64748b;padding:10px 16px;border-radius:10px;cursor:pointer;white-space:nowrap;font-weight:650}.tabs button.active{color:#0f4c81;background:#e7f2ff}
      .grid{display:grid;gap:14px}.metrics{grid-template-columns:repeat(5,1fr);margin-bottom:14px}.two{grid-template-columns:1.35fr 1fr}.card{background:#fff;border:1px solid #e1e8f0;border-radius:16px;box-shadow:0 7px 24px #3341550a;overflow:hidden}.metric{padding:17px 18px;border-top:3px solid #3b82f6}.metric.purple{border-top-color:#8b5cf6}.metric.green{border-top-color:#10b981}.metric.orange{border-top-color:#f59e0b}.metric.slate{border-top-color:#64748b}.metric span{display:block;font-size:11px;color:#64748b;font-weight:700}.metric strong{display:block;font-size:27px;margin:7px 0 4px;letter-spacing:-1px}.metric small{color:#94a3b8;font-size:10px}.head{padding:16px 18px;border-bottom:1px solid #eef2f7}.head h2{font-size:14px;margin:0}.head p{font-size:11px;color:#94a3b8;margin:4px 0 0}.pad{padding:18px}.chart{height:300px}.notice{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;background:#fff8e8;border:1px solid #f5dfae;border-radius:13px;color:#8a5700;margin-bottom:14px}.notice.green{background:#effaf6;border-color:#cceee1;color:#0f5f4b}.notice strong{font-size:12px}.notice p{font-size:11px;margin:3px 0 0;color:inherit;opacity:.8}
      .bars{display:flex;flex-direction:column;gap:10px}.barLabel{display:flex;justify-content:space-between;font-size:11px;margin-bottom:5px}.barLabel span{color:#64748b}.track{height:8px;background:#eef2f7;border-radius:99px;overflow:hidden}.fill{height:100%;border-radius:99px;background:linear-gradient(90deg,#3b82f6,#8b5cf6)}.list{display:flex;flex-direction:column}.listRow{display:grid;grid-template-columns:minmax(160px,1.2fr) .7fr 1fr 100px;gap:12px;align-items:center;padding:13px 18px;border-bottom:1px solid #f0f3f7;font-size:12px}.listRow:last-child{border-bottom:0}.listRow strong{font-size:12px}.muted{color:#94a3b8}.chip{display:inline-flex;border:1px solid;padding:3px 8px;border-radius:99px;font-size:10px;font-weight:750;white-space:nowrap}
      .coverage{display:grid;grid-template-columns:110px 150px 1fr 70px 130px;gap:12px;align-items:center;padding:12px 18px;border-bottom:1px solid #eef2f7;font-size:11px}.coverage.header{font-weight:750;color:#64748b;background:#f8fafc}.coverage strong{font-size:11px}.quality.high{color:#0f766e}.quality.medium{color:#b45309}.quality.low{color:#dc2626}
      .topicControls{display:flex;gap:6px}.topicControls button{border:1px solid #dbe3ed;background:#fff;padding:5px 9px;border-radius:8px;color:#64748b;font-size:10px;cursor:pointer}.topicControls button.active{background:#e7f2ff;border-color:#93c5fd;color:#1d4ed8}.topicTable{overflow-x:auto}.topicRow{display:grid;grid-template-columns:220px 90px 230px minmax(360px,1fr) 110px;min-width:1050px}.topicRow>div{padding:14px 12px;border-right:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;font-size:12px;line-height:1.55}.topicRow>div:last-child{border-right:0}.topicRow.header>div{background:#e7f3f8;color:#23415c;font-weight:800;text-align:center}.topicRow strong{font-size:13px}.ratio{height:30px;display:flex;color:white;font-weight:800;text-align:center;line-height:30px}.ratio .neg{background:#e64b4b}.ratio .nonneg{background:#2f8f5b}.samples{display:flex;gap:6px;margin-top:7px;flex-wrap:wrap}.samples a{color:#2563eb;text-decoration:none;font-size:10px}
      .feed{display:flex;flex-direction:column;gap:9px}.post{padding:14px 16px;border:1px solid #e9eef4;border-radius:13px;background:#fbfdff}.post.new{border-left:4px solid #3b82f6;background:#f6faff}.postTop{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.postTop strong{font-size:12px}.postTop time{margin-left:auto;font-size:10px;color:#94a3b8}.post p{font-size:12px;line-height:1.65;margin:9px 0;color:#334155}.postFoot{display:flex;align-items:center;gap:12px;font-size:10px;color:#64748b}.postFoot a{margin-left:auto;color:#2563eb;text-decoration:none;font-weight:700}.filters{display:flex;gap:8px;flex-wrap:wrap;padding:12px 18px;border-bottom:1px solid #eef2f7}.filters select,.filters input,.filters button{border:1px solid #dbe3ed;background:white;border-radius:9px;padding:8px 10px;font-size:11px;color:#475569}.filters input{min-width:230px}.filters button{cursor:pointer;color:#2563eb}.empty{padding:40px;text-align:center;color:#94a3b8;font-size:12px}.foot{text-align:center;color:#94a3b8;font-size:10px;margin-top:20px}
      @media(max-width:1000px){.metrics{grid-template-columns:repeat(2,1fr)}.two{grid-template-columns:1fr}.heroTop{align-items:flex-start;gap:16px;flex-direction:column}.coverage{grid-template-columns:1fr 1fr}.coverage.header{display:none}.listRow{grid-template-columns:1fr 1fr}}
      @media(max-width:600px){.hero{padding-left:18px;padding-right:18px}.wrap{padding:0 12px 35px}.metrics{grid-template-columns:1fr 1fr}.metric{padding:14px}.metric strong{font-size:23px}.live{display:none}.filters input{min-width:100%;width:100%}.coverage,.listRow{grid-template-columns:1fr}}
    `}</style>

    <header className="hero"><div className="heroTop"><div className="brand"><div className="logo">RK</div><div><h1>Roco Kingdom 海外传播哨塔</h1><p>商单执行、媒体释出、KOC 与自然声量统一监测</p></div></div><div className="live"><i />实时数据库 · 北京时间 {lastScanText} 更新</div></div></header>
    <div className="wrap">
      <nav className="tabs">{tabItems.map(([key,label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}</nav>

      {tab === "overview" && <>
        <div className="grid metrics"><Metric label="名单条目" value={fmt(roster.total_creators)} note={`${fmt(roster.total_accounts)} 个可匹配账号`}/><Metric label="实时采集内容" value={fmt(livePosts.length)} note="不再混入5月历史归档" tone="purple"/><Metric label="名单内发布" value={fmt(rosterPosts.length)} note="按账号自动归类" tone="green"/><Metric label="自然传播" value={fmt(organic.length)} note="当前实时库名单外内容" tone="orange"/><Metric label="累计播放" value={fmt(totalViews)} note={`${fmt(totalEngagement)} 次互动`} tone="slate"/></div>
        <div className="notice"><span>⚠️</span><div><strong>“已采集内容”不是全网总量</strong><p>当前 YouTube 覆盖较高；X 为搜索发现样本；TikTok/Reddit 在官方 API 配置前仅覆盖公开网页索引。面板现在明确展示采集边界，不再用旧静态数据抬高总数。</p></div></div>
        {apiError && <div className="notice"><span>⛔</span><div><strong>实时 API 暂不可用</strong><p>当前页面不会用历史归档冒充实时数据，请稍后刷新。</p></div></div>}
        <div className="grid two"><Card><div className="head"><h2>实时传播趋势</h2><p>名单内释出与自然传播 · 最近21个活跃日</p></div><div className="pad chart"><ResponsiveContainer><AreaChart data={trend}><CartesianGrid stroke="#edf1f6" vertical={false}/><XAxis dataKey="label" tick={{fontSize:10,fill:"#94a3b8"}} axisLine={false}/><YAxis tick={{fontSize:10,fill:"#94a3b8"}} axisLine={false}/><Tooltip/><Area type="monotone" dataKey="organic" name="自然传播" stroke="#f59e0b" fill="#fef3c7"/><Area type="monotone" dataKey="roster" name="名单内" stroke="#3b82f6" fill="#dbeafe"/></AreaChart></ResponsiveContainer></div></Card><Card><div className="head"><h2>实时渠道分布</h2><p>仅统计数据库内容</p></div><div className="pad chart"><ResponsiveContainer><BarChart data={platformData} layout="vertical"><CartesianGrid stroke="#edf1f6" horizontal={false}/><XAxis type="number" tick={{fontSize:10,fill:"#94a3b8"}} axisLine={false}/><YAxis dataKey="name" type="category" width={75} tick={{fontSize:10,fill:"#64748b"}} axisLine={false}/><Tooltip/><Bar dataKey="count" name="内容数" fill="#3b82f6" radius={[0,5,5,0]}/></BarChart></ResponsiveContainer></div></Card></div>
        <Card style={{marginTop:14}}><div className="head"><h2>采集覆盖与盲区</h2><p>每个平台的来源、上限和最近运行状态</p></div><div className="coverage header"><span>平台</span><span>采集方式</span><span>覆盖边界</span><span>可信度</span><span>最近运行</span></div>{sources.map(item => { const levelClass=item.level.includes("低")?"low":item.level==="高"?"high":"medium"; return <div className="coverage" key={item.source}><strong>{item.label}</strong><span>{item.method}</span><span className="muted">{item.coverage}</span><b className={`quality ${levelClass}`}>{item.level}</b><span>{item.latest_run ? `${item.latest_run.status} · ${item.latest_run.fetched}条 · ${dateTime(item.latest_run.finished_at)}` : "待首次运行"}</span></div>; })}</Card>
      </>}

      {tab === "execution" && <><div className="grid metrics">{(roster.by_list_type || []).map((item,index)=><Metric key={item.name} label={TYPE[item.name]||item.name} value={fmt(item.count)} note="已导入私有名单" tone={["blue","purple","orange","green"][index%4]}/>) }<Metric label="三方表确认发布" value={`${fmt(roster.seed_posts)} 条`} note={`另有 ${fmt(roster.published_creators)} 个商单主体填发布链接`} tone="green"/></div><div className="notice green"><span>🔒</span><div><strong>商业数据保持私有</strong><p>报价、联系人、邮箱、Discord 与供应商备注仅存于数据库，不通过公开接口或网页返回。</p></div></div><Card style={{marginBottom:14}}><div className="head"><h2>每日名单账号覆盖对账</h2><p>优先监测已确认商单、合作 KOC 与三方运营号；候选池不与每日执行混算</p></div><div className="coverage header"><span>名单类型</span><span>每日账号</span><span>已完成巡检</span><span>运行正常</span><span>最近巡检</span></div>{monitoring.length ? monitoring.map(item=><div className="coverage" key={item.name}><strong>{TYPE[item.name]||item.name}</strong><b>{fmt(item.daily_accounts)}</b><span>{fmt(item.checked_accounts)} / {fmt(item.daily_accounts)}</span><b className={Number(item.healthy_accounts)===Number(item.daily_accounts)?"quality high":"quality medium"}>{fmt(item.healthy_accounts)}</b><span>{dateTime(item.last_checked_at)}</span></div>) : <Empty>名单更新后将在这里显示逐账号覆盖率</Empty>}</Card><div className="grid two"><Card><div className="head"><h2>建联与执行状态</h2><p>仅展示聚合数量</p></div><div className="pad bars">{(roster.by_status||[]).map(item=><div key={item.name}><div className="barLabel"><span>{item.name}</span><b>{fmt(item.count)}</b></div><div className="track"><div className="fill" style={{width:`${Math.max(2,Number(item.count)/statusTotal*100)}%`}}/></div></div>)}</div></Card><Card><div className="head"><h2>可监测平台账号</h2><p>一位创作者可对应多个平台</p></div><div className="list">{(roster.by_platform||[]).map(item=><div className="listRow" key={item.name}><strong>{PLATFORM[item.name]||item.name}</strong><span className="muted">账号</span><Chip color={PLATFORM_COLOR[item.name]}>{TYPE.koc} / KOL / 三方号</Chip><b>{fmt(item.count)}</b></div>)}</div></Card></div></>}

      {tab === "organic" && <><div className="grid metrics"><Metric label="自然发布" value={fmt(organic.length)} note="实时库且已排除名单内账号" tone="orange"/><Metric label="覆盖平台" value={new Set(organic.map(item=>item.p)).size} note="以当前采集结果计"/><Metric label="自然播放" value={fmt(organic.reduce((s,p)=>s+Number(p.stats?.views||0),0))} note="公开可见指标" tone="purple"/><Metric label="新增内容" value={organic.filter(item=>item.isNew).length} note="最近36小时首次发现" tone="green"/></div><Card><div className="head between"><div><h2>最近风险与议题</h2><p>按最近证据排序 · 讨论量与倾向只代表当前采集样本</p></div><div className="topicControls">{[3,7,14].map(days=><button key={days} className={topicDays===days?"active":""} onClick={()=>setTopicDays(days)}>{days}天</button>)}</div></div><div className="topicTable"><div className="topicRow header"><div>热议主题</div><div>讨论声量</div><div>负面 / 非负 占比</div><div>舆情概括（客观描述）</div><div>最近证据</div></div>{topics?.topics?.length ? topics.topics.map(topic=><div className="topicRow" key={topic.id}><div><strong>{topic.name}</strong></div><div>约 {topic.volume} 条</div><div><div className="ratio"><span className="neg" style={{width:`${Math.max(topic.negative_pct,topic.negative_pct?12:0)}%`}}>{topic.negative_pct?`${topic.negative_pct}%`:""}</span><span className="nonneg" style={{width:`${topic.non_negative_pct}%`}}>{topic.non_negative_pct}%</span></div></div><div>{topic.summary}<div className="samples">{(topic.samples||[]).map((sample,index)=><a key={index} href={sample.url} target="_blank" rel="noreferrer">{PLATFORM[sample.platform]||sample.platform}来源{index+1} ↗</a>)}</div></div><div>{dateTime(topic.latest_at)}</div></div>) : <Empty>当前时间窗暂无可归类议题，或议题 API 正在更新</Empty>}</div></Card></>}

      {tab === "feed" && <Card><div className="head"><h2>内容明细</h2><p>默认只看实时数据库；5月旧数据已移至历史归档</p></div><div className="filters"><select value={scope} onChange={e=>changeScope(e.target.value)}><option value="live">实时采集（{livePosts.length}）</option><option value="archive">历史归档·5月（{archivePosts.length}）</option></select><select value={typeFilter} onChange={e=>changeType(e.target.value)}><option value="all">全部类型（{posts.length}）</option>{typeOptions.map(item=><option key={item.key} value={item.key}>{item.label}（{item.count}）</option>)}</select><select value={platformFilter} onChange={e=>changePlatform(e.target.value)}><option value="all">全部平台（{posts.length}）</option>{platformOptions.map(item=><option key={item.key} value={item.key}>{item.label}（{item.count}）</option>)}</select><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索账号或内容关键词"/><button onClick={resetFilters}>清除筛选</button><span className="muted">显示 {filtered.length} 条</span></div><div className="pad feed">{filtered.length ? filtered.map((item,index)=><article className={`post ${item.isNew?"new":""}`} key={`${item.url}-${index}`}><div className="postTop"><Chip color={PLATFORM_COLOR[item.p]}>{PLATFORM[item.p]||item.p}</Chip><Chip color={TYPE_COLOR[item.listType]}>{TYPE[item.listType]||item.listType}</Chip><strong>{item.u}</strong>{item.isNew&&<Chip color="#2563eb">NEW</Chip>}<time>{item.d||"日期待复核"}</time></div><p>{item.t}</p><div className="postFoot"><span>👁 {fmt(item.stats?.views)}</span><span>👍 {fmt(item.stats?.likes)}</span><span>💬 {fmt(item.stats?.comments)}</span><span>{item.l}</span>{String(item.url).startsWith("http")&&<a href={item.url} target="_blank" rel="noreferrer">查看来源 ↗</a>}</div></article>) : <Empty>当前组合没有内容；系统会自动解除互斥筛选，也可以点击“清除筛选”。</Empty>}</div></Card>}
      <div className="foot">Roco Kingdom Overseas Sentinel · 实时库与历史归档分开 · 商业字段不公开</div>
    </div>
  </main>;
}
