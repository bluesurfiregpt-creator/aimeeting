// Meeting history search — iOS-style mobile, PM use
const { useState, useMemo, useRef, useEffect } = React;

// ─────────── data ───────────
const PEOPLE = {
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

const MEETINGS = [
  {
    id: 'm1',
    title: 'Q3 路线图对齐 / Roadmap Sync',
    time: '今天 10:30',
    timeBucket: 'today',
    duration: '52 分钟',
    people: ['ZK', 'LM', 'WJ', 'CY', 'SL'],
    topic: '路线图',
    summary: '确认 Q3 重点放在搜索体验与团队协作两条主线,9 月底前完成会议摘要的智能体验升级,周凯负责优先级排序…',
    unread: true,
  },
  {
    id: 'm2',
    title: '搜索体验评审 #4',
    time: '今天 09:15',
    timeBucket: 'today',
    duration: '38 分钟',
    people: ['LM', 'WJ', 'HR'],
    topic: '产品评审',
    summary: '林敏走查了搜索结果页第 4 版,讨论了 chip 顺序与空状态文案,决定把"主题"放在"参与人"之前以匹配高频路径…',
    unread: false,
  },
  {
    id: 'm3',
    title: '客户访谈:Hummingbird 团队',
    time: '昨天 16:00',
    timeBucket: 'yesterday',
    duration: '1 小时 12 分',
    people: ['ZK', 'SL', 'TM'],
    topic: '用户研究',
    summary: '对方 12 人小团队,核心痛点是"开完会找不回结论",对自动摘要 + 关键决策提取兴趣很大,愿意做 2 周内测…',
    unread: false,
  },
  {
    id: 'm4',
    title: '本周 Standup',
    time: '昨天 09:30',
    timeBucket: 'yesterday',
    duration: '18 分钟',
    people: ['ZK', 'LM', 'WJ', 'CY', 'SL', 'HR', 'YQ'],
    topic: '同步',
    summary: '搜索 chip 进入联调,详情页过场动画待定;陈宇本周休假两天;叶倩接手客户访谈纪要整理…',
    unread: false,
  },
  {
    id: 'm5',
    title: '摘要模型 A/B 复盘',
    time: '周四 14:00',
    timeBucket: 'week',
    duration: '45 分钟',
    people: ['WJ', 'CY', 'RB'],
    topic: '数据复盘',
    summary: 'B 组(haiku-4.5 + 决策抽取)在 50 字摘要任务上的有用率比 A 组高 11.4 个百分点,但延迟多 380ms…',
    unread: false,
  },
  {
    id: 'm6',
    title: '设计周会',
    time: '周三 11:00',
    timeBucket: 'week',
    duration: '40 分钟',
    people: ['LM', 'HR', 'YQ'],
    topic: '设计',
    summary: '过了 3 套移动端搜索的视觉方向,最终选 iOS 系统应用密度;头像组合改成 3 个 + N 计数,避免横向溢出…',
    unread: false,
  },
  {
    id: 'm7',
    title: '与法务对齐:会议录音留存',
    time: '5 月 19 日',
    timeBucket: 'earlier',
    duration: '30 分钟',
    people: ['ZK', 'TM', 'RB'],
    topic: '合规',
    summary: '内部会议默认保留 90 天,外部客户会议需在邀请中明示并提供导出;Henry 会出一版同意书模板…',
    unread: false,
  },
  {
    id: 'm8',
    title: '招聘:高级产品设计师 终面',
    time: '5 月 17 日',
    timeBucket: 'earlier',
    duration: '55 分钟',
    people: ['ZK', 'LM', 'SL'],
    topic: '招聘',
    summary: '候选人作品集偏 B 端工具,系统化思考强,落地速度待验证;三位面试官一致推荐进入 offer 流程…',
    unread: false,
  },
];

const TIME_OPTIONS  = ['今天', '本周', '本月', '自定义'];
const PEOPLE_OPTIONS = Object.entries(PEOPLE).map(([k, v]) => ({ k, ...v }));
const TOPIC_OPTIONS = ['路线图', '产品评审', '用户研究', '同步', '数据复盘', '设计', '合规', '招聘'];

// ─────────── ui atoms ───────────
function Avatar({ id, size = 26, ring = '#fff' }) {
  const p = PEOPLE[id];
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

function AvatarStack({ ids, max = 3, size = 26 }) {
  const visible = ids.slice(0, max);
  const extra = ids.length - visible.length;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center' }}>
      {visible.map((id, i) => (
        <div key={id} style={{ marginLeft: i === 0 ? 0 : -8 }}>
          <Avatar id={id} size={size} />
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
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="7" {...stroke} />
          <path d="M20 20l-3.5-3.5" {...stroke} />
        </svg>
      );
    case 'mic':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <rect x="9" y="3" width="6" height="12" rx="3" {...stroke} />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" {...stroke} />
        </svg>
      );
    case 'x':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" fill="#C7C7CC" />
          <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'chev':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M9 6l6 6-6 6" {...stroke} />
        </svg>
      );
    case 'caret':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M7 10l5 5 5-5" {...stroke} />
        </svg>
      );
    case 'back':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M15 6l-6 6 6 6" {...stroke} strokeWidth="2" />
        </svg>
      );
    case 'sparkle':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" fill={color} />
          <path d="M19 14l.7 1.8L21.5 16.5l-1.8.7L19 19l-.7-1.8-1.8-.7 1.8-.7L19 14z" fill={color} />
        </svg>
      );
    default: return null;
  }
}

// ─────────── chip ───────────
function Chip({ label, value, active, onClick }) {
  const isOn = !!active;
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      height: 30, padding: '0 12px',
      borderRadius: 15, border: 'none',
      background: isOn ? '#007AFF' : '#F2F2F7',
      color: isOn ? '#fff' : '#000',
      fontSize: 14, fontWeight: 500,
      fontFamily: 'inherit',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      transition: 'background 120ms ease',
    }}>
      <span>{value && value !== '全部' ? value : label}</span>
      <Icon name="caret" size={14} color={isOn ? '#fff' : '#8E8E93'} />
    </button>
  );
}

// ─────────── filter sheet ───────────
function FilterSheet({ open, kind, value, onChange, onClose }) {
  if (!open) return null;
  const titles = { time: '按时间', people: '按参与人', topic: '按主题' };
  const opts = kind === 'time' ? TIME_OPTIONS
             : kind === 'topic' ? TOPIC_OPTIONS
             : PEOPLE_OPTIONS;

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
          <div style={{
            background: '#fff', borderRadius: 12, overflow: 'hidden',
          }}>
            {opts.map((opt, i) => {
              const isPeople = kind === 'people';
              const label = isPeople ? opt.name : opt;
              const selected = isPeople ? value === opt.k : value === opt;
              return (
                <div key={label} onClick={() => onChange(isPeople ? opt.k : opt)} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 16px',
                  borderTop: i === 0 ? 'none' : '0.5px solid rgba(60,60,67,0.12)',
                  cursor: 'pointer',
                }}>
                  {isPeople && <Avatar id={opt.k} size={28} />}
                  <div style={{ flex: 1, fontSize: 16 }}>{label}</div>
                  {selected && (
                    <svg width="20" height="20" viewBox="0 0 24 24">
                      <path d="M5 12.5l4.5 4.5L19 7.5" stroke="#007AFF" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
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

      {/* AI summary */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 6,
        marginTop: 4,
      }}>
        <div style={{ paddingTop: 2, flexShrink: 0 }}>
          <Icon name="sparkle" size={13} color="#AF52DE" />
        </div>
        <div style={{
          fontSize: 14, lineHeight: '20px', color: '#3C3C43',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>{m.summary}</div>
      </div>

      {/* meta: avatars + duration + topic */}
      <div style={{
        marginTop: 8, display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <AvatarStack ids={m.people} size={22} max={4} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 11, fontWeight: 500, color: '#5E5CE6',
            background: 'rgba(94,92,230,0.10)',
            padding: '2px 7px', borderRadius: 4,
          }}>{m.topic}</span>
          <span style={{ fontSize: 12, color: '#8E8E93' }}>{m.duration}</span>
        </div>
      </div>
    </div>
  );
}

// ─────────── section header ───────────
function SectionHeader({ label }) {
  return (
    <div style={{
      padding: '18px 16px 6px',
      fontSize: 13, fontWeight: 600, color: '#6D6D72',
      textTransform: 'uppercase', letterSpacing: 0.3,
    }}>{label}</div>
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
          placeholder="搜索会议、纪要、关键词"
          style={{
            flex: 1, border: 'none', outline: 'none',
            background: 'transparent', fontSize: 16, fontFamily: 'inherit',
            color: '#000',
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
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: '#F2F2F7',
      animation: leaving
        ? 'pushOutRight 280ms cubic-bezier(.32,.72,.35,1) forwards'
        : 'pushInRight 280ms cubic-bezier(.32,.72,.35,1) forwards',
      display: 'flex', flexDirection: 'column',
      zIndex: 30,
    }}>
      {/* nav */}
      <div style={{
        paddingTop: 54,
        height: 96,
        display: 'flex', alignItems: 'center',
        background: 'rgba(248,248,248,0.92)',
        backdropFilter: 'blur(20px)',
        borderBottom: '0.5px solid rgba(60,60,67,0.18)',
        position: 'relative',
      }}>
        <button onClick={onBack} style={{
          ...btnText('#007AFF'),
          display: 'flex', alignItems: 'center', gap: 2,
          padding: '0 8px 0 8px', height: 44,
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
            {m.time} · {m.duration}
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: 12, padding: 14, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <Icon name="sparkle" size={14} color="#AF52DE" />
            <div style={{ fontSize: 13, fontWeight: 600, color: '#3C3C43' }}>AI 摘要</div>
          </div>
          <div style={{ fontSize: 15, lineHeight: 1.5, color: '#1C1C1E' }}>
            {m.summary}…
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: 12, padding: '4px 14px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 0', borderBottom: '0.5px solid rgba(60,60,67,0.12)',
          }}>
            <div style={{ fontSize: 15, color: '#3C3C43' }}>参与人</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AvatarStack ids={m.people} size={24} max={5} />
            </div>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 0', borderBottom: '0.5px solid rgba(60,60,67,0.12)',
          }}>
            <div style={{ fontSize: 15, color: '#3C3C43' }}>主题</div>
            <div style={{ fontSize: 15 }}>{m.topic}</div>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 0',
          }}>
            <div style={{ fontSize: 15, color: '#3C3C43' }}>录音</div>
            <div style={{ fontSize: 15, color: '#007AFF' }}>播放 · {m.duration}</div>
          </div>
        </div>

        <div style={{ marginTop: 28, textAlign: 'center', color: '#C7C7CC', fontSize: 13 }}>
          — 详情页未实现,仅演示跳转动画 —
        </div>
      </div>
    </div>
  );
}

// ─────────── main page ───────────
function App() {
  const [query, setQuery]   = useState('');
  const [focused, setFocused] = useState(false);
  const [sheet, setSheet]   = useState(null); // 'time'|'people'|'topic'|null
  const [fTime, setFTime]   = useState('全部');
  const [fPeople, setFPeople] = useState('全部');
  const [fTopic, setFTopic] = useState('全部');

  const [openId, setOpenId] = useState(null);
  const [leaving, setLeaving] = useState(false);

  const filtered = useMemo(() => {
    return MEETINGS.filter(m => {
      if (query) {
        const q = query.toLowerCase();
        const peopleNames = m.people.map(p => PEOPLE[p].name).join(' ');
        if (!(m.title.toLowerCase().includes(q)
            || m.summary.toLowerCase().includes(q)
            || peopleNames.toLowerCase().includes(q)
            || m.topic.toLowerCase().includes(q))) return false;
      }
      if (fTime !== '全部') {
        const map = { '今天': 'today', '本周': ['today','yesterday','week'], '本月': ['today','yesterday','week','earlier'], '自定义': null };
        const t = map[fTime];
        if (t === null) {/* skip */}
        else if (Array.isArray(t)) { if (!t.includes(m.timeBucket)) return false; }
        else { if (m.timeBucket !== t) return false; }
      }
      if (fPeople !== '全部' && !m.people.includes(fPeople)) return false;
      if (fTopic !== '全部'  && m.topic !== fTopic) return false;
      return true;
    });
  }, [query, fTime, fPeople, fTopic]);

  // group by bucket
  const buckets = ['today','yesterday','week','earlier'];
  const bucketLabel = { today: '今天', yesterday: '昨天', week: '本周早些', earlier: '更早' };
  const grouped = buckets.map(b => ({ b, items: filtered.filter(m => m.timeBucket === b) }))
                          .filter(g => g.items.length > 0);

  const openDetail = (id) => { setOpenId(id); setLeaving(false); };
  const closeDetail = () => {
    setLeaving(true);
    setTimeout(() => { setOpenId(null); setLeaving(false); }, 280);
  };

  const peopleChipLabel = fPeople === '全部' ? '参与人' : PEOPLE[fPeople].name;

  const activeMeeting = MEETINGS.find(m => m.id === openId);

  return (
    <IOSDevice width={402} height={874}>
      {/* page content */}
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
        {/* nav header (large title style, simplified) */}
        <div style={{
          paddingTop: 54,
          background: '#fff',
          borderBottom: '0.5px solid rgba(60,60,67,0.12)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 16px 2px',
          }}>
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.3 }}>会议历史</div>
            <div style={{
              width: 30, height: 30, borderRadius: '50%',
              background: '#0A84FF',
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 600,
            }}>PM</div>
          </div>
          <SearchBar value={query} onChange={setQuery} focused={focused} setFocused={setFocused} />
          {/* chips */}
          <div style={{
            display: 'flex', gap: 8, overflowX: 'auto',
            padding: '0 16px 12px',
            scrollbarWidth: 'none',
          }}>
            <Chip label="时间" value={fTime} active={fTime !== '全部'} onClick={() => setSheet('time')} />
            <Chip label="参与人" value={peopleChipLabel} active={fPeople !== '全部'} onClick={() => setSheet('people')} />
            <Chip label="主题" value={fTopic} active={fTopic !== '全部'} onClick={() => setSheet('topic')} />
          </div>
        </div>

        {/* list */}
        <div style={{ flex: 1, overflow: 'auto', background: '#fff' }}>
          {grouped.length === 0 ? (
            <div style={{
              padding: '80px 32px', textAlign: 'center',
              color: '#8E8E93', fontSize: 15, lineHeight: 1.5,
            }}>
              <div style={{ fontSize: 34, marginBottom: 8, opacity: 0.5 }}>⌕</div>
              没有匹配的会议<br/>
              <span style={{ fontSize: 13 }}>试试调整筛选或换个关键词</span>
            </div>
          ) : grouped.map(g => (
            <div key={g.b}>
              <SectionHeader label={bucketLabel[g.b]} />
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

        <FilterSheet
          open={sheet === 'time'}
          kind="time"
          value={fTime}
          onChange={(v) => { setFTime(v); if (v === '全部') {} }}
          onClose={() => setSheet(null)}
        />
        <FilterSheet
          open={sheet === 'people'}
          kind="people"
          value={fPeople}
          onChange={(v) => setFPeople(v)}
          onClose={() => setSheet(null)}
        />
        <FilterSheet
          open={sheet === 'topic'}
          kind="topic"
          value={fTopic}
          onChange={(v) => setFTopic(v)}
          onClose={() => setSheet(null)}
        />

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
  /* hide scrollbars in chip strip */
  div::-webkit-scrollbar { display: none; }
  input::placeholder { color: #8E8E93; }
`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
