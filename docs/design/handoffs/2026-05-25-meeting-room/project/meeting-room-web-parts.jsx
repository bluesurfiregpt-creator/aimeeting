// Web version of the meeting room — shared parts: message renderers, panels, modals
// Reuses MR_HUMANS, MR_AIS, MR_HOST, MR_AGENDA, MR_MESSAGES, MRHumanAvatar, MRAIAvatar, MRHostAvatar, MRIcon
// from meeting-room-shared.jsx (window globals).

const { useState: useStateW, useMemo: useMemoW, useRef: useRefW, useEffect: useEffectW } = React;

// ─────────── helpers ───────────
function WebWaveform({ active = true, color = '#34C759', bars = 4 }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, height: 14 }}>
      {Array.from({ length: bars }).map((_, i) => (
        <span key={i} style={{
          width: 2.5, borderRadius: 2, background: color,
          height: active ? 14 : 4,
          animation: active ? `wfBar 900ms ease-in-out ${i * 110}ms infinite alternate` : 'none',
        }} />
      ))}
    </div>
  );
}

function WebDots() {
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

function webRenderMentions(text) {
  const parts = text.split(/(@\S+)/);
  return parts.map((p, i) => p.startsWith('@')
    ? <span key={i} style={{ color: '#5E5CE6', fontWeight: 500 }}>{p}</span>
    : <span key={i}>{p}</span>);
}

function webSpeakerKey(m) {
  if (m.kind === 'host') return 'host';
  if (m.kind === 'round') return 'round';
  return m.who;
}
function webRoundMatches(m, selected) {
  if (selected.size === 0) return true;
  if (m.kind !== 'round') return selected.has(webSpeakerKey(m));
  const keys = ['host', ...m.experts.map(e => e.who)];
  return keys.some(k => selected.has(k));
}
function webRoundInitial(m, selected) {
  if (m.kind !== 'round' || selected.size === 0) return null;
  const e = m.experts.find(x => selected.has(x.who));
  return e ? e.who : null;
}
function webSpeakerLabel(k) {
  if (k === 'host') return MR_HOST.name;
  if (MR_HUMANS[k]) return MR_HUMANS[k].name;
  if (MR_AIS[k])    return MR_AIS[k].name;
  return k;
}
function WebSpeakerAvatar({ k, size = 28 }) {
  if (k === 'host')    return <MRHostAvatar size={size} />;
  if (MR_HUMANS[k])    return <MRHumanAvatar id={k} size={size} />;
  if (MR_AIS[k])       return <MRAIAvatar id={k} size={size} />;
  return null;
}

// ─────────── Message renderers (web density) ───────────
function WebHumanMessage({ m }) {
  const p = MR_HUMANS[m.who];
  return (
    <div style={{ display: 'flex', gap: 12, padding: '10px 28px' }}>
      <MRHumanAvatar id={m.who} size={36} />
      <div style={{ flex: 1, minWidth: 0, maxWidth: 720 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#1C1C1E' }}>{p.name}</span>
          <span style={{ fontSize: 12, color: '#8E8E93' }}>{p.role}</span>
          <span style={{ fontSize: 12, color: '#C7C7CC' }}>· {m.t}</span>
          {p.speaking && <WebWaveform active />}
          {m.summon && (
            <span style={{ marginLeft: 4, fontSize: 11, color: '#5E5CE6',
              display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <MRIcon name="sparkle" size={11} color="#5E5CE6" />
              唤醒 {MR_AIS[m.summon].name}
            </span>
          )}
          {m.askHost && (
            <span style={{ marginLeft: 4, fontSize: 11, color: '#FF9F0A',
              display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <MRIcon name="compass" size={11} color="#FF9F0A" />
              向主持人提问
            </span>
          )}
          {m.offTopic && (
            <span style={{ marginLeft: 4, fontSize: 11, color: '#FF453A',
              display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <MRIcon name="compass" size={11} color="#FF453A" />
              偏离当前议程
            </span>
          )}
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.55, color: '#1C1C1E' }}>
          {webRenderMentions(m.text)}{m.partial && <WebDots />}
        </div>
      </div>
    </div>
  );
}

function WebAIMessage({ m }) {
  const a = MR_AIS[m.who];
  return (
    <div style={{ padding: '8px 28px' }}>
      <div style={{
        background: '#fff', borderRadius: 12,
        border: '0.5px solid rgba(60,60,67,0.14)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
        maxWidth: 720, position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
          background: `linear-gradient(180deg, ${a.grad[0]}, ${a.grad[1]})`,
        }} />
        <div style={{ padding: '14px 18px 14px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <MRAIAvatar id={m.who} size={32} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{a.name}</span>
                <span style={{ fontSize: 12, color: '#8E8E93' }}>{a.role}</span>
                <span style={{ fontSize: 12, color: '#C7C7CC' }}>· {m.t}</span>
              </div>
              <div style={{ fontSize: 11, color: '#8E8E93', marginTop: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                {m.via?.kind === 'summon' && (<>
                  <MRIcon name="sparkle" size={10} color="#5E5CE6" />
                  由 {MR_HUMANS[m.via.by].name} 唤醒
                </>)}
                {m.via?.kind === 'host' && (<>
                  <MRIcon name="route" size={11} color="#FF9F0A" />
                  由主持人转交
                </>)}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.55, color: '#1C1C1E' }}>
            {m.body}
          </div>

          {m.data && (
            <div style={{
              marginTop: 10, display: 'grid',
              gridTemplateColumns: `repeat(${m.data.length}, 1fr)`, gap: 8,
            }}>
              {m.data.map((row, i) => (
                <div key={i} style={{
                  background: '#F7F7F9', borderRadius: 8,
                  padding: '8px 10px',
                }}>
                  <div style={{ fontSize: 11, color: '#8E8E93', fontWeight: 600, letterSpacing: 0.3 }}>{row.label}</div>
                  <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{row.v}</div>
                </div>
              ))}
            </div>
          )}

          {m.note && (
            <div style={{
              marginTop: 10, fontSize: 13.5, lineHeight: 1.5, color: '#3C3C43',
              padding: '8px 12px', borderRadius: 8,
              background: `linear-gradient(135deg, ${a.grad[0]}10, ${a.grad[1]}10)`,
              border: `0.5px solid ${a.grad[0]}33`,
            }}>{m.note}</div>
          )}

          {m.actions && (
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              {m.actions.map((label, i) => (
                <button key={i} style={{
                  padding: '7px 14px', borderRadius: 8, height: 32,
                  border: i === 0 ? 'none' : '0.5px solid rgba(60,60,67,0.16)',
                  background: i === 0 ? '#007AFF' : '#fff',
                  color: i === 0 ? '#fff' : '#007AFF',
                  fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
                }}>{label}</button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WebHostMessage({ m }) {
  // Chapter divider for agenda transitions
  if (m.tone === 'agenda') {
    const match = (m.body || '').match(/议程\s*(\d+)\s*[:：](.+?)$/);
    const newNum = match ? parseInt(match[1]) : null;
    const newTitle = match ? match[2].trim() : m.title;
    const agenda = newNum ? MR_AGENDA.find(a => a.id === newNum) : null;
    return (
      <div style={{ padding: '28px 28px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, maxWidth: 720 }}>
          <div style={{ flex: 1, height: 0.5, background: '#C7C7CC' }} />
          <span style={{
            fontSize: 11, fontWeight: 700, color: '#8E8E93',
            letterSpacing: 0.8, textTransform: 'uppercase',
          }}>议程 {newNum || '—'} / {MR_AGENDA.length}</span>
          <div style={{ flex: 1, height: 0.5, background: '#C7C7CC' }} />
        </div>
        <div style={{
          textAlign: 'center', fontSize: 19, fontWeight: 700, color: '#1C1C1E',
          marginTop: 9, letterSpacing: -0.2, maxWidth: 720,
        }}>{newTitle}</div>
        <div style={{
          textAlign: 'center', fontSize: 12.5, color: '#8E8E93', marginTop: 5,
          maxWidth: 720, display: 'flex', justifyContent: 'center', gap: 10,
        }}>
          {agenda && <><span>{agenda.minutes} 分钟</span><span>·</span></>}
          <span style={{ color: '#34C759', fontWeight: 600 }}>议程 {newNum - 1} 完成 ✓</span>
          <span>·</span>
          <span>{m.t}</span>
        </div>
      </div>
    );
  }

  if (m.tone === 'drift-soft') {
    return (
      <div style={{ padding: '6px 28px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 9,
          padding: '7px 12px', maxWidth: 720,
          background: 'rgba(255,159,10,0.07)',
          borderLeft: '2px solid #FFB340',
          borderRadius: '0 8px 8px 0',
        }}>
          <MRHostAvatar size={18} />
          <MRIcon name="compass" size={13} color="#B8860B" />
          <span style={{ fontSize: 13, color: '#8B6914', flex: 1 }}>
            <span style={{ fontWeight: 600 }}>Mira</span> · {m.body}
          </span>
          <span style={{ fontSize: 11, color: '#B8860B' }}>{m.t}</span>
        </div>
      </div>
    );
  }

  if (m.tone === 'drift-strong') {
    return (
      <div style={{ padding: '10px 28px' }}>
        <div style={{
          background: 'linear-gradient(135deg, rgba(255,59,48,0.08), rgba(255,69,58,0.13))',
          borderRadius: 12, border: '1px solid rgba(255,59,48,0.40)',
          padding: '14px 18px', maxWidth: 720,
          animation: 'urgentPulse 2.2s ease-in-out infinite',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ position: 'relative' }}>
              <MRHostAvatar size={32} />
              <span style={{
                position: 'absolute', right: -2, bottom: -2,
                width: 13, height: 13, borderRadius: '50%',
                background: '#FF3B30', border: '1.5px solid #fff',
              }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{MR_HOST.name}</span>
                <span style={{ fontSize: 12, color: '#8E8E93' }}>主持人</span>
                <span style={{ fontSize: 12, color: '#8E8E93', marginLeft: 'auto' }}>{m.t}</span>
              </div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
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
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              flexShrink: 0, width: 90,
              background: '#fff', border: '1px solid rgba(255,59,48,0.30)',
              borderRadius: 10, padding: '8px 0', textAlign: 'center',
            }}>
              <div style={{ fontSize: 11, color: '#8E8E93', fontWeight: 600, letterSpacing: 0.3 }}>议程剩余</div>
              <div style={{
                fontSize: 24, fontWeight: 700, color: '#FF3B30',
                fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5, lineHeight: 1.1, marginTop: 2,
              }}>{m.countdown}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1C1C1E' }}>{m.title}</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.5, color: '#3C3C43', marginTop: 3 }}>{m.body}</div>
            </div>
          </div>
          {m.actions && (
            <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
              {m.actions.map((a, i) => (
                <button key={i} style={{
                  height: a.urgent ? 38 : 32, padding: '0 16px', borderRadius: 10,
                  border: a.primary ? 'none' : '0.5px solid rgba(60,60,67,0.16)',
                  background: a.primary ? (a.urgent ? '#FF3B30' : '#FF9F0A') : '#fff',
                  color: a.primary ? '#fff' : '#1C1C1E',
                  fontSize: a.urgent ? 14 : 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
                  boxShadow: a.urgent ? '0 2px 6px rgba(255,59,48,0.30)' : 'none',
                }}>{a.label}</button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const toneMeta = {
    agenda: { icon: 'check',   color: '#34C759', label: '议程切换' },
    drift:  { icon: 'compass', color: '#FF9F0A', label: '话题偏移 · 中度提醒' },
    route:  { icon: 'route',   color: '#FF9F0A', label: '问题拆解' },
    timer:  { icon: 'clock',   color: '#FF9F0A', label: '时间提醒' },
  };
  const meta = toneMeta[m.tone] || toneMeta.agenda;

  return (
    <div style={{ padding: '10px 28px' }}>
      <div style={{
        background: 'linear-gradient(135deg, rgba(255,179,64,0.06), rgba(255,159,10,0.09))',
        borderRadius: 12, border: '0.5px solid rgba(255,159,10,0.28)',
        padding: '14px 18px', maxWidth: 720,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <MRHostAvatar size={30} />
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{MR_HOST.name}</span>
              <span style={{ fontSize: 12, color: '#8E8E93' }}>主持人</span>
              <span style={{ fontSize: 12, color: '#8E8E93', marginLeft: 'auto' }}>{m.t}</span>
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <MRIcon name={meta.icon} size={12} color={meta.color} />
              <span style={{ fontSize: 11, fontWeight: 600, color: meta.color, letterSpacing: 0.3 }}>{meta.label}</span>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          {m.title && <div style={{ fontSize: 15, fontWeight: 600, color: '#1C1C1E', marginBottom: 4 }}>{m.title}</div>}
          {m.body && <div style={{ fontSize: 14, lineHeight: 1.55, color: '#3C3C43' }}>{m.body}</div>}
          {m.items && (
            <div style={{ marginTop: 6 }}>
              {m.items.map((it, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 10,
                  padding: '8px 0',
                  borderTop: i === 0 ? 'none' : '0.5px solid rgba(60,60,67,0.10)',
                }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: '50%',
                    background: it.done ? '#34C759' : '#fff',
                    border: it.done ? 'none' : '1.5px solid #FF9F0A',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, marginTop: 2,
                  }}>
                    {it.done && <MRIcon name="check" size={12} color="#fff" />}
                    {it.loading && <span style={{
                      width: 7, height: 7, borderRadius: '50%', background: '#FF9F0A',
                      animation: 'livePulse 1.2s ease-in-out infinite',
                    }} />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: '#1C1C1E', display: 'flex', alignItems: 'center', gap: 4 }}>
                      {it.label}{it.loading && <WebDots />}
                    </div>
                    {it.detail && <div style={{ fontSize: 12.5, color: '#8E8E93', marginTop: 1 }}>{it.detail}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {m.actions && (
          <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {m.actions.map((a, i) => (
              <button key={i} style={{
                height: 32, padding: '0 14px', borderRadius: 8,
                border: a.primary ? 'none' : '0.5px solid rgba(255,159,10,0.4)',
                background: a.primary ? '#FF9F0A' : '#fff',
                color: a.primary ? '#fff' : '#B8860B',
                fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
              }}>{a.label}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────── AI Roundtable (multi-expert) — web density ───────────
const WEB_STANCE = {
  support: { color: '#34C759', label: '支持',  symbol: <MRIcon name="check" size={10} color="#fff" /> },
  caution: { color: '#FF9F0A', label: '注意',  symbol: <span style={{ color: '#fff', fontSize: 11, fontWeight: 800, lineHeight: 1 }}>!</span> },
  block:   { color: '#FF3B30', label: '反对',  symbol: <span style={{ color: '#fff', fontSize: 13, lineHeight: 0.7 }}>×</span> },
};

function WebStancePill({ stance }) {
  const s = WEB_STANCE[stance];
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, color: '#fff', letterSpacing: 0.3,
      background: s.color, padding: '2px 7px', borderRadius: 4, lineHeight: 1.2,
    }}>{s.label}</span>
  );
}

function WebStanceDot({ stance, size = 16 }) {
  const s = WEB_STANCE[stance];
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%',
      background: s.color,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>{s.symbol}</span>
  );
}

function WebMiraSynthesis({ summary, doneCount, total }) {
  if (!summary || !summary.points) {
    return (
      <div style={{
        padding: '14px 18px',
        background: 'linear-gradient(135deg, rgba(255,179,64,0.06), rgba(255,159,10,0.08))',
        borderBottom: '0.5px solid rgba(255,159,10,0.18)',
        display: 'flex', alignItems: 'center', gap: 9,
      }}>
        <MRHostAvatar size={22} />
        <span style={{ fontSize: 13.5, color: '#8B6914' }}>
          Mira 等待 {total - doneCount} 位专家完成…
        </span>
        <WebDots />
      </div>
    );
  }
  return (
    <div style={{
      padding: '14px 18px',
      background: 'linear-gradient(135deg, rgba(255,179,64,0.08), rgba(255,159,10,0.10))',
      borderBottom: '0.5px solid rgba(255,159,10,0.20)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
        <MRHostAvatar size={24} />
        <span style={{ fontSize: 14, fontWeight: 700 }}>Mira 综合</span>
        <span style={{
          fontSize: 11, color: '#8B6914', fontWeight: 700,
          background: 'rgba(255,159,10,0.15)', padding: '2px 8px', borderRadius: 4,
        }}>{summary.verdict}</span>
        {summary.conflict && (
          <span style={{
            fontSize: 11, color: '#fff', fontWeight: 700,
            background: '#FF3B30', padding: '2px 7px', borderRadius: 4,
          }}>存在分歧</span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {summary.points.map((p, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
            <span style={{ marginTop: 2 }}><WebStanceDot stance={p.stance} size={16} /></span>
            <span style={{ fontSize: 13.5, lineHeight: 1.5, color: '#1C1C1E' }}>
              <span style={{ fontWeight: 600 }}>{p.tag}:</span>
              <span style={{ color: '#3C3C43' }}> {p.text}</span>
            </span>
          </div>
        ))}
      </div>
      <div style={{
        marginTop: 10, padding: '9px 12px', background: '#fff', borderRadius: 8,
        fontSize: 13.5, lineHeight: 1.55, color: '#1C1C1E',
        border: '0.5px solid rgba(255,159,10,0.20)',
      }}>
        <span style={{ fontWeight: 700, color: '#FF9F0A' }}>→ 建议</span>
        <span style={{ marginLeft: 6 }}>{summary.recommendation}</span>
      </div>
    </div>
  );
}

function WebExpertAccordion({ expert, open, onToggle }) {
  const a = MR_AIS[expert.who];
  return (
    <div style={{ borderTop: '0.5px solid rgba(60,60,67,0.10)' }}>
      <div onClick={onToggle} style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '11px 18px',
        cursor: 'pointer',
        background: open ? '#FAFAFA' : '#fff',
      }}>
        <MRAIAvatar id={expert.who} size={30} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{a.name}</span>
            <WebStancePill stance={expert.stance} />
            <span style={{ fontSize: 12, color: '#8E8E93' }}>{a.role}</span>
            {!expert.done && (
              <span style={{ fontSize: 11, color: '#5E5CE6', fontWeight: 600 }}>
                分析中<WebDots />
              </span>
            )}
          </div>
          <div style={{
            fontSize: 13, color: '#3C3C43', marginTop: 2, lineHeight: 1.45,
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
        <div style={{ padding: '4px 18px 16px 60px' }}>
          <div style={{ fontSize: 14, lineHeight: 1.6, color: '#1C1C1E', marginBottom: 10 }}>
            {expert.summary}
          </div>
          {expert.data && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${expert.data.length}, 1fr)`,
              gap: 8, marginBottom: 10,
            }}>
              {expert.data.map((row, i) => (
                <div key={i} style={{
                  background: '#F7F7F9', borderRadius: 8, padding: '8px 11px',
                }}>
                  <div style={{ fontSize: 11, color: '#8E8E93', fontWeight: 600, letterSpacing: 0.3 }}>{row.label}</div>
                  <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{row.v}</div>
                </div>
              ))}
            </div>
          )}
          {expert.note && (
            <div style={{
              fontSize: 13, lineHeight: 1.55, color: '#3C3C43',
              padding: '9px 12px', borderRadius: 8,
              background: `linear-gradient(135deg, ${a.grad[0]}10, ${a.grad[1]}10)`,
              border: `0.5px solid ${a.grad[0]}33`,
            }}>{expert.note}</div>
          )}
        </div>
      )}
    </div>
  );
}

function WebRoundMessage({ m, initialOpen }) {
  const [open, setOpen] = useStateW(initialOpen || null);
  const doneCount = m.experts.filter(e => e.done).length;
  return (
    <div style={{ padding: '10px 28px' }}>
      <div style={{
        background: '#fff', borderRadius: 12,
        border: '0.5px solid rgba(60,60,67,0.14)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        overflow: 'hidden', maxWidth: 720,
      }}>
        {/* header */}
        <div style={{
          padding: '13px 18px 11px',
          background: 'linear-gradient(135deg, rgba(94,92,230,0.05), rgba(175,82,222,0.07))',
          borderBottom: '0.5px solid rgba(60,60,67,0.10)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <MRIcon name="sparkle" size={15} color="#5E5CE6" />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#5E5CE6', letterSpacing: 0.4 }}>
              AI 圆桌 · {doneCount}/{m.experts.length} 已答
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#8E8E93' }}>
              {MR_HUMANS[m.trigger.by].name} 发起 · {m.t}
            </span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, marginTop: 5, lineHeight: 1.35 }}>
            "{m.topic}"
          </div>
        </div>

        <WebMiraSynthesis summary={m.done ? m.miraSummary : null}
          doneCount={doneCount} total={m.experts.length} />

        <div style={{
          padding: '9px 18px 7px',
          fontSize: 11, fontWeight: 700, color: '#8E8E93', letterSpacing: 0.4,
          background: '#fff',
        }}>点击展开专家详情 · 一次只展开一位,timeline 不跳动</div>
        {m.experts.map(e => (
          <WebExpertAccordion key={e.who} expert={e}
            open={open === e.who}
            onToggle={() => setOpen(open === e.who ? null : e.who)}
          />
        ))}
      </div>
    </div>
  );
}

function webGetHighlights() {
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

Object.assign(window, {
  WebHumanMessage, WebAIMessage, WebHostMessage, WebRoundMessage,
  WebWaveform, WebDots, webRenderMentions,
  webSpeakerKey, webSpeakerLabel, WebSpeakerAvatar,
  webRoundMatches, webRoundInitial, webGetHighlights,
});
