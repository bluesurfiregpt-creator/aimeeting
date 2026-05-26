"use client";

/**
 * R5.D Web 会议室 in-meeting 主视图 — 组合所有子组件.
 *
 * 布局 (1440 桌面):
 *  ┌──────────────────────────────────────────────────────┐
 *  │ TopBar (Logo · LIVE · 人头 · END)  + AgendaTimeline   │  ← 顶 2 行
 *  ├────────┬───────────────────────────────┬─────────────┤
 *  │  Left  │  FilterBanner (条件出现)        │   Right    │
 *  │  280px │  ───────────────────────────  │   340px    │
 *  │  专家  │  Transcript (滚动列)            │   Mira 当下│
 *  │  + 时间│  human / ai / host / round     │   决策池   │
 *  │  线高光│  ───────────────────────────  │   行动项   │
 *  │        │  InputBar (输入 + @ mention)    │   Parking  │
 *  │        │                               │   Refs     │
 *  ├────────┴───────────────────────────────┴─────────────┤
 *  │ BottomBar (mic / video / hand / cc / share / 更多)    │
 *  └──────────────────────────────────────────────────────┘
 *
 * 状态管理 (全局 in this view):
 *  - timer: 会议已用时 (mm:ss), 每秒 tick
 *  - selected: 筛选选中集合 (人 / AI / host)
 *  - muted/video/hand/cc: 底部 toggle
 *  - ended/filter: modal 开关
 *  - showJump: scroll 离底时 FAB
 *
 * **后端契约** (Saga E.E 后续):
 *  - WebSocket subscribe → 替换 setInterval timer + MR_MESSAGES 流式 append
 *  - GET /api/meetings/{id} → 替换 MR_AGENDA / agenda state
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MR_MESSAGES,
  MR_AGENDA,
  type MRMessage,
  mrMessageMatchesSelected,
  mrRoundInitialOpen,
  mrMessageSpeakerKey,
} from "./data";
import { useMRAnimations } from "./useAnimations";
import { MRTopBar } from "./MRTopBar";
import { MRLeftPanel } from "./MRLeftPanel";
import { MRRightPanel } from "./MRRightPanel";
import { MRBottomBar } from "./MRBottomBar";
import { MRInputBar } from "./MRInputBar";
import { MRFilterBanner } from "./MRFilterBanner";
import { MRFilterModal, MREndModal } from "./MRModals";
import {
  MRHumanMessageView,
  MRAIMessageView,
  MRHostMessageView,
  MRRoundMessageView,
} from "./MRMessages";
import { MRHumanAvatar, MRIcon, MRWaveform } from "./atoms";
import { MR_HUMANS_IN_MEETING } from "./data";

export type MRLiveViewProps = {
  meetingId: string;
};

export function MRLiveView({ meetingId }: MRLiveViewProps) {
  useMRAnimations();

  const [timer, setTimer] = useState("23:14");
  const [muted, setMuted] = useState(false);
  const [video, setVideo] = useState(false);
  const [hand, setHand] = useState(false);
  const [cc, setCC] = useState(true);
  const [ended, setEnded] = useState(false);
  const [filter, setFilter] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── timer tick (mock — 从 23:14 起步, +1s/sec)
  useEffect(() => {
    const startMs = Date.now();
    const baseSec = 23 * 60 + 14;
    const id = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startMs) / 1000);
      const total = baseSec + elapsed;
      setTimer(
        `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`,
      );
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // ── auto-scroll 到底部 (mount)
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  // ── jump-to helpers
  const jumpToMessage = (idx: number) => {
    const target = document.getElementById(`mr-msg-${idx}`);
    const scroller = scrollRef.current;
    if (!target || !scroller) return;
    const top = target.offsetTop - scroller.offsetTop - 24;
    scroller.scrollTo({ top, behavior: "smooth" });
    target.style.transition = "background 220ms ease";
    target.style.background = "rgba(0,122,255,0.08)";
    setTimeout(() => {
      target.style.background = "transparent";
    }, 1200);
  };

  // map agenda id → first message idx in that agenda
  const agendaJumpIdx = (id: number): number => {
    if (id === 2) {
      return MR_MESSAGES.findIndex(
        (m) => m.kind === "host" && m.tone === "agenda",
      );
    }
    return -1;
  };

  const jumpToAgenda = (id: number) => {
    const idx = agendaJumpIdx(id);
    if (idx >= 0) jumpToMessage(idx);
  };

  const jumpToLatest = () => {
    const s = scrollRef.current;
    if (s) s.scrollTo({ top: s.scrollHeight, behavior: "smooth" });
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setShowJump(!atBottom);
  };

  // ── 筛选计数 (按 key, 含 round 解析为 host + experts)
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    MR_MESSAGES.forEach((m) => {
      if (m.kind === "round") {
        c["host"] = (c["host"] || 0) + 1;
        m.experts.forEach((e) => {
          c[e.who] = (c[e.who] || 0) + 1;
        });
      } else {
        const k = mrMessageSpeakerKey(m);
        c[k] = (c[k] || 0) + 1;
      }
    });
    return c;
  }, []);

  // ── visible / matched (筛选后的总条数)
  const visibleCount = useMemo(() => {
    if (selected.size === 0) return MR_MESSAGES.length;
    return MR_MESSAGES.filter((m) => mrMessageMatchesSelected(m, selected))
      .length;
  }, [selected]);

  const toggleSpeaker = (k: string) => {
    const n = new Set(selected);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setSelected(n);
  };

  // current meeting title from data — mock for now, q3-roadmap
  const meetingTitle = meetingId === "q3-roadmap" ? "Q3 路线图对齐" : "会议进行中";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        position: "relative",
        overflow: "hidden",
        fontFamily:
          '-apple-system, "SF Pro Text", "PingFang SC", "Helvetica Neue", Helvetica, "Segoe UI", system-ui, sans-serif',
        color: "#1C1C1E",
      }}
    >
      <MRTopBar
        timer={timer}
        filterActive={selected.size > 0}
        filterCount={selected.size}
        selected={selected}
        onFilter={() => setFilter(true)}
        onEnd={() => setEnded(true)}
        onToggleSpeaker={toggleSpeaker}
        onJumpToAgenda={jumpToAgenda}
        meetingTitle={meetingTitle}
      />

      <div
        style={{
          flex: 1,
          display: "flex",
          minHeight: 0,
          background: "#fff",
        }}
      >
        <MRLeftPanel
          selected={selected}
          onToggleSpeaker={toggleSpeaker}
          onJumpToMessage={jumpToMessage}
        />

        {/* Center */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            background: "#fff",
          }}
        >
          <MRFilterBanner
            selected={selected}
            onChange={setSelected}
            matched={visibleCount}
            total={MR_MESSAGES.length}
            onOpen={() => setFilter(true)}
          />
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            style={{
              flex: 1,
              overflow: "auto",
              background: "#fff",
              paddingTop: 12,
              paddingBottom: 12,
              position: "relative",
            }}
          >
            {visibleCount === 0 ? (
              <div
                style={{
                  padding: "120px 28px",
                  textAlign: "center",
                  color: "#8E8E93",
                }}
              >
                <div style={{ fontSize: 28, opacity: 0.4, marginBottom: 8 }}>
                  ⌕
                </div>
                筛选后无发言
                <br />
                <span style={{ fontSize: 12, color: "#C7C7CC" }}>
                  试试再勾选一些人
                </span>
              </div>
            ) : (
              MR_MESSAGES.map((m, i) => {
                if (!mrMessageMatchesSelected(m, selected)) return null;
                return <MessageRow key={i} idx={i} m={m} selected={selected} />;
              })
            )}

            {/* "王俊 正在说话" — 跟设计稿一致, 仅在未筛选或选了 WJ 时显 */}
            {(selected.size === 0 || selected.has("WJ")) && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 28px 20px",
                  fontSize: 12.5,
                  color: "#8E8E93",
                }}
              >
                <MRHumanAvatar id="WJ" size={20} />
                <span>{MR_HUMANS_IN_MEETING.WJ?.name ?? "—"} 正在说话</span>
                <MRWaveform active />
              </div>
            )}

            {showJump && (
              <button
                type="button"
                onClick={jumpToLatest}
                style={{
                  position: "sticky",
                  bottom: 16,
                  marginLeft: "auto",
                  marginRight: 24,
                  float: "right",
                  clear: "both",
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background: "#fff",
                  border: "none",
                  boxShadow:
                    "0 4px 14px rgba(0,0,0,0.18), 0 0 0 0.5px rgba(60,60,67,0.12)",
                  cursor: "pointer",
                  zIndex: 10,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  animation: "mrFadeIn 200ms ease",
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path
                    d="M12 5v14M6 13l6 6 6-6"
                    stroke="#007AFF"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </svg>
              </button>
            )}
          </div>
          <MRInputBar />
        </div>

        <MRRightPanel />
      </div>

      <MRBottomBar
        muted={muted}
        setMuted={setMuted}
        video={video}
        setVideo={setVideo}
        hand={hand}
        setHand={setHand}
        cc={cc}
        setCC={setCC}
      />

      <MRFilterModal
        open={filter}
        selected={selected}
        onChange={setSelected}
        onClose={() => setFilter(false)}
        counts={counts}
      />
      <MREndModal open={ended} onCancel={() => setEnded(false)} />
    </div>
  );
}

// ────────────── MessageRow — 多态分发 ──────────────
function MessageRow({
  idx,
  m,
  selected,
}: {
  idx: number;
  m: MRMessage;
  selected: Set<string>;
}) {
  return (
    <div id={`mr-msg-${idx}`}>
      {m.kind === "human" && <MRHumanMessageView m={m} />}
      {m.kind === "ai" && <MRAIMessageView m={m} />}
      {m.kind === "host" && <MRHostMessageView m={m} />}
      {m.kind === "round" && (
        <MRRoundMessageView m={m} initialOpen={mrRoundInitialOpen(m, selected)} />
      )}
    </div>
  );
}
