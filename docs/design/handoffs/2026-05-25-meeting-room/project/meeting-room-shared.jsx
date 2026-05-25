// Shared data + atoms for the meeting room view
// Exposed via window.* so meeting-room.jsx can use them across script scopes.

const MR_HUMANS = {
  ZK: { name: '周凯',  role: 'PM',     color: '#FF9F0A', speaking: false, muted: false },
  LM: { name: '林敏',  role: '设计',   color: '#34C759', speaking: false, muted: false },
  WJ: { name: '王俊',  role: '工程',   color: '#5E5CE6', speaking: true,  muted: false },
  CY: { name: '陈宇',  role: '工程',   color: '#FF375F', speaking: false, muted: false },
  SL: { name: '苏蕾',  role: '研究',   color: '#30B0C7', speaking: false, muted: true  },
};

// Domain AI experts — gradient rounded-square avatar
const MR_AIS = {
  ARIA:    { name: 'Aria',    role: '数据分析师', grad: ['#0A84FF', '#5E5CE6'] },
  STRATOS: { name: 'Stratos', role: '产品策略',   grad: ['#AF52DE', '#FF375F'] },
  LEX:     { name: 'Lex',     role: '法务合规',   grad: ['#FF9F0A', '#FF6482'] },
  SAGE:    { name: 'Sage',    role: 'UX 顾问',   grad: ['#FF2D55', '#AF52DE'] },
};

// Host / Moderator — special AI with concentric-ring avatar + amber accent
const MR_HOST = {
  name: 'Mira', role: '会议主持人',
  grad: ['#FFB340', '#FF9F0A'],
  desc: '管议程 · 提醒走神 · 拆问题转给 AI 专家',
};

// Agenda
const MR_AGENDA = [
  { id: 1, title: 'Q3 OKR 校准',       state: 'done',    minutes: 8 },
  { id: 2, title: '搜索模型 A/B 数据', state: 'active',  minutes: 15, remaining: 6 },
  { id: 3, title: '协作功能优先级',     state: 'pending', minutes: 8 },
  { id: 4, title: '行动项 & 责任人',    state: 'pending', minutes: 5 },
];

// Live transcript feed — covers all 3 features in user request
const MR_MESSAGES = [
  { kind: 'host', tone: 'agenda', t: '23:02',
    title: '已切换议程',
    body: '议程 1「Q3 OKR 校准」完成 ✓ · 现在进入议程 2:搜索模型 A/B 数据',
  },
  { kind: 'human', who: 'WJ', t: '23:05', partial: false,
    text: '我先抛个数。B 组(haiku-4.5 + 决策抽取)有用率比 A 高 11.4 个百分点,但延迟多了 380ms,这是上周末跑的 5000 条样本。',
  },
  { kind: 'human', who: 'CY', t: '23:06', partial: false,
    text: '11 个点已经很大了,但 380ms 听起来不少。用户能感知到吗?',
  },
  { kind: 'human', who: 'WJ', t: '23:07', partial: false, summon: 'ARIA',
    text: '@Aria 帮我看下 P95 在 1.2 秒内的概率,以及当前 SLA 的余量。',
  },
  { kind: 'ai', who: 'ARIA', via: { kind: 'summon', by: 'WJ' }, t: '23:07',
    body: 'P95 延迟分布(近 72 小时,B 组):',
    data: [
      { label: '1.0s 内', v: '73%' },
      { label: '1.2s 内', v: '87%' },
      { label: '1.5s 内', v: '96%' },
    ],
    note: '产品 SLA 是 P95 ≤ 1.5s,当前余量 9pp。建议把 B 组灰度到 20%,延迟可监控、可回滚。',
    actions: ['详细数据', '记入决策'],
  },
  { kind: 'human', who: 'SL', t: '23:09', partial: false, offTopic: true,
    text: '说到这个 — 我们要不要也聊一下昨天 Hummingbird 客户访谈?他们对延迟其实挺敏感的…',
  },
  { kind: 'host', tone: 'drift-soft', t: '23:09',
    body: '苏蕾的发言偏离当前议程 · 持续观察中',
  },
  { kind: 'human', who: 'CY', t: '23:10', partial: false, offTopic: true,
    text: '对,他们其实问了三次延迟。我顺便分享下他们用 Otter 那段经历,挺有意思的:他们之前…',
  },
  { kind: 'host', tone: 'drift', t: '23:10',
    title: '讨论持续偏离 · 已 1 分 30 秒',
    body: '"客户访谈"不在本议程内,当前议程「搜索模型 A/B」还剩 4 分钟。',
    actions: [
      { label: '记入待办 (parking lot)', primary: true },
      { label: '改为当前议程' },
      { label: '再讨论 1 分钟' },
    ],
  },
  { kind: 'human', who: 'SL', t: '23:11', partial: false, offTopic: true,
    text: '哦对,他们用 Otter 的时候说摘要太长,然后我们演示的时候 demo 就卡住了,后来 Tom 又…',
  },
  { kind: 'host', tone: 'drift-strong', t: '23:11',
    title: '议程将无法按时完成',
    body: '已连续偏离 2 分 40 秒。当前议程仅剩 2:30,这样下去 B 组灰度决策今天无法落地。',
    countdown: '02:30',
    actions: [
      { label: '立即记入 parking lot,回到原议程', primary: true, urgent: true },
      { label: '议程顺延 5 分钟' },
    ],
  },
  { kind: 'human', who: 'ZK', t: '23:12', partial: false, askHost: true,
    text: '好,先记入 parking lot 吧。@主持人 议程 2 顺延 10 分钟可以吗?顺便帮我问下:这个改动需要多少法务工作量。',
  },
  { kind: 'host', tone: 'route', t: '23:12',
    title: '已拆解周凯的两个请求',
    items: [
      { label: '议程 2 延长 10 分钟', detail: '议程 4 顺延,会议总时长 +10 分钟', done: true },
      { label: '"法务工作量" 转给 Lex', detail: '正在生成答复…', loading: true },
    ],
  },
  { kind: 'ai', who: 'LEX', via: { kind: 'host' }, t: '23:13', loading: false,
    body: '切到 B 组涉及一条隐私政策更新:',
    data: [
      { label: '隐私政策', v: '第 4.2 条' },
      { label: '工作量',   v: '约 2 人日' },
      { label: '前置依赖', v: 'Henry 复核同意书 v1' },
    ],
    note: '建议跟下周隐私 review 一起发布,避免拆两次。',
    actions: ['插入会议纪要', '指派给 Henry'],
  },
  { kind: 'human', who: 'ZK', t: '23:13', partial: false,
    text: '@Aria @Lex @Sage 数据法务都看过了,我想拍板把 B 组直接灰度到 20%。各位从自己的角度给一个综合评估,Mira 帮我汇总成 3 条。',
  },
  { kind: 'round', t: '23:14',
    topic: '把 B 组灰度到 20%,可推进吗?',
    trigger: { kind: 'summon', by: 'ZK' },
    done: true,
    experts: [
      {
        who: 'ARIA', stance: 'support', done: true,
        headline: '数据支持 · 延迟在 SLA 内',
        summary: 'B 组在 95% 置信下显著,P95 延迟 1.18s 仍在 1.5s SLA 内,有 9pp 余量;同时已具备自动降级开关。',
        data: [
          { label: '有用率',  v: '+11.4pp' },
          { label: 'P95',     v: '1.18s'   },
          { label: 'SLA 余量', v: '9pp'     },
        ],
        note: '若 P95 触发 1.5s 阈值,自动回 A 组,预案已就绪。',
      },
      {
        who: 'LEX', stance: 'caution', done: true,
        headline: '法务可推进 · 需同步隐私更新',
        summary: '灰度到 20% 触发隐私政策第 4.2 条更新(约 2 人日),建议与下周隐私 review 打包发布,避免用户多次接收变更通知。',
        data: [
          { label: '工作量', v: '2 人日'  },
          { label: '截止',   v: '6/3'     },
          { label: '风险',   v: '中'      },
        ],
        note: '单独发布更新可能引发额外问询;打包风险更可控。',
      },
      {
        who: 'SAGE', stance: 'support', done: true,
        headline: 'UX 利好 · 用户对延迟容忍 > 预期',
        summary: '12 位访谈对象中,9 位对 1.5s 内延迟"基本无感",11 位明显感受到摘要质量提升;NPS 较 A 组 +18。',
        data: [
          { label: '无感知延迟', v: '9/12'  },
          { label: '感知改善',   v: '11/12' },
          { label: 'NPS Δ',     v: '+18'   },
        ],
        note: '正向感知量级大于负向延迟感知,放心切。',
      },
    ],
    miraSummary: {
      verdict: '可推进 · 注意法务节奏',
      conflict: false,
      points: [
        { stance: 'support', tag: '数据', text: '置信内显著,SLA 内,有自动降级预案' },
        { stance: 'caution', tag: '法务', text: '隐私 4.2 条需更新,建议与隐私 review 打包' },
        { stance: 'support', tag: 'UX',   text: '用户对延迟容忍度高于设计预期' },
      ],
      recommendation: '本周内 20% 灰度,与下周隐私 review 同步发布。Lex 起草隐私更新,Aria 监控降级开关。',
    },
  },
  { kind: 'human', who: 'WJ', t: '23:15', partial: true,
    text: '好的,那我先把灰度配置准备好,等',
  },
];

// ─────────── Atoms ───────────
function MRHumanAvatar({ id, size = 28, ring = '#fff', showStatus = false }) {
  const p = MR_HUMANS[id];
  if (!p) return null;
  const initial = /[A-Za-z]/.test(p.name[0]) ? p.name[0].toUpperCase() : p.name[0];
  return (
    <div style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      <div style={{
        width: size, height: size, borderRadius: '50%',
        background: p.color, color: '#fff',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.44, fontWeight: 600,
        boxShadow: `0 0 0 1.5px ${ring}`,
      }}>{initial}</div>
      {showStatus && p.speaking && (
        <span style={{
          position: 'absolute', inset: -3, borderRadius: '50%',
          boxShadow: '0 0 0 2px #34C759',
          animation: 'speakingPulse 1.2s ease-in-out infinite',
          pointerEvents: 'none',
        }} />
      )}
      {showStatus && p.muted && (
        <span style={{
          position: 'absolute', right: -2, bottom: -2,
          width: size * 0.42, height: size * 0.42, borderRadius: '50%',
          background: '#FF453A', border: '1.5px solid #fff',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width={size * 0.24} height={size * 0.24} viewBox="0 0 24 24" fill="none">
            <path d="M4 4l16 16" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M9 5a3 3 0 0 1 6 0v6M9 11v0a3 3 0 0 0 .8 2.05" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
      )}
    </div>
  );
}

function MRAIAvatar({ id, size = 28, ring = '#fff' }) {
  const a = MR_AIS[id];
  if (!a) return null;
  const r = Math.max(6, size * 0.28);
  return (
    <div style={{
      width: size, height: size, borderRadius: r,
      background: `linear-gradient(135deg, ${a.grad[0]} 0%, ${a.grad[1]} 100%)`,
      color: '#fff',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: `0 0 0 1.5px ${ring}`,
      flexShrink: 0,
    }}>
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24">
        <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" fill="#fff" />
        <path d="M18.5 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" fill="#fff" opacity="0.85" />
      </svg>
    </div>
  );
}

// Host = concentric-ring avatar so user instantly distinguishes from domain AI
function MRHostAvatar({ size = 28, ring = '#fff' }) {
  const g = MR_HOST.grad;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `radial-gradient(circle at 50% 50%, ${g[0]} 0%, ${g[0]} 28%, #fff 28%, #fff 36%, ${g[1]} 36%, ${g[1]} 60%, #fff 60%, #fff 68%, ${g[0]} 68%)`,
      boxShadow: `0 0 0 1.5px ${ring}, inset 0 0 0 0.5px rgba(0,0,0,0.08)`,
      flexShrink: 0,
    }} />
  );
}

function MRIcon({ name, size = 17, color = 'currentColor' }) {
  const stroke = { stroke: color, strokeWidth: 1.6, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'back':    return <svg width={size} height={size} viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" {...stroke} strokeWidth="2" /></svg>;
    case 'more':    return <svg width={size} height={size} viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6" fill={color}/><circle cx="12" cy="12" r="1.6" fill={color}/><circle cx="19" cy="12" r="1.6" fill={color}/></svg>;
    case 'mic':     return <svg width={size} height={size} viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="12" rx="3" {...stroke} /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" {...stroke} /></svg>;
    case 'mic-off': return <svg width={size} height={size} viewBox="0 0 24 24"><path d="M9 5a3 3 0 0 1 6 0v6" {...stroke}/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16" {...stroke} /></svg>;
    case 'hand':    return <svg width={size} height={size} viewBox="0 0 24 24"><path d="M7 11V6a1.5 1.5 0 1 1 3 0v5M10 11V5a1.5 1.5 0 1 1 3 0v6M13 11V6a1.5 1.5 0 1 1 3 0v8M16 9a1.5 1.5 0 1 1 3 0v6a5 5 0 0 1-10 0" {...stroke}/></svg>;
    case 'sparkle': return <svg width={size} height={size} viewBox="0 0 24 24"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" fill={color}/><path d="M19 14l.7 1.8L21.5 16.5l-1.8.7L19 19l-.7-1.8-1.8-.7 1.8-.7L19 14z" fill={color}/></svg>;
    case 'chat':    return <svg width={size} height={size} viewBox="0 0 24 24"><path d="M4 6.5C4 5.7 4.7 5 5.5 5h13c.8 0 1.5.7 1.5 1.5v9c0 .8-.7 1.5-1.5 1.5H9l-4 3v-3H5.5c-.8 0-1.5-.7-1.5-1.5v-9z" {...stroke}/></svg>;
    case 'end':     return <svg width={size} height={size} viewBox="0 0 24 24"><path d="M3 14c0-3 4-5 9-5s9 2 9 5v1.5c0 .8-1 1.5-1.8 1.4l-2.7-.4c-.7-.1-1.3-.6-1.4-1.3l-.3-1.6c0-.5-.4-1-.9-1.1A14 14 0 0 0 12 12c-1.2 0-2.3.2-3.4.4-.5.1-.9.6-.9 1.1l-.3 1.6c-.1.7-.7 1.2-1.4 1.3l-2.7.4C2.5 17 1.5 16.3 1.5 15.5z" fill={color}/></svg>;
    case 'video':   return <svg width={size} height={size} viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="2.5" {...stroke}/><path d="M16 10l5-2.5v9L16 14" {...stroke}/></svg>;
    case 'video-off': return <svg width={size} height={size} viewBox="0 0 24 24"><path d="M3 6.5C3 6 3.4 5.5 4 5.5h12c.6 0 1 .5 1 1V14M16 17H4c-.6 0-1-.5-1-1V8" {...stroke}/><path d="M17 10l4-2v9l-4-2M3 3l18 18" {...stroke}/></svg>;
    case 'cc':      return <svg width={size} height={size} viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5" {...stroke}/><path d="M10 10.5c-.6-.6-1.4-1-2.3-1A2.7 2.7 0 0 0 5 12.2c0 1.5 1.2 2.7 2.7 2.7.9 0 1.7-.4 2.3-1M17 10.5c-.6-.6-1.4-1-2.3-1a2.7 2.7 0 0 0-2.7 2.7c0 1.5 1.2 2.7 2.7 2.7.9 0 1.7-.4 2.3-1" {...stroke}/></svg>;
    case 'share':   return <svg width={size} height={size} viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="12" rx="2" {...stroke}/><path d="M12 9v5M9.5 11.5L12 9l2.5 2.5M8 20h8" {...stroke}/></svg>;
    case 'invite':  return <svg width={size} height={size} viewBox="0 0 24 24"><circle cx="10" cy="9" r="3.2" {...stroke}/><path d="M4 19c.8-3 3.2-4.5 6-4.5s5.2 1.5 6 4.5M18 5v6M15 8h6" {...stroke}/></svg>;
    case 'note':    return <svg width={size} height={size} viewBox="0 0 24 24"><path d="M6 4h9l4 4v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" {...stroke}/><path d="M14 4v5h5M8 13h8M8 17h6" {...stroke}/></svg>;
    case 'gear':    return <svg width={size} height={size} viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" {...stroke}/><path d="M19 12a7 7 0 0 0-.2-1.7l2-1.5-2-3.4-2.3 1a7 7 0 0 0-3-1.7L13 2h-2l-.5 2.7a7 7 0 0 0-3 1.7l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .6.1 1.1.2 1.7l-2 1.5 2 3.4 2.3-1c.9.8 1.9 1.3 3 1.7L11 22h2l.5-2.7a7 7 0 0 0 3-1.7l2.3 1 2-3.4-2-1.5c.1-.6.2-1.1.2-1.7z" {...stroke}/></svg>;
    case 'feedback':return <svg width={size} height={size} viewBox="0 0 24 24"><path d="M4 5.5C4 4.7 4.7 4 5.5 4h13c.8 0 1.5.7 1.5 1.5v9c0 .8-.7 1.5-1.5 1.5H10l-4 4v-4H5.5c-.8 0-1.5-.7-1.5-1.5z" {...stroke}/><path d="M9 9h6M9 12h4" {...stroke}/></svg>;
    case 'wechat':  return <svg width={size} height={size} viewBox="0 0 24 24"><path d="M14.5 9c-3 0-5.5 2-5.5 4.5 0 1.5.9 2.7 2.2 3.5L11 19l2-1.2c.5.1 1 .2 1.5.2 3 0 5.5-2 5.5-4.5S17.5 9 14.5 9z" {...stroke}/><circle cx="13" cy="13" r=".9" fill={color}/><circle cx="16" cy="13" r=".9" fill={color}/></svg>;
    case 'compass': return <svg width={size} height={size} viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" {...stroke}/><path d="M15.5 8.5L13 13l-4.5 2.5L11 11l4.5-2.5z" fill={color}/></svg>;
    case 'clock':   return <svg width={size} height={size} viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" {...stroke}/><path d="M12 7v5l3 2" {...stroke}/></svg>;
    case 'route':   return <svg width={size} height={size} viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.5" {...stroke}/><circle cx="18" cy="18" r="2.5" {...stroke}/><path d="M8.5 6h7a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3h-7a3 3 0 0 0-3 3" {...stroke}/></svg>;
    case 'check':   return <svg width={size} height={size} viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" {...stroke} strokeWidth="2.4" /></svg>;
    case 'chev':    return <svg width={size} height={size} viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" {...stroke}/></svg>;
    case 'live':    return <svg width={size} height={size} viewBox="0 0 12 12"><circle cx="6" cy="6" r="4" fill={color}/></svg>;
    case 'filter':  return <svg width={size} height={size} viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4" {...stroke} strokeWidth="1.8"/></svg>;
    default: return null;
  }
}

Object.assign(window, {
  MR_HUMANS, MR_AIS, MR_HOST, MR_AGENDA, MR_MESSAGES,
  MRHumanAvatar, MRAIAvatar, MRHostAvatar, MRIcon,
});
