// Meeting Room — live in-meeting view
// 3 message kinds woven in one timeline:
//   • human transcript (voiceprint id)
//   • AI expert reply (manual @ summon, or routed by host)
//   • Mira host card (agenda · drift · routing)

const { useState, useMemo, useRef, useEffect } = React;

// ─────────── small UI atoms used only here ───────────
function Waveform({ active, color = '#34C759', bars = 5 }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, height: 14 }}>
      {Array.from({ length: bars }).map((_, i) => (
        <span key={i} style={{
          width: 2.5, borderRadius: 2, background: color,
          height: active ? 14 : 4,
          animation: active
            ? `wfBar 900ms ease-in-out ${i * 110}ms infinite alternate`
            : 'none',
        }} />
      ))}
    </div>
  );
}

function Dots() {
  return (
    <span style={{ display: 'inline-flex', gap: 3, marginLeft: 4 }}>
      {[0,1,2].map(i => (
        <span key={i} style={{
          width: 4, height: 4, borderRadius: '50%', background: '#8E8E93',
          animation: `dotBounce 1.1s ease-in-out ${i * 180}ms infinite`,
        }} />
      ))}
    </span>
  );
}

// ─────────── AI Roundtable (multi-expert) ───────────
const STANCE_COLOR = { support: '#34C759', caution: '#FF9F0A', block: '#FF3B30' };
const STANCE_LABEL = { support: '支持',   caution: '注意',   block: '反对' };

function StancePill({ stance, small }) {
  return (
    <span style={{
      fontSize: small ? 9 : 10, fontWeight: 700, color: '#fff', letterSpacing: 0.3,
      background: STANCE_COLOR[stance],
      padding: small ? '1px 5px' : '1.5px 6px', borderRadius: 3,
      flexShrink: 0, lineHeight: 1.2,
    }}>{STANCE_LABEL[stance]}</span>
  );
}

function StanceDot({ stance, size = 14 }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%',
      background: STANCE_COLOR[stance],
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      {stance === 'support' && <MRIcon name="check" size={size * 0.65} color="#fff" />}
      {stance === 'caution' && <span style={{ color: '#fff', fontSize: size * 0.72, fontWeight: 800, lineHeight: 1 }}>!</span>}
      {stance === 'block'   && <span style={{ color: '#fff', fontSize: size * 0.85, lineHeight: 0.7 }}>×</span>}
    </span>
  );
}

function MiraSynthesis({ summary, doneCount, total }) {
  if (!summary || !summary.points) {
    return (
      <div style={{
        padding: '12px 14px',
        background: 'linear-gradient(135deg, rgba(255,179,64,0.06), rgba(255,159,10,0.08))',
        borderBottom: '0.5px solid rgba(255,159,10,0.18)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <MRHostAvatar size={20} />
        <span style={{ fontSize: 13, color: '#8B6914' }}>
          Mira 等待 {total - doneCount} 位专家完成…
        </span>
        <Dots />
      </div>
    );
  }
  return (
    <div style={{
      padding: '12px 14px',
      background: 'linear-gradient(135deg, rgba(255,179,64,0.08), rgba(255,159,10,0.10))',
      borderBottom: '0.5px solid rgba(255,159,10,0.20)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <MRHostAvatar size={22} />
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1C1C1E' }}>Mira 综合</span>
        <span style={{
          fontSize: 11, color: '#8B6914', fontWeight: 700,
          background: 'rgba(255,159,10,0.15)', padding: '2px 8px', borderRadius: 4,
        }}>
          {summary.verdict}
        </span>
        {summary.conflict && (
          <span style={{
            fontSize: 10, color: '#fff', fontWeight: 700,
            background: '#FF3B30', padding: '2px 6px', borderRadius: 4,
          }}>存在分歧</span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {summary.points.map((p, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ marginTop: 3 }}><StanceDot stance={p.stance} size={14} /></span>
            <span style={{ fontSize: 13, lineHeight: 1.45, color: '#1C1C1E' }}>
              <span style={{ fontWeight: 600 }}>{p.tag}:</span>
              <span style={{ color: '#3C3C43' }}> {p.text}</span>
            </span>
          </div>
        ))}
      </div>
      <div style={{
        marginTop: 9, padding: '8px 10px', background: '#fff', borderRadius: 8,
        fontSize: 13, lineHeight: 1.5, color: '#1C1C1E',
        border: '0.5px solid rgba(255,159,10,0.20)',
      }}>
        <span style={{ fontWeight: 700, color: '#FF9F0A' }}>→ 建议</span>
        <span style={{ marginLeft: 5 }}>{summary.recommendation}</span>
      </div>
    </div>
  );
}

function ExpertAccordion({ expert, open, onToggle, last }) {
  const a = MR_AIS[expert.who];
  return (
    <div style={{ borderTop: '0.5px solid rgba(60,60,67,0.10)' }}>
      <div onClick={onToggle} style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        cursor: 'pointer',
        background: open ? '#FAFAFA' : '#fff',
        WebkitTapHighlightColor: 'rgba(0,0,0,0.04)',
      }}>
        <MRAIAvatar id={expert.who} size={28} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{a.name}</span>
            <StancePill stance={expert.stance} />
            <span style={{ fontSize: 11, color: '#8E8E93' }}>{a.role}</span>
            {!expert.done && (
              <span style={{ fontSize: 10, color: '#5E5CE6', fontWeight: 600 }}>分析中<Dots /></span>
            )}
          </div>
          <div style={{
            fontSize: 12.5, color: '#3C3C43', marginTop: 2, lineHeight: 1.4,
            overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: open ? 'normal' : 'nowrap',
          }}>{expert.headline}</div>
        </div>
        <div style={{
          flexShrink: 0, color: '#C7C7CC',
          transform: open ? 'rotate(90deg)' : 'rotate(0)',
          transition: 'transform 180ms ease',
        }}>
          <MRIcon name="chev" size={16} color="#C7C7CC" />
        </div>
      </div>

      {open && expert.done && (
        <div style={{ padding: '2px 14px 14px' }}>
          <div style={{ fontSize: 13.5, lineHeight: 1.55, color: '#1C1C1E', marginBottom: 9 }}>
            {expert.summary}
          </div>
          {expert.data && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${expert.data.length}, 1fr)`,
              gap: 6, marginBottom: 9,
            }}>
              {expert.data.map((row, i) => (
                <div key={i} style={{
                  background: '#F7F7F9', borderRadius: 8, padding: '7px 9px',
                }}>
                  <div style={{ fontSize: 10, color: '#8E8E93', fontWeight: 600, letterSpacing: 0.3 }}>{row.label}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>{row.v}</div>
                </div>
              ))}
            </div>
          )}
          {expert.note && (
            <div style={{
              fontSize: 12.5, lineHeight: 1.5, color: '#3C3C43',
              padding: '8px 10px', borderRadius: 8,
              background: `linear-gradient(135deg, ${a.grad[0]}10, ${a.grad[1]}10)`,
              border: `0.5px solid ${a.grad[0]}33`,
            }}>{expert.note}</div>
          )}
        </div>
      )}
    </div>
  );
}

function RoundMessage({ m, initialOpen }) {
  const [open, setOpen] = useState(initialOpen || null);
  const doneCount = m.experts.filter(e => e.done).length;
  return (
    <div style={{ padding: '10px 16px' }}>
      <div style={{
        background: '#fff', borderRadius: 14,
        border: '0.5px solid rgba(60,60,67,0.14)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        overflow: 'hidden',
      }}>
        {/* header */}
        <div style={{
          padding: '11px 14px 9px',
          background: 'linear-gradient(135deg, rgba(94,92,230,0.05), rgba(175,82,222,0.07))',
          borderBottom: '0.5px solid rgba(60,60,67,0.10)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <MRIcon name="sparkle" size={14} color="#5E5CE6" />
            <span style={{ fontSize: 11.5, fontWeight: 700, color: '#5E5CE6', letterSpacing: 0.4 }}>
              AI 圆桌 · {doneCount}/{m.experts.length} 已答
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#8E8E93' }}>
              {MR_HUMANS[m.trigger.by].name} 发起 · {m.t}
            </span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4, lineHeight: 1.35 }}>
            "{m.topic}"
          </div>
        </div>

        {/* Mira synthesis */}
        <MiraSynthesis summary={m.done ? m.miraSummary : null} doneCount={doneCount} total={m.experts.length} />

        {/* Experts accordion */}
        <div style={{
          padding: '7px 14px 6px',
          fontSize: 10.5, fontWeight: 700, color: '#8E8E93', letterSpacing: 0.4,
          background: '#fff',
        }}>点击展开专家详情 · 一次只展开一位,timeline 不跳动</div>
        {m.experts.map((e, i) => (
          <ExpertAccordion key={e.who} expert={e}
            open={open === e.who}
            onToggle={() => setOpen(open === e.who ? null : e.who)}
            last={i === m.experts.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

// ─────────── Chapter Divider (replaces agenda-tone host messages) ───────────
function ChapterDivider({ m }) {
  // Parse m.body for the new-agenda title (after the "进入议程 N:" pattern)
  const match = (m.body || '').match(/议程\s*(\d+)\s*[:：](.+?)$/);
  const newNum = match ? parseInt(match[1]) : null;
  const newTitle = match ? match[2].trim() : null;
  const agenda = newNum ? MR_AGENDA.find(a => a.id === newNum) : null;
  return (
    <div style={{ padding: '22px 16px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, height: 0.5, background: '#C7C7CC' }} />
        <span style={{
          fontSize: 10, fontWeight: 700, color: '#8E8E93',
          letterSpacing: 0.8, textTransform: 'uppercase',
        }}>议程 {newNum || '—'} / {MR_AGENDA.length}</span>
        <div style={{ flex: 1, height: 0.5, background: '#C7C7CC' }} />
      </div>
      <div style={{
        textAlign: 'center', fontSize: 17, fontWeight: 700, color: '#1C1C1E',
        marginTop: 8, letterSpacing: -0.2,
      }}>{newTitle || m.title}</div>
      <div style={{
        textAlign: 'center', fontSize: 12, color: '#8E8E93', marginTop: 4,
        display: 'inline-flex', justifyContent: 'center', gap: 8, width: '100%',
      }}>
        {agenda && <><span>{agenda.minutes} 分钟</span><span>·</span></>}
        <span style={{ color: '#34C759', fontWeight: 600 }}>议程 {newNum - 1} 完成 ✓</span>
        <span>·</span>
        <span>{m.t}</span>
      </div>
    </div>
  );
}

// ─────────── Highlights / Chapters ───────────
function getHighlights() {
  const hl = [];
  MR_MESSAGES.forEach((m, i) => {
    if (m.kind === 'host') {
      if (m.tone === 'agenda') {
        const match = (m.body || '').match(/议程\s*(\d+)\s*[:：](.+?)$/);
        hl.push({ idx: i, type: 'agenda', icon: 'check', color: '#34C759',
          label: '议程切换', title: match ? match[2].trim() : m.title, t: m.t });
      } else if (m.tone === 'drift-strong') {
        hl.push({ idx: i, type: 'strong', icon: 'compass', color: '#FF3B30',
          label: '强提醒', title: m.title, t: m.t });
      } else if (m.tone === 'drift') {
        hl.push({ idx: i, type: 'drift', icon: 'compass', color: '#FF9F0A',
          label: '偏离提醒', title: m.title, t: m.t });
      } else if (m.tone === 'route') {
        hl.push({ idx: i, type: 'route', icon: 'route', color: '#FF9F0A',
          label: '问题路由', title: m.title, t: m.t });
      }
    } else if (m.kind === 'round') {
      hl.push({ idx: i, type: 'round', icon: 'sparkle', color: '#5E5CE6',
        label: `AI 圆桌 · ${m.experts.length} 位`, title: m.topic, t: m.t });
    }
  });
  return hl;
}

function HighlightsSheet({ open, onClose, onJump }) {
  if (!open) return null;
  const hl = getHighlights();
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
        maxHeight: '76%', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 6 }}>
          <div style={{ width: 36, height: 5, borderRadius: 3, background: '#D1D1D6' }} />
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px 8px',
        }}>
          <div style={{ width: 50 }} />
          <div style={{ fontSize: 16, fontWeight: 600 }}>章节 · 重要时刻</div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#007AFF',
            fontSize: 16, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
          }}>完成</button>
        </div>
        <div style={{ padding: '4px 16px 0', overflow: 'auto' }}>
          <div style={{
            fontSize: 12, color: '#8E8E93', padding: '0 4px 10px', lineHeight: 1.5,
          }}>本场会议自动提取的 {hl.length} 个关键节点 · 点击跳转</div>
          <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden' }}>
            {hl.map((h, i) => (
              <div key={i} onClick={() => { onJump(h.idx); onClose(); }} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px',
                borderTop: i === 0 ? 'none' : '0.5px solid rgba(60,60,67,0.10)',
                cursor: 'pointer',
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: h.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <MRIcon name={h.icon} size={15} color="#fff" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: h.color, letterSpacing: 0.3 }}>{h.label}</span>
                    <span style={{ fontSize: 11, color: '#8E8E93' }}>· {h.t}</span>
                  </div>
                  <div style={{
                    fontSize: 13.5, fontWeight: 500, color: '#1C1C1E', marginTop: 1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{h.title}</div>
                </div>
                <MRIcon name="chev" size={16} color="#C7C7CC" />
              </div>
            ))}
          </div>
          <div style={{ height: 16 }} />
        </div>
      </div>
    </>
  );
}

// ─────────── Header ───────────
function MRHeader({ timer, onFilter, filterActive, onChapters }) {
  return (
    <div style={{
      paddingTop: 54,
      background: '#fff',
      borderBottom: '0.5px solid rgba(60,60,67,0.12)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center',
        height: 44, padding: '0 4px',
      }}>
        <a href="index.html" style={{
          color: '#007AFF', textDecoration: 'none',
          display: 'inline-flex', alignItems: 'center', padding: '0 8px', height: 44,
          fontSize: 17,
        }}>
          <MRIcon name="back" size={22} color="#007AFF" />
          <span style={{ marginLeft: 2 }}>历史</span>
        </a>
        <div style={{ flex: 1, textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.1 }}>Q3 路线图对齐</div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            fontSize: 11, color: '#FF3B30', marginTop: 2,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', background: '#FF3B30',
              animation: 'livePulse 1.4s ease-in-out infinite',
            }} />
            <span style={{ fontWeight: 600, letterSpacing: 0.3 }}>实时</span>
            <span style={{ color: '#8E8E93' }}>· {timer}</span>
          </div>
        </div>
        <button onClick={onChapters} title="章节" style={{
          width: 36, height: 44, border: 'none', background: 'none', cursor: 'pointer',
          color: '#007AFF',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M5 6h14M5 12h14M5 18h14" stroke="#007AFF" strokeWidth="1.6" strokeLinecap="round"/>
            <circle cx="3" cy="6" r="1" fill="#007AFF"/><circle cx="3" cy="12" r="1" fill="#007AFF"/><circle cx="3" cy="18" r="1" fill="#007AFF"/>
          </svg>
        </button>
        <button onClick={onFilter} style={{
          width: 36, height: 44, border: 'none', background: 'none', cursor: 'pointer',
          color: '#007AFF', position: 'relative',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <MRIcon name="filter" size={20} color="#007AFF" />
          {filterActive && (
            <span style={{
              position: 'absolute', top: 6, right: 6,
              width: 8, height: 8, borderRadius: '50%',
              background: '#007AFF', border: '1.5px solid #fff',
            }} />
          )}
        </button>
      </div>
    </div>
  );
}

// ─────────── Agenda strip ───────────
function AgendaStrip() {
  const cur = MR_AGENDA.find(a => a.state === 'active');
  return (
    <div style={{
      background: '#fff', padding: '8px 16px 12px',
      borderBottom: '0.5px solid rgba(60,60,67,0.12)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#8E8E93', letterSpacing: 0.3 }}>
            议程 {cur.id}/{MR_AGENDA.length}
          </span>
          <span style={{
            fontSize: 13, fontWeight: 600, color: '#1C1C1E',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{cur.title}</span>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, color: '#FF9F0A', fontWeight: 600 }}>
          <MRIcon name="clock" size={13} color="#FF9F0A" />
          剩 {cur.remaining} 分钟
        </div>
      </div>
      {/* segmented progress */}
      <div style={{ display: 'flex', gap: 4 }}>
        {MR_AGENDA.map(a => (
          <div key={a.id} style={{
            flex: a.minutes, height: 4, borderRadius: 2,
            background: a.state === 'done' ? '#34C759'
                      : a.state === 'active' ? 'linear-gradient(90deg, #007AFF 70%, rgba(0,122,255,0.25) 70%)'
                      : '#E5E5EA',
          }} />
        ))}
      </div>
    </div>
  );
}

// ─────────── Participants strip ───────────
function ParticipantsStrip() {
  return (
    <div style={{
      background: '#fff',
      padding: '10px 16px 12px',
      borderBottom: '0.5px solid rgba(60,60,67,0.12)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#8E8E93', letterSpacing: 0.3 }}>
          参会 · {Object.keys(MR_HUMANS).length} 人 + {Object.keys(MR_AIS).length} AI 专家
        </div>
        <div style={{ fontSize: 12, color: '#007AFF' }}>查看全部</div>
      </div>
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 2 }}>
        {/* host */}
        <Participant kind="host" />
        {/* humans */}
        {Object.entries(MR_HUMANS).map(([k, p]) => (
          <Participant key={k} kind="human" id={k} />
        ))}
        {/* ais */}
        {Object.entries(MR_AIS).map(([k, a]) => (
          <Participant key={k} kind="ai" id={k} />
        ))}
      </div>
    </div>
  );
}

function Participant({ kind, id }) {
  let avatar, name, sub;
  if (kind === 'host') {
    avatar = <MRHostAvatar size={40} />;
    name = MR_HOST.name; sub = '主持人';
  } else if (kind === 'human') {
    const p = MR_HUMANS[id];
    avatar = <MRHumanAvatar id={id} size={40} showStatus={true} />;
    name = p.name; sub = p.speaking ? '正在说话' : p.muted ? '已静音' : p.role;
  } else {
    const a = MR_AIS[id];
    avatar = <MRAIAvatar id={id} size={40} />;
    name = a.name; sub = a.role;
  }
  const subColor = kind === 'human' && MR_HUMANS[id]?.speaking ? '#34C759' : '#8E8E93';
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      width: 56, flexShrink: 0,
    }}>
      {avatar}
      <div style={{ fontSize: 11, fontWeight: 600, color: '#1C1C1E', marginTop: 4,
        maxWidth: 56, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{name}</div>
      <div style={{ fontSize: 10, color: subColor, lineHeight: 1.1, marginTop: 1 }}>{sub}</div>
    </div>
  );
}

// ─────────── Messages ───────────
function HumanMessage({ m }) {
  const p = MR_HUMANS[m.who];
  return (
    <div style={{ display: 'flex', gap: 10, padding: '8px 16px' }}>
      <MRHumanAvatar id={m.who} size={32} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#1C1C1E' }}>{p.name}</span>
          <span style={{ fontSize: 11, color: '#8E8E93' }}>{p.role} · {m.t}</span>
          {p.speaking && <Waveform active={true} />}
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.45, color: '#1C1C1E' }}>
          {renderTextWithMentions(m.text)}
          {m.partial && <Dots />}
        </div>
        {m.summon && (
          <div style={{
            marginTop: 4, fontSize: 11, color: '#5E5CE6',
            display: 'inline-flex', alignItems: 'center', gap: 3,
          }}>
            <MRIcon name="sparkle" size={11} color="#5E5CE6" />
            唤醒 {MR_AIS[m.summon].name}
          </div>
        )}
        {m.askHost && (
          <div style={{
            marginTop: 4, fontSize: 11, color: '#FF9F0A',
            display: 'inline-flex', alignItems: 'center', gap: 3,
          }}>
            <MRIcon name="compass" size={11} color="#FF9F0A" />
            向主持人提问
          </div>
        )}
        {m.offTopic && (
          <div style={{
            marginTop: 4, fontSize: 11, color: '#FF453A',
            display: 'inline-flex', alignItems: 'center', gap: 3,
          }}>
            <MRIcon name="compass" size={11} color="#FF453A" />
            话题偏离当前议程
          </div>
        )}
      </div>
    </div>
  );
}

function renderTextWithMentions(text) {
  // Highlight @Name / @主持人 inline
  const parts = text.split(/(@\S+)/);
  return parts.map((p, i) => {
    if (p.startsWith('@')) {
      return <span key={i} style={{ color: '#5E5CE6', fontWeight: 500 }}>{p}</span>;
    }
    return <span key={i}>{p}</span>;
  });
}

function AIMessage({ m }) {
  const a = MR_AIS[m.who];
  return (
    <div style={{ padding: '8px 16px' }}>
      <div style={{
        background: '#fff', borderRadius: 14,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        border: '0.5px solid rgba(60,60,67,0.12)',
        overflow: 'hidden', position: 'relative',
      }}>
        {/* gradient accent bar */}
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
          background: `linear-gradient(180deg, ${a.grad[0]}, ${a.grad[1]})`,
        }} />
        <div style={{ padding: '11px 13px 12px 14px' }}>
          {/* header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MRAIAvatar id={m.who} size={26} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{a.name}</span>
                <span style={{ fontSize: 11, color: '#8E8E93' }}>{a.role}</span>
              </div>
              <div style={{ fontSize: 10, color: '#8E8E93', marginTop: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                {m.via?.kind === 'summon' && (<>
                  <MRIcon name="sparkle" size={9} color="#5E5CE6" />
                  由 {MR_HUMANS[m.via.by].name} 唤醒 · {m.t}
                </>)}
                {m.via?.kind === 'host' && (<>
                  <MRIcon name="route" size={10} color="#FF9F0A" />
                  由主持人转交 · {m.t}
                </>)}
              </div>
            </div>
          </div>

          {/* body */}
          <div style={{ marginTop: 9, fontSize: 14, lineHeight: 1.5, color: '#1C1C1E' }}>
            {m.body}
          </div>

          {/* structured data */}
          {m.data && (
            <div style={{
              marginTop: 8, background: '#F7F7F9', borderRadius: 8,
              padding: '6px 10px',
            }}>
              {m.data.map((row, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between',
                  padding: '5px 0',
                  borderTop: i === 0 ? 'none' : '0.5px solid rgba(60,60,67,0.10)',
                  fontSize: 13,
                }}>
                  <span style={{ color: '#3C3C43' }}>{row.label}</span>
                  <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{row.v}</span>
                </div>
              ))}
            </div>
          )}

          {m.note && (
            <div style={{
              marginTop: 8, fontSize: 13, lineHeight: 1.45, color: '#3C3C43',
              padding: '8px 10px', borderRadius: 8,
              background: `linear-gradient(135deg, ${a.grad[0]}0F, ${a.grad[1]}0F)`,
              border: `0.5px solid ${a.grad[0]}33`,
            }}>{m.note}</div>
          )}

          {m.actions && (
            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              {m.actions.map((label, i) => (
                <button key={i} style={{
                  flex: 1, height: 32, borderRadius: 8,
                  border: i === 0 ? 'none' : '0.5px solid rgba(60,60,67,0.16)',
                  background: i === 0 ? '#007AFF' : '#fff',
                  color: i === 0 ? '#fff' : '#007AFF',
                  fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                  cursor: 'pointer',
                }}>{label}</button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HostMessage({ m }) {
  // Level 1 — soft watch: compact inline strip, no card
  if (m.tone === 'drift-soft') {
    return (
      <div style={{ padding: '4px 16px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px',
          background: 'rgba(255,159,10,0.07)',
          borderLeft: '2px solid #FFB340',
          borderRadius: '0 8px 8px 0',
        }}>
          <MRHostAvatar size={16} />
          <MRIcon name="compass" size={12} color="#B8860B" />
          <span style={{ fontSize: 12, color: '#8B6914', flex: 1, lineHeight: 1.4 }}>
            <span style={{ fontWeight: 600 }}>Mira</span> · {m.body}
          </span>
          <span style={{ fontSize: 10, color: '#B8860B' }}>{m.t}</span>
        </div>
      </div>
    );
  }

  // Level 3 — strong intervention: red pulse + countdown + bigger CTAs
  if (m.tone === 'drift-strong') {
    return (
      <div style={{ padding: '10px 16px' }}>
        <div style={{
          background: 'linear-gradient(135deg, rgba(255,59,48,0.08), rgba(255,69,58,0.14))',
          borderRadius: 14,
          border: '1px solid rgba(255,59,48,0.45)',
          padding: '12px 14px 14px',
          animation: 'urgentPulse 2.2s ease-in-out infinite',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ position: 'relative' }}>
              <MRHostAvatar size={28} />
              {/* small red badge */}
              <span style={{
                position: 'absolute', right: -2, bottom: -2,
                width: 12, height: 12, borderRadius: '50%',
                background: '#FF3B30', border: '1.5px solid #fff',
              }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{MR_HOST.name}</span>
                <span style={{ fontSize: 11, color: '#8E8E93' }}>主持人</span>
                <span style={{ fontSize: 11, color: '#8E8E93', marginLeft: 'auto' }}>{m.t}</span>
              </div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 2,
              }}>
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', background: '#FF3B30',
                  animation: 'livePulse 1.2s ease-in-out infinite',
                }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#FF3B30', letterSpacing: 0.4 }}>
                  强提醒 · 需立即处理
                </span>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              flexShrink: 0, width: 64,
              background: '#fff', border: '1px solid rgba(255,59,48,0.30)',
              borderRadius: 10, padding: '6px 0', textAlign: 'center',
            }}>
              <div style={{ fontSize: 10, color: '#8E8E93', fontWeight: 600, letterSpacing: 0.3 }}>议程剩余</div>
              <div style={{
                fontSize: 19, fontWeight: 700, color: '#FF3B30',
                fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5,
                lineHeight: 1.1, marginTop: 1,
              }}>{m.countdown}</div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1C1C1E' }}>{m.title}</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.45, color: '#3C3C43', marginTop: 2 }}>{m.body}</div>
            </div>
          </div>

          {m.actions && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {m.actions.map((a, i) => (
                <button key={i} style={{
                  height: a.urgent ? 38 : 32, padding: '0 14px',
                  borderRadius: 10,
                  border: a.primary ? 'none' : '0.5px solid rgba(60,60,67,0.16)',
                  background: a.primary
                    ? (a.urgent ? '#FF3B30' : '#FF9F0A')
                    : '#fff',
                  color: a.primary ? '#fff' : '#1C1C1E',
                  fontSize: a.urgent ? 14 : 13, fontWeight: 600,
                  fontFamily: 'inherit', cursor: 'pointer',
                  boxShadow: a.urgent ? '0 2px 6px rgba(255,59,48,0.30)' : 'none',
                }}>{a.label}</button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Default — Levels 2 (drift), agenda, route, timer
  const toneMeta = {
    agenda: { icon: 'check',   color: '#34C759', label: '议程切换' },
    drift:  { icon: 'compass', color: '#FF9F0A', label: '话题偏移 · 中度提醒' },
    route:  { icon: 'route',   color: '#FF9F0A', label: '问题拆解' },
    timer:  { icon: 'clock',   color: '#FF9F0A', label: '时间提醒' },
  };
  const meta = toneMeta[m.tone] || toneMeta.agenda;
  return (
    <div style={{ padding: '10px 16px' }}>
      <div style={{
        background: 'linear-gradient(135deg, rgba(255,179,64,0.06), rgba(255,159,10,0.10))',
        borderRadius: 14,
        border: '0.5px solid rgba(255,159,10,0.30)',
        padding: '11px 14px 13px',
        position: 'relative',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <MRHostAvatar size={26} />
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{MR_HOST.name}</span>
              <span style={{ fontSize: 11, color: '#8E8E93' }}>主持人</span>
              <span style={{ fontSize: 11, color: '#8E8E93', marginLeft: 'auto' }}>{m.t}</span>
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <MRIcon name={meta.icon} size={11} color={meta.color} />
              <span style={{ fontSize: 11, fontWeight: 600, color: meta.color, letterSpacing: 0.3 }}>{meta.label}</span>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 8 }}>
          {m.title && (
            <div style={{ fontSize: 14, fontWeight: 600, color: '#1C1C1E', marginBottom: 3 }}>
              {m.title}
            </div>
          )}
          {m.body && (
            <div style={{ fontSize: 13, lineHeight: 1.5, color: '#3C3C43' }}>
              {m.body}
            </div>
          )}
          {m.items && (
            <div style={{ marginTop: 4 }}>
              {m.items.map((it, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 8,
                  padding: '7px 0',
                  borderTop: i === 0 ? 'none' : '0.5px solid rgba(60,60,67,0.10)',
                }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: '50%',
                    background: it.done ? '#34C759' : '#fff',
                    border: it.done ? 'none' : '1.5px solid #FF9F0A',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, marginTop: 2,
                  }}>
                    {it.done && <MRIcon name="check" size={11} color="#fff" />}
                    {it.loading && <span style={{
                      width: 6, height: 6, borderRadius: '50%', background: '#FF9F0A',
                      animation: 'livePulse 1.2s ease-in-out infinite',
                    }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#1C1C1E', display: 'flex', alignItems: 'center', gap: 4 }}>
                      {it.label}
                      {it.loading && <Dots />}
                    </div>
                    {it.detail && <div style={{ fontSize: 12, color: '#8E8E93', marginTop: 1 }}>{it.detail}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {m.actions && (
          <div style={{
            marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6,
          }}>
            {m.actions.map((a, i) => (
              <button key={i} style={{
                height: 30, padding: '0 12px', borderRadius: 8,
                border: a.primary ? 'none' : '0.5px solid rgba(255,159,10,0.4)',
                background: a.primary ? '#FF9F0A' : '#fff',
                color: a.primary ? '#fff' : '#B8860B',
                fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                cursor: 'pointer',
              }}>{a.label}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────── Speaker filter sheet (multi-select) ───────────
function speakerKeyOf(m) {
  if (m.kind === 'host') return 'host';
  if (m.kind === 'round') return 'round';
  return m.who;
}
function roundMatchesFilter(m, selected) {
  if (selected.size === 0) return true;
  if (m.kind !== 'round') return selected.has(speakerKeyOf(m));
  // round shows if host OR any of its experts is selected
  const keys = ['host', ...m.experts.map(e => e.who)];
  return keys.some(k => selected.has(k));
}
function roundInitialOpen(m, selected) {
  if (m.kind !== 'round' || selected.size === 0) return null;
  const e = m.experts.find(x => selected.has(x.who));
  return e ? e.who : null;
}
function speakerLabel(key) {
  if (key === 'host') return MR_HOST.name;
  if (MR_HUMANS[key]) return MR_HUMANS[key].name;
  if (MR_AIS[key])    return MR_AIS[key].name;
  return key;
}
function SpeakerAvatar({ k, size = 28 }) {
  if (k === 'host')    return <MRHostAvatar size={size} />;
  if (MR_HUMANS[k])    return <MRHumanAvatar id={k} size={size} />;
  if (MR_AIS[k])       return <MRAIAvatar id={k} size={size} />;
  return null;
}

function FilterSheet({ open, selected, onChange, onClose, counts }) {
  if (!open) return null;
  const allKeys = ['host', ...Object.keys(MR_HUMANS), ...Object.keys(MR_AIS)];
  const toggle = (k) => {
    const next = new Set(selected);
    if (next.has(k)) next.delete(k); else next.add(k);
    onChange(next);
  };
  const clear = () => onChange(new Set());

  const Section = ({ title, keys }) => (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#8E8E93',
        letterSpacing: 0.3, padding: '0 4px 6px' }}>{title}</div>
      <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden' }}>
        {keys.map((k, i) => {
          const sel = selected.has(k);
          const sub = k === 'host' ? MR_HOST.role
                    : MR_HUMANS[k] ? MR_HUMANS[k].role
                    : MR_AIS[k] ? MR_AIS[k].role : '';
          const count = counts[k] || 0;
          return (
            <div key={k} onClick={() => toggle(k)} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '9px 14px',
              borderTop: i === 0 ? 'none' : '0.5px solid rgba(60,60,67,0.12)',
              cursor: 'pointer',
            }}>
              <SpeakerAvatar k={k} size={30} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 500, color: '#1C1C1E' }}>{speakerLabel(k)}</div>
                <div style={{ fontSize: 12, color: '#8E8E93', marginTop: 1 }}>
                  {sub} · {count} 条发言
                </div>
              </div>
              <div style={{
                width: 22, height: 22, borderRadius: 6,
                background: sel ? '#007AFF' : 'transparent',
                border: sel ? 'none' : '1.5px solid #C7C7CC',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {sel && <MRIcon name="check" size={14} color="#fff" />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      <div onClick={onClose} style={{
        position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 80,
        animation: 'fadeIn 180ms ease',
      }} />
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        background: '#F2F2F7', borderTopLeftRadius: 14, borderTopRightRadius: 14,
        zIndex: 81, paddingBottom: 34,
        animation: 'slideUp 240ms cubic-bezier(.22,.61,.36,1)',
        maxHeight: '82%', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 6 }}>
          <div style={{ width: 36, height: 5, borderRadius: 3, background: '#D1D1D6' }} />
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px 6px',
        }}>
          <button onClick={clear} disabled={selected.size === 0} style={{
            background: 'none', border: 'none',
            color: selected.size === 0 ? '#C7C7CC' : '#007AFF',
            fontSize: 16, fontFamily: 'inherit',
            cursor: selected.size === 0 ? 'default' : 'pointer',
          }}>清空</button>
          <div style={{ fontSize: 16, fontWeight: 600 }}>筛选发言</div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#007AFF',
            fontSize: 16, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
          }}>完成</button>
        </div>

        <div style={{ padding: '4px 16px 0', overflow: 'auto' }}>
          <div style={{
            fontSize: 12, color: '#8E8E93', lineHeight: 1.5,
            padding: '0 4px',
          }}>
            勾选 1 人或多人,timeline 仅显示其发言。会议中和会后归档都可用。
          </div>
          <Section title="主持人" keys={['host']} />
          <Section title={`团队成员 · ${Object.keys(MR_HUMANS).length} 人`} keys={Object.keys(MR_HUMANS)} />
          <Section title={`AI 专家 · ${Object.keys(MR_AIS).length} 位`} keys={Object.keys(MR_AIS)} />
          <div style={{ height: 16 }} />
        </div>
      </div>
    </>
  );
}

// ─────────── Filter status banner (sticky atop transcript) ───────────
function FilterBanner({ selected, matched, total, onChange, onOpen }) {
  if (selected.size === 0) return null;
  const keys = [...selected];
  const remove = (k) => {
    const next = new Set(selected); next.delete(k); onChange(next);
  };
  const clear = () => onChange(new Set());

  return (
    <div style={{
      background: 'rgba(0,122,255,0.08)',
      borderBottom: '0.5px solid rgba(0,122,255,0.20)',
      padding: '8px 12px 8px 14px',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <MRIcon name="filter" size={14} color="#007AFF" />
      <div style={{ fontSize: 12, fontWeight: 600, color: '#007AFF', flexShrink: 0 }}>
        仅显示
      </div>
      <div style={{
        flex: 1, minWidth: 0, display: 'flex', gap: 5,
        overflowX: 'auto', scrollbarWidth: 'none',
      }}>
        {keys.map(k => (
          <button key={k} onClick={() => remove(k)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: '#fff', border: '0.5px solid rgba(0,122,255,0.30)',
            borderRadius: 12, padding: '2px 8px 2px 3px',
            fontSize: 12, fontWeight: 500, color: '#1C1C1E',
            fontFamily: 'inherit', cursor: 'pointer', flexShrink: 0,
            whiteSpace: 'nowrap',
          }}>
            <SpeakerAvatar k={k} size={18} />
            {speakerLabel(k)}
            <svg width="11" height="11" viewBox="0 0 24 24" style={{ marginLeft: 1 }}>
              <path d="M6 6l12 12M18 6L6 18" stroke="#8E8E93" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        ))}
      </div>
      <div style={{ fontSize: 11, color: '#8E8E93', flexShrink: 0 }}>
        {matched}/{total}
      </div>
      <button onClick={clear} style={{
        background: 'none', border: 'none', color: '#007AFF',
        fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
        padding: '0 2px', flexShrink: 0,
      }}>清除</button>
    </div>
  );
}

// ─────────── @ summon sheet ───────────
function SummonSheet({ open, onClose }) {
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{
        position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 80,
        animation: 'fadeIn 180ms ease',
      }} />
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        background: '#F2F2F7', borderTopLeftRadius: 14, borderTopRightRadius: 14,
        zIndex: 81, paddingBottom: 34,
        animation: 'slideUp 240ms cubic-bezier(.22,.61,.36,1)',
        maxHeight: '74%', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 6 }}>
          <div style={{ width: 36, height: 5, borderRadius: 3, background: '#D1D1D6' }} />
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px 8px',
        }}>
          <div style={{ width: 50 }} />
          <div style={{ fontSize: 16, fontWeight: 600 }}>唤醒 AI 专家</div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#007AFF',
            fontSize: 16, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
          }}>完成</button>
        </div>
        <div style={{ padding: '4px 16px 0', overflow: 'auto' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: '4px 0' }}>
            {Object.entries(MR_AIS).map(([k, a], i) => (
              <div key={k} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px',
                borderTop: i === 0 ? 'none' : '0.5px solid rgba(60,60,67,0.12)',
                cursor: 'pointer',
              }} onClick={onClose}>
                <MRAIAvatar id={k} size={36} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{a.name}</div>
                  <div style={{ fontSize: 12, color: '#8E8E93' }}>{a.role}</div>
                </div>
                <MRIcon name="chev" size={16} color="#C7C7CC" />
              </div>
            ))}
          </div>
          <div style={{
            marginTop: 14, fontSize: 12, color: '#8E8E93',
            padding: '0 4px', lineHeight: 1.5,
          }}>
            提示:也可以直接说「@Aria,…」或「@主持人,帮我问 Lex …」,系统会自动识别并路由。
          </div>
        </div>
      </div>
    </>
  );
}

// ─────────── 问主持人 sheet ───────────
const HOST_QUICK = [
  { kind: 'agenda', label: '本议程还剩多久?',           icon: 'clock' },
  { kind: 'agenda', label: '帮我延长当前议程 5 分钟',    icon: 'clock' },
  { kind: 'route',  label: '帮我转给法务专家 Lex',       icon: 'route' },
  { kind: 'route',  label: '帮我转给数据分析 Aria',      icon: 'route' },
  { kind: 'park',   label: '把刚才那段记入 parking lot', icon: 'compass' },
  { kind: 'note',   label: '把这一段标记为关键决策',     icon: 'note' },
];

function AskHostSheet({ open, onClose }) {
  const [text, setText] = useState('');
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{
        position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 80,
        animation: 'fadeIn 180ms ease',
      }} />
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        background: '#F2F2F7', borderTopLeftRadius: 14, borderTopRightRadius: 14,
        zIndex: 81, paddingBottom: 34,
        animation: 'slideUp 240ms cubic-bezier(.22,.61,.36,1)',
        maxHeight: '78%', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 6 }}>
          <div style={{ width: 36, height: 5, borderRadius: 3, background: '#D1D1D6' }} />
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px 8px',
        }}>
          <div style={{ width: 50 }} />
          <div style={{ fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <MRHostAvatar size={20} />
            问主持人 Mira
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#007AFF',
            fontSize: 16, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
          }}>完成</button>
        </div>

        <div style={{ padding: '0 16px', overflow: 'auto' }}>
          {/* host self-intro */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(255,179,64,0.10), rgba(255,159,10,0.14))',
            border: '0.5px solid rgba(255,159,10,0.30)',
            borderRadius: 12, padding: '10px 12px',
            fontSize: 13, lineHeight: 1.5, color: '#3C3C43',
          }}>
            告诉我要管议程、维持讨论焦点,还是把问题转给某位 AI 专家 — 我可以拆解后路由。
          </div>

          {/* quick chips */}
          <div style={{ marginTop: 14, fontSize: 11, fontWeight: 600, color: '#8E8E93', letterSpacing: 0.3 }}>
            常用请求
          </div>
          <div style={{
            marginTop: 8, display: 'grid',
            gridTemplateColumns: '1fr 1fr', gap: 8,
          }}>
            {HOST_QUICK.map((q, i) => (
              <button key={i} onClick={onClose} style={{
                background: '#fff', border: '0.5px solid rgba(60,60,67,0.12)',
                borderRadius: 10, padding: '10px 11px',
                display: 'flex', alignItems: 'flex-start', gap: 7,
                textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                color: '#1C1C1E', fontSize: 13, lineHeight: 1.35,
              }}>
                <MRIcon name={q.icon} size={14} color="#FF9F0A" />
                <span>{q.label}</span>
              </button>
            ))}
          </div>

          {/* free input */}
          <div style={{ marginTop: 16, fontSize: 11, fontWeight: 600, color: '#8E8E93', letterSpacing: 0.3 }}>
            或直接输入
          </div>
          <div style={{
            marginTop: 8, background: '#fff', borderRadius: 12,
            padding: 12,
            border: '0.5px solid rgba(60,60,67,0.12)',
          }}>
            <textarea
              value={text} onChange={e => setText(e.target.value)}
              placeholder="例如:帮我问 Aria,B 组延迟在弱网下表现如何?"
              style={{
                width: '100%', border: 'none', outline: 'none', resize: 'none',
                fontFamily: 'inherit', fontSize: 14, lineHeight: 1.45,
                color: '#1C1C1E', minHeight: 60, background: 'transparent',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
              <button style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                background: '#F2F2F7', border: 'none', borderRadius: 14,
                padding: '5px 10px', fontSize: 12, fontWeight: 500, color: '#1C1C1E',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <MRIcon name="mic-fill" size={13} color="#FF9F0A" />
                按住说话
              </button>
              <button onClick={onClose} style={{
                background: text ? '#FF9F0A' : '#E5E5EA',
                color: text ? '#fff' : '#8E8E93',
                border: 'none', borderRadius: 14, height: 30,
                padding: '0 14px', fontSize: 13, fontWeight: 600,
                cursor: text ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
              }}>发送</button>
            </div>
          </div>

          <div style={{ height: 16 }} />
        </div>
      </div>
    </>
  );
}

// ─────────── 更多 sheet ───────────
const MORE_ITEMS = [
  { icon: 'share',    label: '屏幕共享',    sub: '把当前屏幕分享给参会成员' },
  { icon: 'invite',   label: '邀请参会人',  sub: '微信好友 / 链接 / 二维码' },
  { icon: 'note',     label: '会议纪要',    sub: '查看自动生成的实时纪要',    badge: 'AI' },
  { icon: 'cc',       label: '字幕设置',    sub: '语言、字号、声纹标识' },
  { icon: 'wechat',   label: '转发到微信',  sub: '把当前片段发给同事',        primary: true },
  { icon: 'feedback', label: '问题反馈',    sub: '主持人或专家答错了?' },
  { icon: 'gear',     label: '设置',        sub: '通知、设备、隐私' },
];

function MoreSheet({ open, onClose }) {
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{
        position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 80,
        animation: 'fadeIn 180ms ease',
      }} />
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        background: '#F2F2F7', borderTopLeftRadius: 14, borderTopRightRadius: 14,
        zIndex: 81, paddingBottom: 34,
        animation: 'slideUp 240ms cubic-bezier(.22,.61,.36,1)',
        maxHeight: '74%', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 6 }}>
          <div style={{ width: 36, height: 5, borderRadius: 3, background: '#D1D1D6' }} />
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px 8px',
        }}>
          <div style={{ width: 50 }} />
          <div style={{ fontSize: 16, fontWeight: 600 }}>更多</div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#007AFF',
            fontSize: 16, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
          }}>完成</button>
        </div>
        <div style={{ padding: '4px 16px 0', overflow: 'auto' }}>
          <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden' }}>
            {MORE_ITEMS.map((m, i) => (
              <div key={i} onClick={onClose} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px',
                borderTop: i === 0 ? 'none' : '0.5px solid rgba(60,60,67,0.12)',
                cursor: 'pointer',
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: m.primary ? '#07C160' : '#F2F2F7',
                  color: m.primary ? '#fff' : '#1C1C1E',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <MRIcon name={m.icon} size={17} color={m.primary ? '#fff' : '#1C1C1E'} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {m.label}
                    {m.badge && <span style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: 0.4,
                      color: '#fff',
                      background: 'linear-gradient(135deg, #AF52DE, #5E5CE6)',
                      padding: '1px 5px', borderRadius: 4,
                    }}>{m.badge}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: '#8E8E93', marginTop: 1 }}>{m.sub}</div>
                </div>
                <MRIcon name="chev" size={16} color="#C7C7CC" />
              </div>
            ))}
          </div>
          <div style={{ height: 16 }} />
        </div>
      </div>
    </>
  );
}

// ─────────── Bottom action bar ───────────
function ActionBar({
  onSummon, onAskHost, onMore, onEnd,
  muted, setMuted, video, setVideo, hand, setHand, cc, setCC,
}) {
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0,
      paddingBottom: 26,
      background: 'linear-gradient(180deg, rgba(242,242,247,0) 0%, rgba(242,242,247,0.85) 22%, #F2F2F7 60%)',
      paddingTop: 18,
    }}>
      <div style={{
        margin: '0 12px',
        background: '#fff', borderRadius: 20,
        boxShadow: '0 6px 22px rgba(0,0,0,0.10), 0 0 0 0.5px rgba(60,60,67,0.12)',
        padding: '10px 10px 12px',
      }}>
        {/* Row 1 — AI engagement (the differentiator) */}
        <div style={{ display: 'flex', gap: 8 }}>
          <PrimaryBtn
            icon="sparkle"
            label="@ AI 专家"
            sub="唤醒领域专家答复"
            bg="linear-gradient(135deg, #AF52DE 0%, #5E5CE6 100%)"
            onClick={onSummon}
          />
          <PrimaryBtn
            icon="compass"
            label="问主持人"
            sub="拆解 · 路由 · 议程"
            bg="linear-gradient(135deg, #FFB340 0%, #FF9F0A 100%)"
            onClick={onAskHost}
            hostAvatar={true}
          />
        </div>

        {/* Row 2 — meeting controls */}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <CtrlBtn
            icon={muted ? 'mic-off' : 'mic'}
            label={muted ? '已静音' : '麦克风'}
            active={muted}
            activeBg="#FF3B30"
            onClick={() => setMuted(!muted)}
          />
          <CtrlBtn
            icon={video ? 'video' : 'video-off'}
            label={video ? '摄像头' : '已关闭'}
            active={!video}
            activeBg="#8E8E93"
            onClick={() => setVideo(!video)}
          />
          <CtrlBtn
            icon="hand"
            label={hand ? '举手中' : '举手'}
            active={hand}
            activeBg="#FF9F0A"
            onClick={() => setHand(!hand)}
          />
          <CtrlBtn
            icon="cc"
            label="字幕"
            active={cc}
            activeBg="#007AFF"
            onClick={() => setCC(!cc)}
          />
          <CtrlBtn
            icon="more"
            label="更多"
            active={false}
            onClick={onMore}
          />
          <CtrlBtn
            icon="end"
            label="结束"
            active={true}
            activeBg="#FF3B30"
            onClick={onEnd}
          />
        </div>
      </div>
    </div>
  );
}

function PrimaryBtn({ icon, label, sub, bg, onClick, hostAvatar }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, height: 52, borderRadius: 14,
      background: bg, border: 'none', color: '#fff',
      display: 'flex', alignItems: 'center', gap: 9,
      padding: '0 12px',
      fontFamily: 'inherit', cursor: 'pointer',
      textAlign: 'left',
      boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
    }}>
      <div style={{
        width: 30, height: 30, borderRadius: '50%',
        background: 'rgba(255,255,255,0.22)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        {hostAvatar
          ? <MRHostAvatar size={20} ring="rgba(255,255,255,0.4)" />
          : <MRIcon name={icon} size={17} color="#fff" />}
      </div>
      <div style={{ minWidth: 0, lineHeight: 1.15 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 10.5, opacity: 0.85, marginTop: 1 }}>{sub}</div>
      </div>
    </button>
  );
}

function CtrlBtn({ icon, label, active, activeBg = '#1C1C1E', onClick }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, height: 50, borderRadius: 12,
      background: active ? activeBg : '#F2F2F7',
      color: active ? '#fff' : '#1C1C1E',
      border: 'none',
      display: 'inline-flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 2,
      fontFamily: 'inherit', cursor: 'pointer',
      transition: 'background 120ms ease',
    }}>
      <MRIcon name={icon} size={18} color={active ? '#fff' : '#1C1C1E'} />
      <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.92 }}>{label}</span>
    </button>
  );
}

// ─────────── End-meeting confirm ───────────
function EndConfirm({ open, onCancel }) {
  if (!open) return null;
  return (
    <>
      <div style={{
        position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 90,
        animation: 'fadeIn 180ms ease',
      }} />
      <div style={{
        position: 'absolute', left: '50%', top: '50%',
        transform: 'translate(-50%, -50%)',
        width: 280, zIndex: 91,
        background: 'rgba(245,245,247,0.98)',
        borderRadius: 14, overflow: 'hidden',
        backdropFilter: 'blur(20px)',
        animation: 'popIn 200ms cubic-bezier(.22,.61,.36,1)',
      }}>
        <div style={{ padding: '20px 16px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>结束会议?</div>
          <div style={{ fontSize: 13, color: '#3C3C43', marginTop: 6, lineHeight: 1.4 }}>
            主持人 Mira 会自动整理 AI 摘要、决策项与行动项,完成后发到群里。
          </div>
        </div>
        <div style={{ display: 'flex', borderTop: '0.5px solid rgba(60,60,67,0.18)' }}>
          <button onClick={onCancel} style={{
            flex: 1, height: 44, background: 'none', border: 'none',
            color: '#007AFF', fontSize: 17, fontFamily: 'inherit', cursor: 'pointer',
            borderRight: '0.5px solid rgba(60,60,67,0.18)',
          }}>取消</button>
          <button onClick={onCancel} style={{
            flex: 1, height: 44, background: 'none', border: 'none',
            color: '#FF3B30', fontSize: 17, fontWeight: 600,
            fontFamily: 'inherit', cursor: 'pointer',
          }}>结束</button>
        </div>
      </div>
    </>
  );
}

// ─────────── App ───────────
function App() {
  const [timer, setTimer]     = useState('23:14');
  const [summon, setSummon]   = useState(false);
  const [askHost, setAskHost] = useState(false);
  const [more, setMore]       = useState(false);
  const [filter, setFilter]   = useState(false);
  const [chapters, setChapters] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [muted, setMuted]     = useState(false);
  const [video, setVideo]     = useState(false);
  const [hand, setHand]       = useState(false);
  const [cc, setCC]           = useState(true);
  const [ended, setEnded]     = useState(false);
  const [showJump, setShowJump] = useState(false);
  const scrollRef = useRef(null);

  // count speech per speaker (for filter sheet) — round contributes to host + each expert
  const counts = useMemo(() => {
    const c = {};
    MR_MESSAGES.forEach(m => {
      if (m.kind === 'round') {
        c['host'] = (c['host'] || 0) + 1;
        m.experts.forEach(e => { c[e.who] = (c[e.who] || 0) + 1; });
      } else {
        const k = speakerKeyOf(m);
        c[k] = (c[k] || 0) + 1;
      }
    });
    return c;
  }, []);

  // apply filter
  const visibleMessages = useMemo(() => {
    if (selected.size === 0) return MR_MESSAGES;
    return MR_MESSAGES.filter(m => roundMatchesFilter(m, selected));
  }, [selected]);
  const matched = visibleMessages.length;

  // tick timer
  useEffect(() => {
    const start = Date.now();
    const baseMin = 23, baseSec = 14;
    const id = setInterval(() => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      const total = baseMin * 60 + baseSec + elapsed;
      const mm = String(Math.floor(total / 60)).padStart(2, '0');
      const ss = String(total % 60).padStart(2, '0');
      setTimer(`${mm}:${ss}`);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // auto-scroll to bottom on mount
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  // scroll to a specific message (without scrollIntoView)
  const jumpTo = (idx) => {
    const target = document.getElementById(`msg-${idx}`);
    const scroller = scrollRef.current;
    if (!target || !scroller) return;
    const top = target.offsetTop - scroller.offsetTop - 16;
    scroller.scrollTo({ top, behavior: 'smooth' });
    // briefly highlight
    target.style.transition = 'background 200ms ease';
    target.style.background = 'rgba(0,122,255,0.10)';
    setTimeout(() => { target.style.background = 'transparent'; }, 1100);
  };

  const jumpToLatest = () => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
  };

  // Track scroll position for FAB
  const handleScroll = (e) => {
    const el = e.target;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setShowJump(!atBottom);
  };

  return (
    <IOSDevice width={402} height={874}>
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        position: 'relative', overflow: 'hidden', background: '#F2F2F7',
      }}>
        <MRHeader
          timer={timer}
          onFilter={() => setFilter(true)}
          filterActive={selected.size > 0}
          onChapters={() => setChapters(true)}
        />
        <AgendaStrip />
        <ParticipantsStrip />

        {/* transcript feed */}
        <div ref={scrollRef} onScroll={handleScroll} style={{
          flex: 1, overflow: 'auto',
          background: '#F2F2F7',
          paddingTop: 0, paddingBottom: 200,
        }}>
          <FilterBanner
            selected={selected}
            matched={matched}
            total={MR_MESSAGES.length}
            onChange={setSelected}
            onOpen={() => setFilter(true)}
          />
          <div style={{ height: 4 }} />
          {visibleMessages.length === 0 ? (
            <div style={{
              padding: '60px 32px', textAlign: 'center',
              color: '#8E8E93', fontSize: 14, lineHeight: 1.5,
            }}>
              筛选后无发言<br/>
              <span style={{ fontSize: 12, color: '#C7C7CC' }}>试试再勾选一些人</span>
            </div>
          ) : MR_MESSAGES.map((m, i) => {
            if (!roundMatchesFilter(m, selected)) return null;
            const isChapter = m.kind === 'host' && m.tone === 'agenda';
            return (
              <div key={i} id={`msg-${i}`}>
                {m.kind === 'human' && <HumanMessage m={m} />}
                {m.kind === 'ai'    && <AIMessage    m={m} />}
                {m.kind === 'host'  && (isChapter ? <ChapterDivider m={m} /> : <HostMessage m={m} />)}
                {m.kind === 'round' && <RoundMessage m={m} initialOpen={roundInitialOpen(m, selected)} />}
              </div>
            );
          })}
          {/* live typing indicator — hidden when filter excludes current speaker */}
          {(selected.size === 0 || selected.has('WJ')) && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 16px 16px',
              fontSize: 12, color: '#8E8E93',
            }}>
              <MRHumanAvatar id="WJ" size={18} />
              <span>王俊 正在说话</span>
              <Waveform active={true} />
            </div>
          )}
        </div>

        {showJump && (
          <button onClick={jumpToLatest} style={{
            position: 'absolute', right: 14, bottom: 178,
            width: 40, height: 40, borderRadius: '50%',
            background: '#fff', border: 'none',
            boxShadow: '0 4px 14px rgba(0,0,0,0.15), 0 0 0 0.5px rgba(60,60,67,0.12)',
            cursor: 'pointer', zIndex: 10,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            animation: 'fadeIn 200ms ease',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path d="M12 5v14M6 13l6 6 6-6" stroke="#007AFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
          </button>
        )}

        <ActionBar
          onSummon={() => setSummon(true)}
          onAskHost={() => setAskHost(true)}
          onMore={() => setMore(true)}
          onEnd={() => setEnded(true)}
          muted={muted} setMuted={setMuted}
          video={video} setVideo={setVideo}
          hand={hand} setHand={setHand}
          cc={cc} setCC={setCC}
        />

        <SummonSheet open={summon} onClose={() => setSummon(false)} />
        <AskHostSheet open={askHost} onClose={() => setAskHost(false)} />
        <MoreSheet open={more} onClose={() => setMore(false)} />
        <FilterSheet
          open={filter}
          selected={selected}
          onChange={setSelected}
          onClose={() => setFilter(false)}
          counts={counts}
        />
        <HighlightsSheet
          open={chapters}
          onClose={() => setChapters(false)}
          onJump={jumpTo}
        />
        <EndConfirm open={ended} onCancel={() => setEnded(false)} />
      </div>
    </IOSDevice>
  );
}

const style = document.createElement('style');
style.textContent = `
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
  @keyframes wfBar {
    0%   { transform: scaleY(0.3); }
    100% { transform: scaleY(1); }
  }
  @keyframes dotBounce {
    0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
    40%           { transform: translateY(-3px); opacity: 1; }
  }
  @keyframes livePulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%      { opacity: 0.5; transform: scale(1.15); }
  }
  @keyframes speakingPulse {
    0%, 100% { box-shadow: 0 0 0 2px #34C759, 0 0 0 4px rgba(52,199,89,0.30); }
    50%      { box-shadow: 0 0 0 2px #34C759, 0 0 0 8px rgba(52,199,89,0); }
  }
  @keyframes urgentPulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(255,59,48,0.20); }
    50%      { box-shadow: 0 0 0 4px rgba(255,59,48,0.10); }
  }
  @keyframes popIn {
    from { opacity: 0; transform: translate(-50%, -50%) scale(0.85); }
    to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  }
  div::-webkit-scrollbar { display: none; }
`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
