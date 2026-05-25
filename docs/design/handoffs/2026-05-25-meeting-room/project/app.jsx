// Meeting history search — iOS-style mobile, PM use
// v2: AI experts as first-class participants
const { useState, useMemo, useRef, useEffect } = React;

// ─────────── data ───────────
const HUMANS = {
  ZK: { name: '周凯',  color: '#FF9F0A' },
  LM: { name: '林敏',  color: '#34C759' },
  WJ: { name: '王俊',  color: '#5E5CE6' },
  CY: { name: '陈宇',  color: '#FF375F' },
  SL: { name: '苏蕾',  color: '#30B0C7' },
  HR: { name: 'Henry', color: '#AF52DE' },
  YQ: { name: '叶倩',  color: '#FF6482' },
  TM: { name: 'Tom',   color: '#0A84FF' },
  RB: { name: '阮波',  color: '#BF5AF2' },
};

// AI experts: rounded-square avatars + gradient + sparkle glyph
const AIS = {
  ARIA:    { name: 'Aria',    role: '数据分析师',   grad: ['#0A84FF', '#5E5CE6'] },
  STRATOS: { name: 'Stratos', role: '产品策略',     grad: ['#AF52DE', '#FF375F'] },
  SCOUT:   { name: 'Scout',   role: '竞品研究',     grad: ['#34C759', '#30B0C7'] },
  LEX:     { name: 'Lex',     role: '法务合规',     grad: ['#FF9F0A', '#FF6482'] },
  SAGE:    { name: 'Sage',    role: 'UX 顾问',     grad: ['#FF2D55', '#AF52DE'] },
  TALLY:   { name: 'Tally',   role: '财务建模',     grad: ['#64D2FF', '#0A84FF'] },
};

const MEETINGS = [
  {
    id: 'm1',
    title: 'Q3 路线图对齐 / Roadmap Sync',
    time: '今天 10:30', timeBucket: 'today', duration: '52 分钟',
    humans: ['ZK', 'LM', 'WJ', 'CY', 'SL'],
    ais: ['STRATOS', 'ARIA'],
    aiLed: false,
    topic: '路线图',
    summary: '确认 Q3 重点放在搜索体验与团队协作两条主线,9 月底前完成会议摘要的智能体验升级…',
    aiInsight: { who: 'STRATOS', quote: '建议把"协作"从 Q3 延后到 Q4,Q3 单独打透搜索与摘要,数据上每多一条主线 ETA 滑 18%。' },
    unread: true,
  },
  {
    id: 'm2',
    title: '搜索体验评审 #4',
    time: '今天 09:15', timeBucket: 'today', duration: '38 分钟',
    humans: ['LM', 'WJ'],
    ais: ['SAGE'],
    aiLed: false,
    topic: '产品评审',
    summary: '林敏走查了搜索结果页第 4 版,讨论了 chip 顺序与空状态文案…',
    aiInsight: { who: 'SAGE', quote: '把"主题"放在"参与人"之前更符合用户心智路径 — 5 个相似产品里有 4 个这么做。' },
    unread: false,
  },
  {
    id: 'm3',
    title: '客户访谈:Hummingbird 团队',
    time: '昨天 16:00', timeBucket: 'yesterday', duration: '1 小时 12 分',
    humans: ['ZK', 'SL'],
    ais: ['SCOUT', 'ARIA'],
    aiLed: false,
    topic: '用户研究',
    summary: '对方 12 人小团队,核心痛点是"开完会找不回结论",对自动摘要 + 关键决策提取兴趣很大…',
    aiInsight: { who: 'SCOUT', quote: '这家客户上季度刚拒了 Otter,核心理由是"摘要太长",我们的 50 字策略正好命中。' },
    unread: false,
  },
  {
    id: 'm4',
    title: '本周 Standup',
    time: '昨天 09:30', timeBucket: 'yesterday', duration: '18 分钟',
    humans: ['ZK', 'LM', 'WJ', 'CY', 'SL', 'HR', 'YQ'],
    ais: ['ARIA'],
    aiLed: false,
    topic: '同步',
    summary: '搜索 chip 进入联调,详情页过场动画待定;陈宇本周休假两天…',
    aiInsight: { who: 'ARIA', quote: '上周 6 个 ticket 里有 4 个跟"过场动画"挂钩,这块在燃尽图上是单点阻塞。' },
    unread: false,
  },
  {
    id: 'm5',
    title: '摘要模型 A/B 复盘',
    time: '周四 14:00', timeBucket: 'week', duration: '45 分钟',
    humans: ['WJ', 'CY'],
    ais: ['ARIA', 'TALLY'],
    aiLed: true,
    topic: '数据复盘',
    summary: 'B 组(haiku-4.5 + 决策抽取)有用率比 A 高 11.4 pp,但延迟多 380ms…',
    aiInsight: { who: 'ARIA', quote: '11.4pp 在 95% 置信下显著;按当前延迟,P90 仍在 1.2s 内,值得切。Tally 估增量成本 +$0.018/会议。' },
    unread: false,
  },
  {
    id: 'm6',
    title: '设计周会',
    time: '周三 11:00', timeBucket: 'week', duration: '40 分钟',
    humans: ['LM', 'HR', 'YQ'],
    ais: ['SAGE'],
    aiLed: false,
    topic: '设计',
    summary: '过了 3 套移动端搜索的视觉方向,最终选 iOS 系统应用密度…',
    aiInsight: { who: 'SAGE', quote: '头像组合超过 4 个会让中文用户首次扫视成本上升 22%,3 + N 计数是 sweet spot。' },
    unread: false,
  },
  {
    id: 'm7',
    title: '与法务对齐:会议录音留存',
    time: '5 月 19 日', timeBucket: 'earlier', duration: '30 分钟',
    humans: ['ZK'],
    ais: ['LEX'],
    aiLed: true,
    topic: '合规',
    summary: '内部会议默认保留 90 天,外部客户会议需在邀请中明示并提供导出…',
    aiInsight: { who: 'LEX', quote: '中国《个人信息保护法》第 17 条要求显著告知,我已起草同意书 v1,Henry 复核即可发。' },
    unread: false,
  },
  {
    id: 'm8',
    title: '招聘:高级产品设计师 终面',
    time: '5 月 17 日', timeBucket: 'earlier', duration: '55 分钟',
    humans: ['ZK', 'LM', 'SL'],
    ais: [],
    aiLed: false,
    topic: '招聘',
    summary: '候选人作品集偏 B 端工具,系统化思考强,落地速度待验证…',
    aiInsight: null,
    unread: false,
  },
];

// derived: weekly AI spotlight
const SPOTLIGHTS = [
  { ai: 'STRATOS', meeting: 'Q3 路线图对齐', kind: '建议',
    text: '把"协作"延后到 Q4,Q3 单线打透搜索 + 摘要', accepted: true },
  { ai: 'ARIA', meeting: '摘要模型 A/B 复盘', kind: '决策依据',
    text: 'B 组在 95% 置信下显著,延迟仍在预算内', accepted: true },
  { ai: 'SCOUT', meeting: 'Hummingbird 访谈', kind: '市场情报',
    text: '客户曾因"摘要太长"拒掉 Otter,50 字策略命中', accepted: null },
  { ai: 'LEX', meeting: '法务对齐', kind: '风险提示',
    text: '《个保法》第 17 条要求显著告知,已起草同意书', accepted: true },
];

const TIME_OPTIONS  = ['今天', '本周', '本月', '自定义'];
const HUMAN_OPTIONS = Object.entries(HUMANS).map(([k, v]) => ({ k, ...v }));
const AI_OPTIONS    = Object.entries(AIS).map(([k, v]) => ({ k, ...v }));
const TOPIC_OPTIONS = ['路线图', '产品评审', '用户研究', '同步', '数据复盘', '设计', '合规', '招聘'];

// ─────────── ui atoms ───────────
function HumanAvatar({ id, size = 26, ring = '#fff' }) {
  const p = HUMANS[id];
  if (!p) return null;
  const initial = /[A-Za-z]/.test(p.name[0]) ? p.name[0].toUpperCase() : p.name[0];
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: p.color, color: '#fff',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.44, fontWeight: 600, letterSpacing: 0.2,
      boxShadow: `0 0 0 1.5px ${ring}`,
      flexShrink: 0,
    }}>{initial}</div>
  );
}

// AI experts: rounded-square + gradient + sparkle glyph (visually clearly different)
function AIAvatar({ id, size = 26, ring = '#fff', showGlyph = true }) {
  const a = AIS[id];
  if (!a) return null;
  const r = Math.max(6, size * 0.28);
  return (
    <div style={{
      width: size, height: size, borderRadius: r,
      background: `linear-gradient(135deg, ${a.grad[0]} 0%, ${a.grad[1]} 100%)`,
      color: '#fff',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: `0 0 0 1.5px ${ring}`,
      flexShrink: 0, position: 'relative',
      fontFamily: '-apple-system, system-ui',
    }}>
      {showGlyph ? (
        <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24">
          <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" fill="#fff" />
          <path d="M18.5 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" fill="#fff" opacity="0.85" />
        </svg>
      ) : (
        <span style={{ fontSize: size * 0.42, fontWeight: 700 }}>{a.name[0]}</span>
      )}
    </div>
  );
}

function ParticipantStack({ humans, ais, max = 4, size = 24 }) {
  // AI experts first so they're visually anchored to the left of the stack
  const all = [
    ...ais.map(id => ({ kind: 'ai', id })),
    ...humans.map(id => ({ kind: 'human', id })),
  ];
  const visible = all.slice(0, max);
  const extra = all.length - visible.length;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center' }}>
      {visible.map((p, i) => (
        <div key={p.kind + p.id} style={{ marginLeft: i === 0 ? 0 : -8, zIndex: 10 - i }}>
          {p.kind === 'ai' ? <AIAvatar id={p.id} size={size} /> : <HumanAvatar id={p.id} size={size} />}
        </div>
      ))}
      {extra > 0 && (
        <div style={{
          marginLeft: -8, width: size, height: size, borderRadius: '50%',
          background: '#E5E5EA', color: '#3C3C43',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: size * 0.42, fontWeight: 600,
          boxShadow: '0 0 0 1.5px #fff',
        }}>+{extra}</div>
      )}
    </div>
  );
}

function Icon({ name, size = 17, color = 'currentColor' }) {
  const stroke = { stroke: color, strokeWidth: 1.6, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'search':
      return (<svg width={size} height={size} viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="7" {...stroke} />
        <path d="M20 20l-3.5-3.5" {...stroke} /></svg>);
    case 'mic':
      return (<svg width={size} height={size} viewBox="0 0 24 24">
        <rect x="9" y="3" width="6" height="12" rx="3" {...stroke} />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" {...stroke} /></svg>);
    case 'x':
      return (<svg width={size} height={size} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" fill="#C7C7CC" />
        <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /></svg>);
    case 'chev':
      return (<svg width={size} height={size} viewBox="0 0 24 24">
        <path d="M9 6l6 6-6 6" {...stroke} /></svg>);
    case 'caret':
      return (<svg width={size} height={size} viewBox="0 0 24 24">
        <path d="M7 10l5 5 5-5" {...stroke} /></svg>);
    case 'back':
      return (<svg width={size} height={size} viewBox="0 0 24 24">
        <path d="M15 6l-6 6 6 6" {...stroke} strokeWidth="2" /></svg>);
    case 'sparkle':
      return (<svg width={size} height={size} viewBox="0 0 24 24">
        <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" fill={color} />
        <path d="M19 14l.7 1.8L21.5 16.5l-1.8.7L19 19l-.7-1.8-1.8-.7 1.8-.7L19 14z" fill={color} /></svg>);
    case 'check':
      return (<svg width={size} height={size} viewBox="0 0 24 24">
        <path d="M5 12.5l4.5 4.5L19 7.5" {...stroke} strokeWidth="2.2" /></svg>);
    default: return null;
  }
}

// ─────────── chip ───────────
function Chip({ label, value, active, onClick, icon }) {
  const isOn = !!active;
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      height: 30, padding: icon ? '0 12px 0 9px' : '0 12px',
      borderRadius: 15, border: 'none',
      background: isOn ? '#007AFF' : '#F2F2F7',
      color: isOn ? '#fff' : '#000',
      fontSize: 14, fontWeight: 500,
      fontFamily: 'inherit',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      transition: 'background 120ms ease',
    }}>
      {icon === 'sparkle' && (
        <Icon name="sparkle" size={13} color={isOn ? '#fff' : '#AF52DE'} />
      )}
      <span>{value && value !== '全部' ? value : label}</span>
      <Icon name="caret" size={14} color={isOn ? '#fff' : '#8E8E93'} />
    </button>
  );
}

// ─────────── filter sheet ───────────
function FilterSheet({ open, kind, value, onChange, onClose }) {
  if (!open) return null;
  const titles = {
    time: '按时间', people: '按参与人', ai: '按 AI 专家', topic: '按主题',
  };
  const opts = kind === 'time' ? TIME_OPTIONS
             : kind === 'topic' ? TOPIC_OPTIONS
             : kind === 'ai' ? AI_OPTIONS
             : HUMAN_OPTIONS;

  return (
    <>
      <div onClick={onClose} style={{
        position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.32)',
        zIndex: 80, animation: 'fadeIn 180ms ease',
      }} />
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        background: '#F2F2F7', borderTopLeftRadius: 14, borderTopRightRadius: 14,
        zIndex: 81, paddingBottom: 34,
        animation: 'slideUp 240ms cubic-bezier(.22,.61,.36,1)',
        maxHeight: '70%', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 6 }}>
          <div style={{ width: 36, height: 5, borderRadius: 3, background: '#D1D1D6' }} />
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px 8px',
        }}>
          <button onClick={() => onChange('全部')} style={btnText('#007AFF')}>清除</button>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{titles[kind]}</div>
          <button onClick={onClose} style={btnText('#007AFF', 600)}>完成</button>
        </div>

        <div style={{ overflow: 'auto', padding: '4px 16px 0' }}>
          <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden' }}>
            {opts.map((opt, i) => {
              const isPeople = kind === 'people';
              const isAi     = kind === 'ai';
              const label    = (isPeople || isAi) ? opt.name : opt;
              const subLabel = isAi ? opt.role : null;
              const selected = (isPeople || isAi) ? value === opt.k : value === opt;
              return (
                <div key={label} onClick={() => onChange((isPeople || isAi) ? opt.k : opt)} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 16px',
                  borderTop: i === 0 ? 'none' : '0.5px solid rgba(60,60,67,0.12)',
                  cursor: 'pointer',
                }}>
                  {isPeople && <HumanAvatar id={opt.k} size={30} />}
                  {isAi && <AIAvatar id={opt.k} size={30} />}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontSize: 16 }}>{label}</div>
                    {subLabel && <div style={{ fontSize: 12, color: '#8E8E93', marginTop: 1 }}>{subLabel}</div>}
                  </div>
                  {selected && <Icon name="check" size={20} color="#007AFF" />}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

function btnText(color, weight = 400) {
  return {
    background: 'none', border: 'none', color, fontSize: 16, fontWeight: weight,
    fontFamily: 'inherit', cursor: 'pointer', padding: 0,
  };
}

// ─────────── AI Insight (in row) ───────────
function AIInsightLine({ insight }) {
  if (!insight) return null;
  const a = AIS[insight.who];
  return (
    <div style={{
      display: 'flex', gap: 8, marginTop: 8,
      paddingLeft: 9, position: 'relative',
    }}>
      <div style={{
        position: 'absolute', left: 0, top: 3, bottom: 3, width: 2.5, borderRadius: 2,
        background: `linear-gradient(180deg, ${a.grad[0]}, ${a.grad[1]})`,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2,
        }}>
          <AIAvatar id={insight.who} size={14} ring="transparent" />
          <span style={{ fontSize: 12, fontWeight: 600, color: '#1C1C1E' }}>{a.name}</span>
          <span style={{ fontSize: 11, color: '#8E8E93' }}>· {a.role}</span>
        </div>
        <div style={{
          fontSize: 13, lineHeight: '18px', color: '#3C3C43',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>"{insight.quote}"</div>
      </div>
    </div>
  );
}

// ─────────── list row ───────────
function MeetingRow({ m, onClick, isLast }) {
  return (
    <div onClick={onClick} style={{
      padding: '12px 16px 13px',
      borderBottom: isLast ? 'none' : '0.5px solid rgba(60,60,67,0.12)',
      background: '#fff',
      cursor: 'pointer',
      WebkitTapHighlightColor: 'rgba(0,0,0,0.04)',
      position: 'relative',
    }}>
      {/* title row */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        {m.unread && (
          <div style={{
            width: 8, height: 8, borderRadius: '50%', background: '#007AFF',
            flexShrink: 0, alignSelf: 'center', marginRight: -2,
          }} />
        )}
        <div style={{
          flex: 1, fontSize: 16, fontWeight: 600, color: '#000',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{m.title}</div>
        <div style={{
          fontSize: 13, color: '#8E8E93', display: 'flex', alignItems: 'center', gap: 2,
          flexShrink: 0,
        }}>
          <span>{m.time}</span>
          <Icon name="chev" size={14} color="#C7C7CC" />
        </div>
      </div>

      {/* tags row: aiLed / topic */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        {m.aiLed && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            fontSize: 11, fontWeight: 600,
            color: '#fff',
            background: 'linear-gradient(135deg, #AF52DE 0%, #5E5CE6 100%)',
            padding: '2px 7px 2px 5px', borderRadius: 4,
          }}>
            <Icon name="sparkle" size={10} color="#fff" /> AI 主持
          </span>
        )}
        <span style={{
          fontSize: 11, fontWeight: 500, color: '#5E5CE6',
          background: 'rgba(94,92,230,0.10)',
          padding: '2px 7px', borderRadius: 4,
        }}>{m.topic}</span>
        <span style={{ fontSize: 11, color: '#8E8E93' }}>· {m.duration}</span>
      </div>

      {/* AI summary */}
      <div style={{ marginTop: 6, fontSize: 14, lineHeight: '20px', color: '#3C3C43',
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {m.summary}
      </div>

      {/* AI insight line — distinguishing feature */}
      <AIInsightLine insight={m.aiInsight} />

      {/* participants */}
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <ParticipantStack humans={m.humans} ais={m.ais} size={22} max={5} />
        <div style={{ fontSize: 11, color: '#8E8E93' }}>
          {m.humans.length} 人 {m.ais.length > 0 && `· ${m.ais.length} AI`}
        </div>
      </div>
    </div>
  );
}

// ─────────── section header ───────────
function SectionHeader({ label, right }) {
  return (
    <div style={{
      padding: '18px 16px 6px', display: 'flex',
      alignItems: 'flex-end', justifyContent: 'space-between',
    }}>
      <div style={{
        fontSize: 13, fontWeight: 600, color: '#6D6D72',
        textTransform: 'uppercase', letterSpacing: 0.3,
      }}>{label}</div>
      {right && <div style={{ fontSize: 13, color: '#007AFF' }}>{right}</div>}
    </div>
  );
}

// ─────────── AI Spotlight carousel ───────────
function AISpotlight({ onTapAI }) {
  return (
    <div>
      <SectionHeader label="本周 AI 专家高光" right="查看全部" />
      <div style={{
        display: 'flex', gap: 10, overflowX: 'auto',
        padding: '2px 16px 12px',
        scrollbarWidth: 'none',
      }}>
        {SPOTLIGHTS.map((s, i) => {
          const a = AIS[s.ai];
          return (
            <div key={i} onClick={() => onTapAI && onTapAI(s.ai)} style={{
              flexShrink: 0, width: 240,
              background: '#fff', borderRadius: 14,
              padding: 12,
              border: '0.5px solid rgba(60,60,67,0.12)',
              boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
              cursor: 'pointer',
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', top: -20, right: -20, width: 80, height: 80,
                borderRadius: '50%', opacity: 0.10,
                background: `linear-gradient(135deg, ${a.grad[0]}, ${a.grad[1]})`,
              }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
                <AIAvatar id={s.ai} size={30} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{a.name}</div>
                  <div style={{ fontSize: 11, color: '#8E8E93' }}>{a.role}</div>
                </div>
              </div>
              <div style={{
                marginTop: 9,
                fontSize: 11, fontWeight: 600,
                color: a.grad[0], textTransform: 'uppercase', letterSpacing: 0.4,
              }}>{s.kind}</div>
              <div style={{
                marginTop: 3, fontSize: 13, lineHeight: 1.4, color: '#1C1C1E',
                display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                minHeight: 54,
              }}>{s.text}</div>
              <div style={{
                marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                fontSize: 11, color: '#8E8E93',
              }}>
                <span>来自《{s.meeting}》</span>
                {s.accepted === true && (
                  <span style={{ color: '#34C759', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    <Icon name="check" size={11} color="#34C759" /> 已采纳
                  </span>
                )}
                {s.accepted === null && <span style={{ color: '#FF9F0A' }}>待评估</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────── search bar ───────────
function SearchBar({ value, onChange, focused, setFocused }) {
  const inputRef = useRef(null);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px 10px' }}>
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', gap: 6,
        background: '#E9E9EB', borderRadius: 10, height: 36, padding: '0 8px',
      }}>
        <Icon name="search" size={16} color="#8E8E93" />
        <input
          ref={inputRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="搜会议、AI 洞察、关键词"
          style={{
            flex: 1, border: 'none', outline: 'none',
            background: 'transparent', fontSize: 16, fontFamily: 'inherit', color: '#000',
          }}
        />
        {value
          ? <button onClick={() => { onChange(''); inputRef.current && inputRef.current.focus(); }}
                    style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', display: 'flex' }}>
              <Icon name="x" size={17} />
            </button>
          : <Icon name="mic" size={17} color="#8E8E93" />
        }
      </div>
      {focused && (
        <button onClick={() => { setFocused(false); inputRef.current && inputRef.current.blur(); }}
                style={{ ...btnText('#007AFF'), fontSize: 16 }}>取消</button>
      )}
    </div>
  );
}

// ─────────── detail (push transition) ───────────
function DetailView({ m, onBack, leaving }) {
  const ai = m.aiInsight ? AIS[m.aiInsight.who] : null;
  return (
    <div style={{
      position: 'absolute', inset: 0, background: '#F2F2F7',
      animation: leaving
        ? 'pushOutRight 280ms cubic-bezier(.32,.72,.35,1) forwards'
        : 'pushInRight 280ms cubic-bezier(.32,.72,.35,1) forwards',
      display: 'flex', flexDirection: 'column', zIndex: 30,
    }}>
      {/* nav */}
      <div style={{
        paddingTop: 54, height: 96, display: 'flex', alignItems: 'center',
        background: 'rgba(248,248,248,0.92)', backdropFilter: 'blur(20px)',
        borderBottom: '0.5px solid rgba(60,60,67,0.18)', position: 'relative',
      }}>
        <button onClick={onBack} style={{
          ...btnText('#007AFF'), display: 'flex', alignItems: 'center', gap: 2,
          padding: '0 8px', height: 44,
        }}>
          <Icon name="back" size={22} color="#007AFF" />
          <span style={{ fontSize: 17 }}>搜索</span>
        </button>
        <div style={{
          position: 'absolute', left: 0, right: 0, textAlign: 'center',
          fontSize: 17, fontWeight: 600, pointerEvents: 'none',
        }}>会议详情</div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px 40px' }}>
        <div style={{ padding: '4px 4px 14px' }}>
          <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.25 }}>{m.title}</div>
          <div style={{ marginTop: 6, fontSize: 14, color: '#8E8E93' }}>
            {m.time} · {m.duration} · {m.humans.length} 人{m.ais.length > 0 && ` + ${m.ais.length} AI`}
          </div>
        </div>

        <div style={{ marginTop: 12, color: '#C7C7CC', fontSize: 13, textAlign: 'center' }}>
          — 详情页未实现,仅演示跳转动画 —
        </div>
      </div>
    </div>
  );
}

// ─────────── main page ───────────
function App() {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [fTime, setFTime]     = useState('全部');
  const [fPeople, setFPeople] = useState('全部');
  const [fAI, setFAI]         = useState('全部');
  const [fTopic, setFTopic]   = useState('全部');

  const [openId, setOpenId] = useState(null);
  const [leaving, setLeaving] = useState(false);

  const filtered = useMemo(() => MEETINGS.filter(m => {
    if (query) {
      const q = query.toLowerCase();
      const names = [
        ...m.humans.map(h => HUMANS[h].name),
        ...m.ais.map(a => AIS[a].name + ' ' + AIS[a].role),
      ].join(' ').toLowerCase();
      const aiText = m.aiInsight ? m.aiInsight.quote : '';
      if (!(m.title.toLowerCase().includes(q)
          || m.summary.toLowerCase().includes(q)
          || names.includes(q)
          || aiText.toLowerCase().includes(q)
          || m.topic.toLowerCase().includes(q))) return false;
    }
    if (fTime !== '全部') {
      const map = { '今天': ['today'], '本周': ['today','yesterday','week'],
                    '本月': ['today','yesterday','week','earlier'], '自定义': null };
      const t = map[fTime];
      if (t !== null && !t.includes(m.timeBucket)) return false;
    }
    if (fPeople !== '全部' && !m.humans.includes(fPeople)) return false;
    if (fAI     !== '全部' && !m.ais.includes(fAI))     return false;
    if (fTopic  !== '全部' && m.topic !== fTopic)        return false;
    return true;
  }), [query, fTime, fPeople, fAI, fTopic]);

  const buckets = ['today','yesterday','week','earlier'];
  const bucketLabel = { today: '今天', yesterday: '昨天', week: '本周早些', earlier: '更早' };
  const grouped = buckets.map(b => ({ b, items: filtered.filter(m => m.timeBucket === b) }))
                          .filter(g => g.items.length > 0);

  const anyFilter = fTime !== '全部' || fPeople !== '全部' || fAI !== '全部' || fTopic !== '全部' || query;

  const openDetail = (id) => { setOpenId(id); setLeaving(false); };
  const closeDetail = () => {
    setLeaving(true);
    setTimeout(() => { setOpenId(null); setLeaving(false); }, 280);
  };

  const peopleChipLabel = fPeople === '全部' ? '参与人' : HUMANS[fPeople].name;
  const aiChipLabel     = fAI     === '全部' ? 'AI 专家' : AIS[fAI].name;

  const activeMeeting = MEETINGS.find(m => m.id === openId);

  return (
    <IOSDevice width={402} height={874}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
        {/* nav header (large title) */}
        <div style={{ paddingTop: 54, background: '#fff',
                       borderBottom: '0.5px solid rgba(60,60,67,0.12)' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 16px 2px',
          }}>
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.3 }}>会议历史</div>
            <div style={{
              width: 30, height: 30, borderRadius: '50%', background: '#0A84FF',
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 600,
            }}>PM</div>
          </div>
          <SearchBar value={query} onChange={setQuery} focused={focused} setFocused={setFocused} />
          <div style={{
            display: 'flex', gap: 8, overflowX: 'auto',
            padding: '0 16px 12px', scrollbarWidth: 'none',
          }}>
            <Chip label="时间"    value={fTime}        active={fTime !== '全部'}        onClick={() => setSheet('time')} />
            <Chip label="AI 专家" value={aiChipLabel}  active={fAI !== '全部'}          onClick={() => setSheet('ai')} icon="sparkle" />
            <Chip label="参与人"  value={peopleChipLabel} active={fPeople !== '全部'}   onClick={() => setSheet('people')} />
            <Chip label="主题"    value={fTopic}       active={fTopic !== '全部'}       onClick={() => setSheet('topic')} />
          </div>
        </div>

        {/* scroll body */}
        <div style={{ flex: 1, overflow: 'auto', background: '#fff' }}>
          {/* AI Spotlight — only when not actively filtering */}
          {!anyFilter && <AISpotlight onTapAI={(id) => setFAI(id)} />}

          {/* results */}
          {!anyFilter && <SectionHeader label="最近会议" />}

          {grouped.length === 0 ? (
            <div style={{
              padding: '80px 32px', textAlign: 'center',
              color: '#8E8E93', fontSize: 15, lineHeight: 1.5,
            }}>
              <div style={{ fontSize: 34, marginBottom: 8, opacity: 0.5 }}>⌕</div>
              没有匹配的会议<br/>
              <span style={{ fontSize: 13 }}>试试调整筛选或换个关键词</span>
            </div>
          ) : grouped.map((g, idx) => (
            <div key={g.b}>
              {(anyFilter || idx > 0) && <SectionHeader label={bucketLabel[g.b]} />}
              {!anyFilter && idx === 0 && (
                <div style={{ padding: '0 16px 6px', fontSize: 13, color: '#8E8E93' }}>{bucketLabel[g.b]}</div>
              )}
              <div style={{ background: '#fff' }}>
                {g.items.map((m, i) => (
                  <MeetingRow key={m.id} m={m} isLast={i === g.items.length - 1}
                              onClick={() => openDetail(m.id)} />
                ))}
              </div>
            </div>
          ))}
          <div style={{ height: 24 }} />
        </div>

        <FilterSheet open={sheet === 'time'}   kind="time"   value={fTime}
          onChange={(v) => setFTime(v)}   onClose={() => setSheet(null)} />
        <FilterSheet open={sheet === 'ai'}     kind="ai"     value={fAI}
          onChange={(v) => setFAI(v)}     onClose={() => setSheet(null)} />
        <FilterSheet open={sheet === 'people'} kind="people" value={fPeople}
          onChange={(v) => setFPeople(v)} onClose={() => setSheet(null)} />
        <FilterSheet open={sheet === 'topic'}  kind="topic"  value={fTopic}
          onChange={(v) => setFTopic(v)}  onClose={() => setSheet(null)} />

        {(openId || leaving) && activeMeeting && (
          <DetailView m={activeMeeting} onBack={closeDetail} leaving={leaving} />
        )}
      </div>
    </IOSDevice>
  );
}

const style = document.createElement('style');
style.textContent = `
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
  @keyframes pushInRight {
    from { transform: translateX(100%); box-shadow: -8px 0 24px rgba(0,0,0,0); }
    to   { transform: translateX(0);    box-shadow: -8px 0 24px rgba(0,0,0,0.12); }
  }
  @keyframes pushOutRight {
    from { transform: translateX(0); }
    to   { transform: translateX(100%); }
  }
  div::-webkit-scrollbar { display: none; }
  input::placeholder { color: #8E8E93; }
`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
