// Meeting Room — Web (desktop) version
// 3-column layout: Agenda+People (left) · Transcript (center) · AI Experts (right)

const { useState, useMemo, useRef, useEffect } = React;

// ─────────── Top bar (2 rows: chrome + AI expert dock) ───────────
function TopBar({ timer, onFilter, filterActive, filterCount, onEnd, selected, onToggleSpeaker }) {
  return (
    <div style={{ background: '#fff', borderBottom: '0.5px solid #E5E5EA', flexShrink: 0 }}>
      {/* Row 1 — chrome */}
      <div style={{
        height: 48, display: 'flex', alignItems: 'center',
        padding: '0 20px', gap: 14,
      }}>
        <a href="index.html" style={{
          color: '#1C1C1E', textDecoration: 'none',
          display: 'inline-flex', alignItems: 'center', gap: 4,
          height: 32, padding: '0 10px', borderRadius: 8,
          fontSize: 13, fontWeight: 500, background: '#F2F2F7',
        }}>
          <MRIcon name="back" size={16} color="#1C1C1E" />
          会议历史
        </a>
        <div style={{ width: 1, height: 22, background: '#E5E5EA' }} />
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1C1C1E', whiteSpace: 'nowrap' }}>
          Q3 路线图对齐
        </div>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 26, padding: '0 10px', borderRadius: 13,
          background: 'rgba(255,59,48,0.10)',
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%', background: '#FF3B30',
            animation: 'livePulse 1.4s ease-in-out infinite',
          }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#FF3B30', letterSpacing: 0.4 }}>实时</span>
          <span style={{ fontSize: 12, color: '#FF3B30', opacity: 0.8, fontVariantNumeric: 'tabular-nums' }}>{timer}</span>
        </div>

        <div style={{ flex: 1 }} />

        {/* People compact strip — click avatar to filter by that person */}
        <PeopleMicroStrip selected={selected} onToggleSpeaker={onToggleSpeaker} />

        <div style={{ width: 1, height: 22, background: '#E5E5EA' }} />

        <TopBarBtn icon="filter" label={filterActive ? `已筛选 ${filterCount}` : '筛选'} onClick={onFilter} active={filterActive} />
        <TopBarBtn icon="invite" label="邀请" />
        <TopBarBtn icon="gear"   label="设置" />

        <button onClick={onEnd} style={{
          height: 34, padding: '0 16px', borderRadius: 8,
          background: '#FF3B30', color: '#fff',
          border: 'none', fontSize: 13, fontWeight: 600,
          fontFamily: 'inherit', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 6,
          boxShadow: '0 1px 2px rgba(255,59,48,0.30)',
        }}>
          <MRIcon name="end" size={14} color="#fff" />
          结束会议
        </button>
      </div>

      {/* Row 2 — Agenda timeline (quantified, click to jump) */}
      <AgendaTimeline />
    </div>
  );
}

function AgendaTimeline() {
  // Map agenda → first message index in that agenda's discussion
  // (current data only has messages for agenda 2; agenda 1 jumps to the agenda-switch marker)
  const agendaMsgIdx = (id) => {
    if (id === 2) return MR_MESSAGES.findIndex(m => m.kind === 'host' && m.tone === 'agenda');
    return -1;
  };
  return (
    <div style={{
      borderTop: '0.5px solid #E5E5EA',
      background: '#FAFAFA',
      padding: '8px 20px 10px',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        marginBottom: 6,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#8E8E93', letterSpacing: 0.4 }}>议程时间线</span>
        <span style={{ fontSize: 11, color: '#C7C7CC' }}>总 {MR_AGENDA.reduce((s, a) => s + a.minutes, 0)} 分钟 · 点击段落跳转</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: '#8E8E93' }}>
          已用 23 分钟 · 剩 13 分钟
        </span>
      </div>
      <div style={{ display: 'flex', gap: 4, height: 44 }}>
        {MR_AGENDA.map(a => {
          const jumpIdx = agendaMsgIdx(a.id);
          const canJump = jumpIdx >= 0;
          return (
            <AgendaSegment key={a.id} a={a} canJump={canJump}
              onJump={() => canJump && window.__mr_jump_to__ && window.__mr_jump_to__(jumpIdx)} />
          );
        })}
      </div>
    </div>
  );
}

function AgendaSegment({ a, canJump, onJump }) {
  const isActive = a.state === 'active';
  const isDone   = a.state === 'done';
  const fillPct  = isActive ? ((a.minutes - a.remaining) / a.minutes) * 100 : 0;

  const bg = isDone   ? 'linear-gradient(135deg, rgba(52,199,89,0.10), rgba(52,199,89,0.18))'
           : isActive ? '#fff'
           : '#fff';
  const border = isDone   ? '0.5px solid rgba(52,199,89,0.45)'
              : isActive ? '1px solid #007AFF'
              : '0.5px solid #E5E5EA';
  const shadow = isActive ? '0 2px 6px rgba(0,122,255,0.18)' : 'none';

  return (
    <div onClick={onJump} title={canJump ? '跳转到该议程' : '尚无 transcript 内容'}
      style={{
        flex: a.minutes,
        background: bg, border, borderRadius: 8,
        boxShadow: shadow,
        padding: '6px 10px',
        cursor: canJump ? 'pointer' : 'default',
        position: 'relative', overflow: 'hidden',
        opacity: !isDone && !isActive ? 0.65 : 1,
      }}>
      {/* progress fill (active only) */}
      {isActive && (
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: `${fillPct}%`,
          background: 'linear-gradient(90deg, rgba(0,122,255,0.10), rgba(94,92,230,0.06))',
          pointerEvents: 'none',
        }} />
      )}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, lineHeight: 1.15 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
          color: isDone ? '#34C759' : isActive ? '#007AFF' : '#8E8E93',
        }}>议程 {a.id}</span>
        {isDone && <MRIcon name="check" size={12} color="#34C759" />}
        {isActive && (
          <span style={{
            width: 6, height: 6, borderRadius: '50%', background: '#007AFF',
            animation: 'livePulse 1.4s ease-in-out infinite',
          }} />
        )}
        <span style={{
          fontSize: 12.5, fontWeight: 600, color: '#1C1C1E',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
          flex: 1,
        }}>{a.title}</span>
      </div>
      <div style={{
        position: 'relative', marginTop: 4,
        fontSize: 11, color: '#8E8E93',
        display: 'flex', alignItems: 'center', gap: 5,
        overflow: 'hidden', whiteSpace: 'nowrap',
      }}>
        {isActive ? (<>
          <span style={{ color: '#FF9F0A', fontWeight: 600 }}>剩 {a.remaining} 分</span>
          <span>·</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{a.minutes - a.remaining}/{a.minutes} min</span>
        </>) : isDone ? (<>
          <span style={{ color: '#34C759', fontWeight: 600 }}>完成</span>
          <span>·</span>
          <span>{a.minutes} min</span>
        </>) : (<>
          <span>{a.minutes} min</span>
          <span>·</span>
          <span>待开始</span>
        </>)}
      </div>
    </div>
  );
}

function PeopleMicroStrip({ selected, onToggleSpeaker }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#8E8E93', letterSpacing: 0.4 }}>在场</span>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {Object.keys(MR_HUMANS).map(k => {
          const p = MR_HUMANS[k];
          const active = selected.has(k);
          return (
            <button key={k} onClick={() => onToggleSpeaker(k)}
              title={`${p.name} · ${p.role}${p.speaking ? ' · 正在说话' : ''}`}
              style={{
                width: 30, height: 30, padding: 0,
                background: 'none', border: active ? '2px solid #007AFF' : '2px solid transparent',
                borderRadius: '50%', cursor: 'pointer', position: 'relative',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>
              <MRHumanAvatar id={k} size={26} showStatus />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ExpertDock() {
  // Show AIs that are actively part of this meeting + Mira (host)
  const activeAIs = ['ARIA', 'STRATOS', 'LEX', 'SAGE'];
  return (
    <div style={{
      height: 68,
      borderTop: '0.5px solid #E5E5EA',
      background: 'linear-gradient(180deg, #FBFBFC 0%, #fff 100%)',
      display: 'flex', alignItems: 'center', padding: '0 20px', gap: 10,
    }}>
      <span style={{
        fontSize: 11, fontWeight: 700, color: '#8E8E93',
        letterSpacing: 0.4, flexShrink: 0,
      }}>AI 阵容</span>

      <HostPill />
      <div style={{ width: 1, height: 38, background: '#E5E5EA', margin: '0 2px' }} />
      {activeAIs.map(k => <ExpertPill key={k} id={k} />)}

      <button style={{
        height: 50, padding: '0 12px', borderRadius: 10,
        background: '#F2F2F7', border: '0.5px dashed #C7C7CC',
        color: '#1C1C1E',
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 12, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer',
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="#1C1C1E" strokeWidth="2" strokeLinecap="round"/></svg>
        添加专家
      </button>

      <div style={{ flex: 1 }} />

      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 11, color: '#8E8E93',
      }}>
        <MRIcon name="sparkle" size={11} color="#5E5CE6" />
        在 transcript 里 <span style={{ color: '#5E5CE6', fontWeight: 700 }}>@专家名</span> 唤醒,或点击下方按钮
      </div>
    </div>
  );
}

const AI_USAGE_DOCK = (() => {
  const u = {};
  Object.keys(MR_AIS).forEach(k => u[k] = { count: 0, last: null });
  MR_MESSAGES.forEach(m => {
    if (m.kind === 'ai' && u[m.who]) {
      u[m.who].count += 1; u[m.who].last = m.body;
    }
    if (m.kind === 'round') {
      m.experts.forEach(e => { if (u[e.who]) { u[e.who].count += 1; u[e.who].last = e.headline; } });
    }
  });
  return u;
})();

function HostPill() {
  return (
    <div style={{
      height: 50, padding: '0 12px', borderRadius: 10,
      background: 'linear-gradient(135deg, rgba(255,179,64,0.10), rgba(255,159,10,0.16))',
      border: '0.5px solid rgba(255,159,10,0.35)',
      display: 'inline-flex', alignItems: 'center', gap: 9, cursor: 'pointer',
      flexShrink: 0,
    }}>
      <MRHostAvatar size={30} />
      <div style={{ lineHeight: 1.15 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
          {MR_HOST.name}
          <span style={{
            fontSize: 9, fontWeight: 700, color: '#fff',
            background: '#FF9F0A', padding: '1px 4px', borderRadius: 3,
            letterSpacing: 0.3,
          }}>主持</span>
        </div>
        <div style={{ fontSize: 11, color: '#8B6914', marginTop: 1 }}>
          监测中 · 已干预 3 次
        </div>
      </div>
    </div>
  );
}

function ExpertPill({ id }) {
  const a = MR_AIS[id];
  const u = AI_USAGE_DOCK[id];
  const active = u.count > 0;
  return (
    <div style={{
      height: 50, padding: '0 12px 0 10px', borderRadius: 10,
      background: '#fff', border: '0.5px solid #E5E5EA',
      display: 'inline-flex', alignItems: 'center', gap: 9, cursor: 'pointer',
      flexShrink: 0, minWidth: 0, maxWidth: 220, position: 'relative',
      overflow: 'hidden',
    }}>
      <MRAIAvatar id={id} size={30} />
      <div style={{ lineHeight: 1.15, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>{a.name}</span>
          {active && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 2,
              fontSize: 9, fontWeight: 700, color: '#34C759',
              background: 'rgba(52,199,89,0.12)',
              padding: '1px 4px', borderRadius: 3,
            }}>
              <span style={{
                width: 4, height: 4, borderRadius: '50%', background: '#34C759',
                animation: 'livePulse 1.4s ease-in-out infinite',
              }} />
              ×{u.count}
            </span>
          )}
        </div>
        <div style={{
          fontSize: 11, color: '#8E8E93', marginTop: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          maxWidth: 130,
        }}>
          {active ? '已发言' : a.role}
        </div>
      </div>
      <button style={{
        marginLeft: 4, width: 28, height: 28, borderRadius: 7,
        background: `linear-gradient(135deg, ${a.grad[0]}, ${a.grad[1]})`,
        border: 'none', color: '#fff', cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <MRIcon name="sparkle" size={13} color="#fff" />
      </button>
    </div>
  );
}

function TopBarBtn({ icon, label, onClick, active }) {
  return (
    <button onClick={onClick} style={{
      height: 32, padding: '0 12px', borderRadius: 8,
      background: active ? 'rgba(0,122,255,0.12)' : 'transparent',
      color: active ? '#007AFF' : '#1C1C1E',
      border: active ? 'none' : '0.5px solid #E5E5EA',
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: 13, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer',
      whiteSpace: 'nowrap',
    }}>
      <MRIcon name={icon} size={14} color={active ? '#007AFF' : '#1C1C1E'} />
      {label}
    </button>
  );
}

// ─────────── Left panel — AI experts (primary interaction) + timeline highlights ───────────
function LeftPanel({ onJumpTo, selected, onToggleSpeaker }) {
  return (
    <div style={{
      width: 280, background: '#FAFAFA',
      borderRight: '0.5px solid #E5E5EA',
      display: 'flex', flexDirection: 'column',
      flexShrink: 0, overflow: 'hidden',
    }}>
      <div style={{ flex: 1, overflow: 'auto', padding: '18px 14px 16px' }}>
        <ExpertsPanel selected={selected} onToggle={onToggleSpeaker} />
        <div style={{ height: 22 }} />
        <TimelineHighlights onJumpTo={onJumpTo} />
      </div>
    </div>
  );
}

function ExpertsPanel({ selected, onToggle }) {
  const keys = ['ARIA', 'STRATOS', 'LEX', 'SAGE'];
  const selectedCount = keys.filter(k => selected.has(k)).length;
  return (
    <div>
      <SectionLabel right={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {selectedCount > 0 && (
            <span style={{ color: '#007AFF', fontWeight: 600 }}>已选 {selectedCount}</span>
          )}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
            <svg width="10" height="10" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="#007AFF" strokeWidth="2" strokeLinecap="round"/></svg>
            添加
          </span>
        </span>
      }>AI 专家 · {keys.length}</SectionLabel>
      <div style={{
        fontSize: 11, color: '#8E8E93', padding: '0 2px 8px', lineHeight: 1.5,
      }}>点击卡片选中专家 · 选中后 timeline 仅显示其发言</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {keys.map(k => (
          <ExpertCard key={k} id={k}
            selected={selected.has(k)}
            onClick={() => onToggle(k)} />
        ))}
      </div>
    </div>
  );
}

function ExpertCard({ id, selected, onClick }) {
  const a = MR_AIS[id];
  const u = AI_USAGE_DOCK[id];
  const active = u.count > 0;
  return (
    <div onClick={onClick} style={{
      background: selected ? 'rgba(0,122,255,0.06)' : '#fff',
      borderRadius: 11,
      border: selected ? '1.5px solid #007AFF' : '0.5px solid #E5E5EA',
      padding: selected ? '8.5px 10.5px' : '9.5px 11.5px',
      position: 'relative', overflow: 'hidden',
      cursor: 'pointer',
      transition: 'background 140ms ease',
      boxShadow: selected ? '0 1px 6px rgba(0,122,255,0.10)' : 'none',
    }}>
      {/* gradient halo (only when not selected to avoid visual conflict) */}
      {!selected && (
        <div style={{
          position: 'absolute', top: -16, right: -16, width: 52, height: 52,
          borderRadius: '50%', opacity: 0.10,
          background: `linear-gradient(135deg, ${a.grad[0]}, ${a.grad[1]})`,
          pointerEvents: 'none',
        }} />
      )}
      {/* selected check badge */}
      {selected && (
        <div style={{
          position: 'absolute', top: 6, right: 6,
          width: 16, height: 16, borderRadius: 4, background: '#007AFF',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <MRIcon name="check" size={11} color="#fff" />
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
        <MRAIAvatar id={id} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#1C1C1E' }}>{a.name}</span>
            {active && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                fontSize: 9.5, fontWeight: 700, color: '#34C759',
                background: 'rgba(52,199,89,0.12)',
                padding: '1.5px 5px', borderRadius: 3,
              }}>
                <span style={{
                  width: 4, height: 4, borderRadius: '50%', background: '#34C759',
                  animation: 'livePulse 1.4s ease-in-out infinite',
                }} />
                已答 {u.count}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: '#8E8E93', marginTop: 1 }}>{a.role}</div>
        </div>
      </div>
      {u.last && (
        <div style={{
          marginTop: 7, fontSize: 11, color: '#8E8E93',
          lineHeight: 1.4, paddingLeft: 8,
          borderLeft: `2px solid ${selected ? '#007AFF55' : a.grad[0] + '55'}`,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>"{u.last}"</div>
      )}
    </div>
  );
}

function TimelineHighlights({ onJumpTo }) {
  const hl = webGetHighlights();
  return (
    <div>
      <SectionLabel right={`${hl.length} 个`}>时间线高光</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {hl.map((h, i) => (
          <div key={i} onClick={() => onJumpTo(h.idx)} style={{
            display: 'flex', alignItems: 'flex-start', gap: 9,
            padding: '8px 10px', borderRadius: 8,
            background: '#fff', border: '0.5px solid #E5E5EA',
            cursor: 'pointer',
          }}>
            <div style={{
              width: 22, height: 22, borderRadius: 5,
              background: h.color, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginTop: 1,
            }}>
              <MRIcon name={h.icon} size={11} color="#fff" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 10.5, fontWeight: 700, color: h.color,
                letterSpacing: 0.3,
              }}>
                {h.label} <span style={{ color: '#C7C7CC', fontWeight: 400 }}>· {h.t}</span>
              </div>
              <div style={{
                fontSize: 12, color: '#1C1C1E', marginTop: 1, lineHeight: 1.35,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{h.title}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionLabel({ children, right }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 2px 10px',
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: '#8E8E93',
        letterSpacing: 0.5, textTransform: 'uppercase',
      }}>{children}</div>
      {right && <div style={{ fontSize: 11, color: '#007AFF' }}>{right}</div>}
    </div>
  );
}

function AgendaList({ onJumpTo }) {
  // map agenda → first message index in that agenda (placeholder: jump to agenda message)
  const agendaJumps = { 2: MR_MESSAGES.findIndex(m => m.kind === 'host' && m.tone === 'agenda') };
  return (
    <div>
      <SectionLabel>议程 · 4</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {MR_AGENDA.map((a) => {
          const isActive = a.state === 'active';
          const isDone   = a.state === 'done';
          const jumpIdx  = agendaJumps[a.id];
          return (
            <div key={a.id}
                 onClick={() => jumpIdx != null && jumpIdx >= 0 && onJumpTo && onJumpTo(jumpIdx)}
                 style={{
              background: isActive ? '#fff' : 'transparent',
              border: isActive ? '0.5px solid #E5E5EA' : '0.5px solid transparent',
              borderRadius: 10, padding: '10px 12px',
              boxShadow: isActive ? '0 1px 2px rgba(0,0,0,0.04)' : 'none',
              cursor: jumpIdx != null && jumpIdx >= 0 ? 'pointer' : 'default',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <div style={{
                  width: 18, height: 18, borderRadius: '50%',
                  background: isDone ? '#34C759' : isActive ? '#fff' : '#fff',
                  border: isDone ? 'none' : isActive ? '2px solid #007AFF' : '1px solid #C7C7CC',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {isDone && <MRIcon name="check" size={11} color="#fff" />}
                  {isActive && <span style={{
                    width: 6, height: 6, borderRadius: '50%', background: '#007AFF',
                    animation: 'livePulse 1.4s ease-in-out infinite',
                  }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: isActive ? 600 : 500,
                    color: isDone ? '#8E8E93' : '#1C1C1E',
                    textDecoration: isDone ? 'line-through' : 'none',
                  }}>{a.id}. {a.title}</div>
                  <div style={{ fontSize: 11, color: '#8E8E93', marginTop: 2,
                    display: 'flex', alignItems: 'center', gap: 5 }}>
                    {isActive ? (<>
                      <MRIcon name="clock" size={11} color="#FF9F0A" />
                      <span style={{ color: '#FF9F0A', fontWeight: 600 }}>剩 {a.remaining} 分钟</span>
                      <span style={{ color: '#C7C7CC' }}>/ {a.minutes}</span>
                    </>) : (
                      <span>{a.minutes} 分钟</span>
                    )}
                  </div>
                </div>
              </div>
              {isActive && (
                <div style={{
                  marginTop: 8, height: 4, borderRadius: 2,
                  background: '#E5E5EA', overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${((a.minutes - a.remaining) / a.minutes) * 100}%`,
                    background: 'linear-gradient(90deg, #007AFF, #5E5CE6)',
                  }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PeopleList({ filterSelected, onToggleSpeaker }) {
  const total = Object.keys(MR_HUMANS).length + Object.keys(MR_AIS).length + 1;
  return (
    <div>
      <SectionLabel right={`${total} 位`}>参会</SectionLabel>
      <PersonRow k="host" filterSelected={filterSelected} onToggle={onToggleSpeaker} />
      <div style={{ height: 8 }} />
      {/* humans */}
      <div style={{ fontSize: 10, fontWeight: 700, color: '#8E8E93', padding: '4px 4px 6px', letterSpacing: 0.4 }}>团队成员</div>
      {Object.keys(MR_HUMANS).map(k => (
        <PersonRow key={k} k={k} filterSelected={filterSelected} onToggle={onToggleSpeaker} />
      ))}
      <div style={{ height: 8 }} />
      <div style={{ fontSize: 10, fontWeight: 700, color: '#8E8E93', padding: '4px 4px 6px', letterSpacing: 0.4 }}>AI 专家</div>
      {Object.keys(MR_AIS).map(k => (
        <PersonRow key={k} k={k} filterSelected={filterSelected} onToggle={onToggleSpeaker} />
      ))}
    </div>
  );
}

function PersonRow({ k, filterSelected, onToggle }) {
  const isHost  = k === 'host';
  const human   = MR_HUMANS[k];
  const ai      = MR_AIS[k];
  const name    = isHost ? MR_HOST.name : human ? human.name : ai.name;
  const role    = isHost ? '主持人' : human ? human.role : ai.role;
  const status  = human?.speaking ? '正在说话' : human?.muted ? '已静音' : null;
  const filtered = filterSelected.has(k);

  return (
    <div onClick={() => onToggle(k)} style={{
      display: 'flex', alignItems: 'center', gap: 9,
      padding: '6px 6px', borderRadius: 8,
      background: filtered ? 'rgba(0,122,255,0.08)' : 'transparent',
      cursor: 'pointer',
    }}>
      {isHost && <MRHostAvatar size={26} />}
      {human && <MRHumanAvatar id={k} size={26} showStatus />}
      {ai && <MRAIAvatar id={k} size={26} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#1C1C1E' }}>{name}</span>
          {human?.speaking && <WebWaveform active />}
        </div>
        <div style={{
          fontSize: 11, color: status === '正在说话' ? '#34C759' : '#8E8E93',
          fontWeight: status === '正在说话' ? 600 : 400,
        }}>{status || role}</div>
      </div>
      {filtered && (
        <div style={{
          width: 16, height: 16, borderRadius: 4, background: '#007AFF',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><MRIcon name="check" size={11} color="#fff" /></div>
      )}
    </div>
  );
}

function HostStatsCard() {
  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(255,179,64,0.10), rgba(255,159,10,0.16))',
      border: '0.5px solid rgba(255,159,10,0.30)',
      borderRadius: 12, padding: '12px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <MRHostAvatar size={28} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{MR_HOST.name}</div>
          <div style={{ fontSize: 11, color: '#8E8E93' }}>本次干预统计</div>
        </div>
      </div>
      <div style={{
        marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6,
      }}>
        <Stat n="1" l="议程切换" />
        <Stat n="3" l="偏离提醒" />
        <Stat n="1" l="问题路由" />
      </div>
    </div>
  );
}

function Stat({ n, l }) {
  return (
    <div style={{
      background: '#fff', border: '0.5px solid rgba(60,60,67,0.10)',
      borderRadius: 8, padding: '6px 4px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#FF9F0A', lineHeight: 1.1 }}>{n}</div>
      <div style={{ fontSize: 10, color: '#8E8E93', marginTop: 2 }}>{l}</div>
    </div>
  );
}

// ─────────── Right panel — dynamic state: Mira live · decisions · actions · parking · refs ───────────
const DECISIONS = [
  { id: 'd1', title: 'Q3 协作功能延后到 Q4', source: 'Stratos 建议', t: '23:01',
    status: 'confirmed', tag: '路线图' },
  { id: 'd2', title: '议程 2 顺延 10 分钟,议程 4 同步顺延', source: '周凯 + Mira', t: '23:12',
    status: 'confirmed', tag: '议程' },
  { id: 'd3', title: 'B 组灰度到 20%(本周内启动)', source: 'AI 圆桌 + Mira 综合', t: '23:14',
    status: 'pending', tag: '产品' },
];

const ACTIONS = [
  { id: 'a1', title: '起草隐私政策 4.2 条更新', owner: 'LEX',  due: '6/3',  source: 'Lex 答复' },
  { id: 'a2', title: '监控 B 组降级开关',       owner: 'ARIA', due: '实时', source: 'AI 圆桌' },
  { id: 'a3', title: '复核同意书 v1',           owner: 'HR',   due: '本周', source: 'Lex 提请' },
  { id: 'a4', title: '跟进 Hummingbird 反馈',   owner: 'YQ',   due: '下周', source: '跑题转待办' },
];

const PARKING = [
  { id: 'p1', title: 'Hummingbird 延迟感受 / 客户访谈复盘', from: '苏蕾', at: '23:09 偏离时记入' },
  { id: 'p2', title: 'Otter 摘要长度反馈与对标',           from: '陈宇', at: '23:10 偏离时记入' },
];

const REFS = [
  { kind: 'doc',  title: 'PRD: 搜索体验 v3',       sub: 'Linear · 王俊 维护' },
  { kind: 'data', title: '模型 A/B 实时看板',       sub: 'Datadog · live' },
  { kind: 'mtg',  title: '上次会议:Q2 产品复盘',    sub: '5/10 · 1h 22m' },
];

function RightPanel() {
  return (
    <div style={{
      width: 340, background: '#FAFAFA',
      borderLeft: '0.5px solid #E5E5EA',
      display: 'flex', flexDirection: 'column',
      flexShrink: 0, overflow: 'hidden',
    }}>
      <div style={{ flex: 1, overflow: 'auto', padding: '18px 16px' }}>
        <MiraLive />
        <div style={{ height: 18 }} />
        <DecisionPool />
        <div style={{ height: 18 }} />
        <ActionList />
        <div style={{ height: 18 }} />
        <ParkingLotPanel />
        <div style={{ height: 18 }} />
        <ReferencesPanel />
      </div>
    </div>
  );
}

function MiraLive() {
  return (
    <div>
      <SectionLabel>Mira 当下</SectionLabel>
      <div style={{
        background: 'linear-gradient(135deg, rgba(255,179,64,0.08), rgba(255,159,10,0.13))',
        border: '0.5px solid rgba(255,159,10,0.30)',
        borderRadius: 12, padding: '12px 14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9 }}>
          <MRHostAvatar size={28} />
          <div style={{ flex: 1, lineHeight: 1.15 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{MR_HOST.name}</div>
            <div style={{ fontSize: 11, color: '#34C759', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', background: '#34C759',
                animation: 'livePulse 1.4s ease-in-out infinite',
              }} />
              监测中
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <LiveRow label="当前焦点" value="议程 2 · 搜索 A/B" />
          <LiveRow label="议程剩余" value="4 分 30 秒" valueColor="#FF9F0A" />
          <LiveRow label="偏离风险" value="低 ✓" valueColor="#34C759" />
          <LiveRow label="正在说"   value="王俊 · 1:24" />
        </div>
        <button style={{
          marginTop: 10, width: '100%', height: 32, borderRadius: 8,
          background: 'linear-gradient(135deg, #FFB340, #FF9F0A)',
          border: 'none', color: '#fff', fontSize: 12.5, fontWeight: 600,
          fontFamily: 'inherit', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        }}>
          <MRIcon name="compass" size={13} color="#fff" /> 问主持人
        </button>
      </div>
    </div>
  );
}

function LiveRow({ label, value, valueColor = '#1C1C1E' }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontSize: 12, padding: '3px 0',
    }}>
      <span style={{ color: '#8E8E93' }}>{label}</span>
      <span style={{ color: valueColor, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function DecisionPool() {
  return (
    <div>
      <SectionLabel right={`${DECISIONS.length} 条`}>决策池</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {DECISIONS.map(d => (
          <div key={d.id} style={{
            background: '#fff', borderRadius: 10,
            border: '0.5px solid #E5E5EA',
            padding: '10px 11px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{
                fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3,
                color: d.status === 'confirmed' ? '#34C759' : '#FF9F0A',
                background: d.status === 'confirmed' ? 'rgba(52,199,89,0.12)' : 'rgba(255,159,10,0.12)',
                padding: '2px 6px', borderRadius: 3,
              }}>
                {d.status === 'confirmed' ? '已确认' : '待确认'}
              </span>
              <span style={{
                fontSize: 9.5, fontWeight: 600, color: '#5E5CE6',
                background: 'rgba(94,92,230,0.10)',
                padding: '2px 6px', borderRadius: 3,
              }}>{d.tag}</span>
              <span style={{ marginLeft: 'auto', fontSize: 10.5, color: '#C7C7CC' }}>{d.t}</span>
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: '#1C1C1E', lineHeight: 1.4 }}>
              {d.title}
            </div>
            <div style={{ fontSize: 11, color: '#8E8E93', marginTop: 3 }}>来源: {d.source}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionList() {
  return (
    <div>
      <SectionLabel right={`${ACTIONS.length} 项`}>行动项</SectionLabel>
      <div style={{ background: '#fff', borderRadius: 10, border: '0.5px solid #E5E5EA', overflow: 'hidden' }}>
        {ACTIONS.map((a, i) => {
          const isAI = !!MR_AIS[a.owner];
          const isHuman = !!MR_HUMANS[a.owner];
          return (
            <div key={a.id} style={{
              display: 'flex', alignItems: 'center', gap: 9,
              padding: '9px 11px',
              borderTop: i === 0 ? 'none' : '0.5px solid rgba(60,60,67,0.10)',
            }}>
              {isAI && <MRAIAvatar id={a.owner} size={22} />}
              {isHuman && <MRHumanAvatar id={a.owner} size={22} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12.5, color: '#1C1C1E', fontWeight: 500,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{a.title}</div>
                <div style={{ fontSize: 10.5, color: '#8E8E93', marginTop: 1, display: 'flex', gap: 6 }}>
                  <span>{a.source}</span>
                  <span>·</span>
                  <span style={{ fontWeight: 600, color: '#FF9F0A' }}>截止 {a.due}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ParkingLotPanel() {
  return (
    <div>
      <SectionLabel right={`${PARKING.length} 项`}>Parking Lot</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {PARKING.map(p => (
          <div key={p.id} style={{
            background: '#fff', borderRadius: 10,
            border: '0.5px dashed rgba(60,60,67,0.30)',
            padding: '9px 11px',
          }}>
            <div style={{ fontSize: 12.5, color: '#1C1C1E', fontWeight: 500, lineHeight: 1.4 }}>
              {p.title}
            </div>
            <div style={{
              fontSize: 10.5, color: '#8E8E93', marginTop: 3,
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <span>{p.from}</span>
              <span>·</span>
              <span>{p.at}</span>
              <span style={{ marginLeft: 'auto', color: '#007AFF', fontWeight: 600, cursor: 'pointer' }}>
                立即讨论
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReferencesPanel() {
  const iconFor  = { doc: 'note',    data: 'sparkle', mtg: 'clock' };
  const colorFor = { doc: '#34C759', data: '#5E5CE6', mtg: '#0A84FF' };
  return (
    <div>
      <SectionLabel right="管理 →">相关参考</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {REFS.map((r, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 9,
            padding: '8px 11px', borderRadius: 10,
            background: '#fff', border: '0.5px solid #E5E5EA', cursor: 'pointer',
          }}>
            <div style={{
              width: 26, height: 26, borderRadius: 6,
              background: colorFor[r.kind] + '18',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <MRIcon name={iconFor[r.kind]} size={13} color={colorFor[r.kind]} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 12.5, color: '#1C1C1E', fontWeight: 500,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{r.title}</div>
              <div style={{ fontSize: 10.5, color: '#8E8E93', marginTop: 1 }}>{r.sub}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// derived: which AI experts have spoken & last contribution
const AI_USAGE = (() => {
  const u = {};
  Object.keys(MR_AIS).forEach(k => u[k] = { active: false, last: null });
  MR_MESSAGES.forEach(m => {
    if (m.kind === 'ai' && u[m.who]) {
      u[m.who].active = true;
      u[m.who].last = m;
    }
  });
  return u;
})();

function AIExpertsPanel({ onSummon }) {
  const keys = Object.keys(MR_AIS);
  return (
    <div>
      <SectionLabel right="管理 →">AI 专家 · {keys.length}</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {keys.map(k => {
          const a = MR_AIS[k];
          const u = AI_USAGE[k];
          return (
            <div key={k} style={{
              background: '#fff', borderRadius: 12,
              border: '0.5px solid #E5E5EA',
              padding: '12px 12px', position: 'relative', overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', top: -12, right: -12, width: 60, height: 60,
                borderRadius: '50%', opacity: 0.10,
                background: `linear-gradient(135deg, ${a.grad[0]}, ${a.grad[1]})`,
              }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
                <MRAIAvatar id={k} size={34} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{a.name}</span>
                    {u.active && (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                        fontSize: 10, fontWeight: 600, color: '#34C759',
                        background: 'rgba(52,199,89,0.12)',
                        padding: '1px 6px', borderRadius: 8,
                      }}>
                        <span style={{
                          width: 5, height: 5, borderRadius: '50%', background: '#34C759',
                          animation: 'livePulse 1.4s ease-in-out infinite',
                        }} />
                        已发言
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#8E8E93', marginTop: 1 }}>{a.role}</div>
                </div>
              </div>
              {u.last && (
                <div style={{
                  marginTop: 9, fontSize: 12, color: '#3C3C43',
                  lineHeight: 1.45, paddingLeft: 8,
                  borderLeft: `2px solid ${a.grad[0]}55`,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>"{u.last.body}"</div>
              )}
              <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                <button onClick={() => onSummon && onSummon(k)} style={{
                  flex: 1, height: 30, borderRadius: 8,
                  background: `linear-gradient(135deg, ${a.grad[0]}, ${a.grad[1]})`,
                  border: 'none', color: '#fff',
                  fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                }}>
                  <MRIcon name="sparkle" size={12} color="#fff" /> @ 唤醒
                </button>
                <button style={{
                  width: 30, height: 30, borderRadius: 8,
                  background: '#F2F2F7', border: 'none',
                  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}><MRIcon name="more" size={14} color="#1C1C1E" /></button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HostInlineCard({ onAskHost }) {
  return (
    <div>
      <SectionLabel>主持人</SectionLabel>
      <div style={{
        background: 'linear-gradient(135deg, rgba(255,179,64,0.08), rgba(255,159,10,0.13))',
        border: '0.5px solid rgba(255,159,10,0.30)',
        borderRadius: 12, padding: '14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <MRHostAvatar size={36} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{MR_HOST.name}</div>
            <div style={{ fontSize: 11, color: '#8E8E93' }}>{MR_HOST.role}</div>
          </div>
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: '#3C3C43', lineHeight: 1.5 }}>
          {MR_HOST.desc}
        </div>
        <button onClick={onAskHost} style={{
          marginTop: 11, width: '100%', height: 34, borderRadius: 8,
          background: 'linear-gradient(135deg, #FFB340, #FF9F0A)',
          border: 'none', color: '#fff',
          fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        }}>
          <MRIcon name="compass" size={14} color="#fff" /> 问主持人
        </button>
      </div>
    </div>
  );
}

// ─────────── Center: filter banner + transcript + input ───────────
function FilterBanner({ selected, onChange, matched, total, onOpen }) {
  if (selected.size === 0) return null;
  const keys = [...selected];
  const remove = (k) => { const n = new Set(selected); n.delete(k); onChange(n); };
  return (
    <div style={{
      background: 'rgba(0,122,255,0.06)',
      borderBottom: '0.5px solid rgba(0,122,255,0.20)',
      padding: '9px 28px', display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <MRIcon name="filter" size={14} color="#007AFF" />
      <div style={{ fontSize: 12, fontWeight: 600, color: '#007AFF' }}>仅显示</div>
      <div style={{ display: 'flex', gap: 6, flex: 1, flexWrap: 'wrap' }}>
        {keys.map(k => (
          <button key={k} onClick={() => remove(k)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: '#fff', border: '0.5px solid rgba(0,122,255,0.30)',
            borderRadius: 14, padding: '2px 10px 2px 3px',
            fontSize: 12, color: '#1C1C1E', fontFamily: 'inherit', cursor: 'pointer',
          }}>
            <WebSpeakerAvatar k={k} size={20} />
            {webSpeakerLabel(k)}
            <svg width="11" height="11" viewBox="0 0 24 24">
              <path d="M6 6l12 12M18 6L6 18" stroke="#8E8E93" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        ))}
      </div>
      <div style={{ fontSize: 12, color: '#8E8E93' }}>{matched}/{total} 条</div>
      <button onClick={() => onChange(new Set())} style={{
        background: 'none', border: 'none', color: '#007AFF',
        fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
      }}>清除</button>
      <button onClick={onOpen} style={{
        background: 'none', border: 'none', color: '#007AFF',
        fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
      }}>编辑</button>
    </div>
  );
}

function InputBar({ onSummon, onAskHost }) {
  const [text, setText] = useState('');
  const [showMention, setShowMention] = useState(false);
  const ref = useRef(null);

  const handleChange = (v) => {
    setText(v);
    setShowMention(/@\S*$/.test(v));
  };

  return (
    <div style={{
      borderTop: '0.5px solid #E5E5EA', background: '#fff',
      padding: '12px 24px', position: 'relative',
    }}>
      {showMention && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 4px)', left: 24, right: 24,
          maxWidth: 360,
          background: '#fff', borderRadius: 12,
          boxShadow: '0 8px 28px rgba(0,0,0,0.15), 0 0 0 0.5px rgba(60,60,67,0.12)',
          padding: 6, zIndex: 5,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#8E8E93',
            padding: '6px 10px', letterSpacing: 0.4 }}>@提及</div>
          <div onClick={() => { setText(text.replace(/@\S*$/, '@主持人 ')); setShowMention(false); ref.current?.focus(); }}
               style={mentionRow()}>
            <MRHostAvatar size={24} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{MR_HOST.name} <span style={{ color: '#8E8E93', fontWeight: 400 }}>主持人</span></div>
              <div style={{ fontSize: 11, color: '#8E8E93' }}>拆解你的问题并路由</div>
            </div>
          </div>
          {Object.entries(MR_AIS).map(([k, a]) => (
            <div key={k}
                 onClick={() => { setText(text.replace(/@\S*$/, `@${a.name} `)); setShowMention(false); ref.current?.focus(); }}
                 style={mentionRow()}>
              <MRAIAvatar id={k} size={24} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{a.name} <span style={{ color: '#8E8E93', fontWeight: 400 }}>{a.role}</span></div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        background: '#F2F2F7', borderRadius: 12,
        padding: '8px 12px',
      }}>
        <button onClick={onSummon} title="召唤 AI 专家" style={iconBtn()}>
          <MRIcon name="sparkle" size={16} color="#5E5CE6" />
        </button>
        <button onClick={onAskHost} title="问主持人" style={iconBtn()}>
          <MRIcon name="compass" size={16} color="#FF9F0A" />
        </button>
        <input
          ref={ref}
          value={text}
          onChange={e => handleChange(e.target.value)}
          placeholder="输入消息发送到会议… 用 @ 提及主持人或 AI 专家"
          style={{
            flex: 1, border: 'none', outline: 'none', background: 'transparent',
            fontFamily: 'inherit', fontSize: 14, color: '#1C1C1E',
          }}
        />
        <button style={iconBtn()} title="语音输入">
          <MRIcon name="mic-fill" size={16} color="#1C1C1E" />
        </button>
        <button onClick={() => setText('')}
                disabled={!text}
                style={{
          height: 32, padding: '0 14px', borderRadius: 8,
          background: text ? '#007AFF' : '#E5E5EA',
          color: text ? '#fff' : '#8E8E93',
          border: 'none', fontSize: 13, fontWeight: 600,
          fontFamily: 'inherit', cursor: text ? 'pointer' : 'not-allowed',
        }}>发送</button>
      </div>
    </div>
  );
}
function iconBtn() {
  return {
    width: 32, height: 32, borderRadius: 8, background: 'transparent',
    border: 'none', cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  };
}
function mentionRow() {
  return {
    display: 'flex', alignItems: 'center', gap: 9,
    padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
  };
}

// ─────────── Bottom controls bar ───────────
function BottomBar({ muted, setMuted, video, setVideo, hand, setHand, cc, setCC, onMore }) {
  return (
    <div style={{
      height: 72, background: '#fff', borderTop: '0.5px solid #E5E5EA',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
      padding: '0 24px', flexShrink: 0,
    }}>
      <CtrlPill icon={muted ? 'mic-off' : 'mic'} label={muted ? '已静音' : '麦克风'}
        active={muted} activeBg="#FF3B30" onClick={() => setMuted(!muted)} />
      <CtrlPill icon={video ? 'video' : 'video-off'} label={video ? '摄像头' : '已关闭'}
        active={!video} activeBg="#8E8E93" onClick={() => setVideo(!video)} />
      <CtrlPill icon="hand" label={hand ? '举手中' : '举手'}
        active={hand} activeBg="#FF9F0A" onClick={() => setHand(!hand)} />
      <CtrlPill icon="cc" label="字幕"
        active={cc} activeBg="#007AFF" onClick={() => setCC(!cc)} />
      <div style={{ width: 1, height: 32, background: '#E5E5EA', margin: '0 4px' }} />
      <CtrlPill icon="share"    label="屏幕共享" />
      <CtrlPill icon="note"     label="纪要" />
      <CtrlPill icon="more"     label="更多" onClick={onMore} />
    </div>
  );
}

function CtrlPill({ icon, label, active, activeBg = '#1C1C1E', onClick }) {
  return (
    <button onClick={onClick} style={{
      height: 48, padding: '0 16px', borderRadius: 12,
      background: active ? activeBg : '#F2F2F7',
      color: active ? '#fff' : '#1C1C1E',
      border: 'none',
      display: 'inline-flex', alignItems: 'center', gap: 8,
      fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
      transition: 'background 140ms ease',
    }}>
      <MRIcon name={icon} size={18} color={active ? '#fff' : '#1C1C1E'} />
      <span>{label}</span>
    </button>
  );
}

// ─────────── Filter modal (web — centered) ───────────
function FilterModal({ open, selected, onChange, onClose, counts }) {
  if (!open) return null;
  const toggle = k => {
    const n = new Set(selected);
    if (n.has(k)) n.delete(k); else n.add(k);
    onChange(n);
  };

  const Section = ({ title, keys }) => (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#8E8E93',
        letterSpacing: 0.4, padding: '0 4px 8px' }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {keys.map(k => {
          const sel = selected.has(k);
          const sub = k === 'host' ? MR_HOST.role
                    : MR_HUMANS[k] ? MR_HUMANS[k].role
                    : MR_AIS[k] ? MR_AIS[k].role : '';
          return (
            <div key={k} onClick={() => toggle(k)} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 11px', borderRadius: 10,
              background: sel ? 'rgba(0,122,255,0.08)' : '#F7F7F8',
              border: sel ? '0.5px solid rgba(0,122,255,0.35)' : '0.5px solid transparent',
              cursor: 'pointer',
            }}>
              <WebSpeakerAvatar k={k} size={30} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{webSpeakerLabel(k)}</div>
                <div style={{ fontSize: 11, color: '#8E8E93' }}>{sub} · {counts[k] || 0} 条</div>
              </div>
              <div style={{
                width: 20, height: 20, borderRadius: 5,
                background: sel ? '#007AFF' : '#fff',
                border: sel ? 'none' : '1.5px solid #C7C7CC',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {sel && <MRIcon name="check" size={13} color="#fff" />}
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
        position: 'absolute', left: '50%', top: '50%',
        transform: 'translate(-50%, -50%)', width: 640, maxHeight: '80%',
        background: '#fff', borderRadius: 14, zIndex: 81,
        boxShadow: '0 24px 60px rgba(0,0,0,0.30)',
        display: 'flex', flexDirection: 'column',
        animation: 'popIn 200ms cubic-bezier(.22,.61,.36,1)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '0.5px solid #E5E5EA',
        }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>筛选发言</div>
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: 8, border: 'none',
            background: '#F2F2F7', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24">
              <path d="M6 6l12 12M18 6L6 18" stroke="#1C1C1E" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div style={{ padding: '6px 20px 20px', overflow: 'auto' }}>
          <div style={{ fontSize: 12, color: '#8E8E93', padding: '10px 4px 0', lineHeight: 1.5 }}>
            勾选 1 人或多人,timeline 仅显示其发言。会议中和会后归档共用一套筛选规则。
          </div>
          <Section title="主持人" keys={['host']} />
          <Section title={`团队成员 · ${Object.keys(MR_HUMANS).length} 人`} keys={Object.keys(MR_HUMANS)} />
          <Section title={`AI 专家 · ${Object.keys(MR_AIS).length} 位`} keys={Object.keys(MR_AIS)} />
        </div>
        <div style={{
          padding: '12px 20px', borderTop: '0.5px solid #E5E5EA',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <button onClick={() => onChange(new Set())} disabled={selected.size === 0} style={{
            background: 'none', border: 'none',
            color: selected.size === 0 ? '#C7C7CC' : '#007AFF',
            fontSize: 14, fontFamily: 'inherit',
            cursor: selected.size === 0 ? 'default' : 'pointer',
          }}>清空选择</button>
          <button onClick={onClose} style={{
            height: 34, padding: '0 18px', borderRadius: 8,
            background: '#007AFF', color: '#fff', border: 'none',
            fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
          }}>完成 · 已选 {selected.size}</button>
        </div>
      </div>
    </>
  );
}

function EndModal({ open, onCancel }) {
  if (!open) return null;
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 90 }} />
      <div style={{
        position: 'absolute', left: '50%', top: '50%',
        transform: 'translate(-50%, -50%)', width: 380, zIndex: 91,
        background: '#fff', borderRadius: 14,
        boxShadow: '0 24px 60px rgba(0,0,0,0.30)', overflow: 'hidden',
        animation: 'popIn 200ms cubic-bezier(.22,.61,.36,1)',
      }}>
        <div style={{ padding: '22px 22px 18px' }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>结束会议?</div>
          <div style={{ fontSize: 13, color: '#3C3C43', marginTop: 8, lineHeight: 1.5 }}>
            主持人 Mira 会自动整理 AI 摘要、决策项与行动项,完成后发给所有参会成员,也会沉淀到会议历史。
          </div>
        </div>
        <div style={{ display: 'flex', borderTop: '0.5px solid #E5E5EA' }}>
          <button onClick={onCancel} style={{
            flex: 1, height: 48, background: 'none', border: 'none',
            color: '#007AFF', fontSize: 14, fontFamily: 'inherit', cursor: 'pointer',
            borderRight: '0.5px solid #E5E5EA',
          }}>取消</button>
          <button onClick={onCancel} style={{
            flex: 1, height: 48, background: '#FFF1F0', border: 'none',
            color: '#FF3B30', fontSize: 14, fontWeight: 600,
            fontFamily: 'inherit', cursor: 'pointer',
          }}>结束并生成纪要</button>
        </div>
      </div>
    </>
  );
}

// ─────────── App ───────────
function MeetingRoom() {
  const [timer, setTimer]   = useState('23:14');
  const [muted, setMuted]   = useState(false);
  const [video, setVideo]   = useState(false);
  const [hand, setHand]     = useState(false);
  const [cc, setCC]         = useState(true);
  const [ended, setEnded]   = useState(false);
  const [filter, setFilter] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const scrollRef = useRef(null);

  const jumpTo = (idx) => {
    const target = document.getElementById(`msg-${idx}`);
    const scroller = scrollRef.current;
    if (!target || !scroller) return;
    const top = target.offsetTop - scroller.offsetTop - 24;
    scroller.scrollTo({ top, behavior: 'smooth' });
    target.style.transition = 'background 220ms ease';
    target.style.background = 'rgba(0,122,255,0.08)';
    setTimeout(() => { target.style.background = 'transparent'; }, 1200);
  };
  // Expose jumpTo globally so AgendaTimeline (rendered as part of TopBar) can use it without prop drilling
  useEffect(() => { window.__mr_jump_to__ = jumpTo; return () => { delete window.__mr_jump_to__; }; }, []);
  const jumpToLatest = () => {
    const s = scrollRef.current;
    if (s) s.scrollTo({ top: s.scrollHeight, behavior: 'smooth' });
  };
  const handleScroll = (e) => {
    const el = e.target;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setShowJump(!atBottom);
  };

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      const total = 23 * 60 + 14 + elapsed;
      setTimer(`${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, []);

  const counts = useMemo(() => {
    const c = {};
    MR_MESSAGES.forEach(m => {
      if (m.kind === 'round') {
        c['host'] = (c['host'] || 0) + 1;
        m.experts.forEach(e => { c[e.who] = (c[e.who] || 0) + 1; });
      } else {
        const k = webSpeakerKey(m);
        c[k] = (c[k] || 0) + 1;
      }
    });
    return c;
  }, []);

  const visibleMessages = useMemo(() => {
    if (selected.size === 0) return MR_MESSAGES;
    return MR_MESSAGES.filter(m => webRoundMatches(m, selected));
  }, [selected]);

  const toggleSpeaker = (k) => {
    const n = new Set(selected);
    if (n.has(k)) n.delete(k); else n.add(k);
    setSelected(n);
  };

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      background: '#fff', position: 'relative', overflow: 'hidden',
      fontFamily: 'inherit',
    }}>
      <TopBar
        timer={timer}
        onFilter={() => setFilter(true)}
        filterActive={selected.size > 0}
        filterCount={selected.size}
        onEnd={() => setEnded(true)}
        selected={selected}
        onToggleSpeaker={toggleSpeaker}
      />

      <div style={{ flex: 1, display: 'flex', minHeight: 0, background: '#fff' }}>
        <LeftPanel onJumpTo={jumpTo} selected={selected} onToggleSpeaker={toggleSpeaker} />

        {/* center */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: '#fff' }}>
          <FilterBanner
            selected={selected} onChange={setSelected}
            matched={visibleMessages.length} total={MR_MESSAGES.length}
            onOpen={() => setFilter(true)}
          />
          <div ref={scrollRef} onScroll={handleScroll} style={{
            flex: 1, overflow: 'auto', background: '#fff',
            paddingTop: 12, paddingBottom: 12, position: 'relative',
          }}>
            {visibleMessages.length === 0 ? (
              <div style={{
                padding: '120px 28px', textAlign: 'center', color: '#8E8E93',
              }}>
                <div style={{ fontSize: 28, opacity: 0.4, marginBottom: 8 }}>⌕</div>
                筛选后无发言<br/>
                <span style={{ fontSize: 12, color: '#C7C7CC' }}>试试再勾选一些人</span>
              </div>
            ) : MR_MESSAGES.map((m, i) => {
              if (!webRoundMatches(m, selected)) return null;
              return (
                <div key={i} id={`msg-${i}`}>
                  {m.kind === 'human' && <WebHumanMessage m={m} />}
                  {m.kind === 'ai'    && <WebAIMessage    m={m} />}
                  {m.kind === 'host'  && <WebHostMessage  m={m} />}
                  {m.kind === 'round' && <WebRoundMessage m={m} initialOpen={webRoundInitial(m, selected)} />}
                </div>
              );
            })}
            {(selected.size === 0 || selected.has('WJ')) && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 28px 20px', fontSize: 12.5, color: '#8E8E93',
              }}>
                <MRHumanAvatar id="WJ" size={20} />
                <span>王俊 正在说话</span>
                <WebWaveform active />
              </div>
            )}
            {showJump && (
              <button onClick={jumpToLatest} style={{
                position: 'sticky', bottom: 16, marginLeft: 'auto', marginRight: 24,
                float: 'right', clear: 'both',
                width: 40, height: 40, borderRadius: '50%',
                background: '#fff', border: 'none',
                boxShadow: '0 4px 14px rgba(0,0,0,0.18), 0 0 0 0.5px rgba(60,60,67,0.12)',
                cursor: 'pointer', zIndex: 10,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                animation: 'fadeIn 200ms ease',
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path d="M12 5v14M6 13l6 6 6-6" stroke="#007AFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                </svg>
              </button>
            )}
          </div>
          <InputBar onSummon={() => {}} onAskHost={() => {}} />
        </div>

        <RightPanel />
      </div>

      <BottomBar
        muted={muted} setMuted={setMuted}
        video={video} setVideo={setVideo}
        hand={hand} setHand={setHand}
        cc={cc} setCC={setCC}
        onMore={() => {}}
      />

      <FilterModal
        open={filter}
        selected={selected} onChange={setSelected}
        onClose={() => setFilter(false)}
        counts={counts}
      />
      <EndModal open={ended} onCancel={() => setEnded(false)} />
    </div>
  );
}

function WebApp() {
  return (
    <ChromeWindow
      width={1440} height={900}
      tabs={[
        { title: 'AIMeeting — Q3 路线图对齐', active: true },
        { title: '会议历史' },
      ]}
      activeIndex={0}
      url="meeting.aimeeting.app/q3-roadmap"
    >
      <MeetingRoom />
    </ChromeWindow>
  );
}

const style = document.createElement('style');
style.textContent = `
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
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
  @keyframes urgentPulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(255,59,48,0.20); }
    50%      { box-shadow: 0 0 0 4px rgba(255,59,48,0.10); }
  }
  @keyframes speakingPulse {
    0%, 100% { box-shadow: 0 0 0 2px #34C759, 0 0 0 4px rgba(52,199,89,0.30); }
    50%      { box-shadow: 0 0 0 2px #34C759, 0 0 0 8px rgba(52,199,89,0); }
  }
  @keyframes popIn {
    from { opacity: 0; transform: translate(-50%, -50%) scale(0.85); }
    to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  }
  div::-webkit-scrollbar { width: 8px; height: 8px; }
  div::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 4px; }
  div::-webkit-scrollbar-track { background: transparent; }
  input::placeholder { color: #8E8E93; }
`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById('root')).render(<WebApp />);
