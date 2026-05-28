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
 *  - realLines / detail: backend 真数据 (Sprint 3 Web W1 接 E.E)
 *
 * **Sprint 3 Web W1 (Saga E.E 接通)**:
 *  - 2.5s 轮询 `/api/m/meetings/{id}/transcript` + `/api/m/meetings/{id}` (同 mobile pattern)
 *  - merge load (保留 streaming live line — backend 没传 streaming 时不会触发)
 *  - active speaker pulse (W_TOKENS 紫 #5E5CE6, MR_TOKENS 浅色一致)
 *  - fade-in 动画 (mrFadeIn keyframe, 已在 tokens.ts)
 *  - OrchestrateStatusBanner 顶部显示 phase + 议程 + 当前发言
 *  - 真数据 > 0 → 隐藏 mock MR_MESSAGES; 真数据 = 0 → fallback to mock (workspace 没真会议 时不空盘)
 *  - 显示 "演示数据" pill 反幻觉 (PM 防 mock 假装真实)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { MRHumanAvatar, MRWaveform } from "./atoms";
import { MR_HUMANS_IN_MEETING } from "./data";
import { api, type WebMeetingDetailOut, type WebTranscriptStreamLine } from "@/lib/api";
import { MRRealAILine, MRRealHumanLine } from "./MRRealMessages";
import { OrchestrateStatusBanner } from "./OrchestrateStatusBanner";
import { MRSupersededDrawer } from "./MRSupersededDrawer";
import { MR_TOKENS } from "./tokens";
// v1.4.0 Phase A · 6 (NORTH_STAR § 6.1): Web R5.D 会议室 mic + STT WS.
import { useWebMeetingStt } from "@/lib/web/meetingStt";

/** Saga E.E pattern: 2.5s 轮询 — orchestrator 写 agent_message 后 不走 WS push,
 *  必须 主动 拉. */
const POLL_INTERVAL_MS = 2500;

export type MRLiveViewProps = {
  meetingId: string;
};

export function MRLiveView({ meetingId }: MRLiveViewProps) {
  useMRAnimations();

  // v1.4.0 Phase A · 6: 开 WS + mic 控制 hook. mute toggle 由 micOn 反向 derive.
  // v1.4.0 Phase A 后置: + sendJson 给 MRInputBar 走 text_message.
  const {
    conn: wsConn,
    micOn,
    toggleMic,
    error: micError,
    clearError,
    sendJson,
  } = useWebMeetingStt(meetingId);

  // v1.4.0 Phase A 后置: me + workspace users — 给 MRInputBar speaker chip 用.
  // leader/admin 可代任一 user, member 只能 自己.
  const [me, setMe] = useState<{ user_id: string; name: string; role: string } | null>(
    null,
  );
  // v1.4.0 Phase C · 11 NEW-A 完整版: superseded chip 点开后 显 chain drawer
  const [supersededDrawerLine, setSupersededDrawerLine] = useState<
    WebTranscriptStreamLine | null
  >(null);
  const [workspaceUsers, setWorkspaceUsers] = useState<{ id: string; name: string }[]>(
    [],
  );
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      fetch("/api/auth/me", { credentials: "include" }).then((r) =>
        r.ok ? r.json() : null,
      ),
      api.listUsers().catch(() => [] as Array<{ id: string; name: string }>),
    ]).then(([meR, usersR]) => {
      if (cancelled) return;
      if (meR.status === "fulfilled" && meR.value) {
        const d = meR.value;
        setMe({ user_id: d.user_id, name: d.name, role: d.role });
      }
      if (usersR.status === "fulfilled" && Array.isArray(usersR.value)) {
        setWorkspaceUsers(
          usersR.value.map((u) => ({ id: u.id, name: u.name })),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const WEB_LEADER_ROLES = useMemo(
    () => new Set(["workspace_creator", "leader", "admin", "owner"]),
    [],
  );
  const meSpeaker = me ? { id: me.user_id, name: me.name } : null;
  const canBorrowSpeaker = !!me && WEB_LEADER_ROLES.has(me.role);
  const speakerOptions = useMemo(() => {
    if (!meSpeaker) return [];
    if (!canBorrowSpeaker) return [meSpeaker];
    const others = workspaceUsers
      .filter((u) => u.id !== meSpeaker.id)
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    return [meSpeaker, ...others];
  }, [meSpeaker, canBorrowSpeaker, workspaceUsers]);

  const handleSendText = useCallback(
    (text: string, speakerId: string | null) => {
      sendJson({
        action: "text_message",
        text,
        speaker_user_id: speakerId,
      });
    },
    [sendJson],
  );

  const [timer, setTimer] = useState("00:00");
  // muted 旧 state: 现在 跟 hook 同步 (muted = !micOn). 保留 state 兼容 BottomBar API.
  const muted = !micOn;
  const setMuted = useCallback(() => {
    void toggleMic();
  }, [toggleMic]);
  const [video, setVideo] = useState(false);
  const [hand, setHand] = useState(false);
  const [cc, setCC] = useState(true);
  const [ended, setEnded] = useState(false);
  const [filter, setFilter] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  // ─── Sprint 3 Web W1: backend 真接 state (Saga E.E pattern, 抄 mobile MeetingTranscriptView) ───
  const [realLines, setRealLines] = useState<WebTranscriptStreamLine[]>([]);
  const [detail, setDetail] = useState<WebMeetingDetailOut | null>(null);
  const [realDataLoaded, setRealDataLoaded] = useState(false);
  /** 后端是否有真数据 (real_lines > 0 OR detail.transcript_total > 0) — 决定 是否渲染 mock */
  const hasRealData = realLines.length > 0;
  /** 当前发言 agent_id (running 时 高亮 pulse) — 严格 Sprint 3 Web W1 active speaker pulse */
  const activeSpeakerAgentId =
    detail?.mode?.toLowerCase() === "auto" && detail?.orchestrate_phase === "running"
      ? detail.current_speaker_agent_id
      : null;

  // ── 2.5s 轮询 — 抄 mobile MeetingTranscriptView pattern.
  //    每次拉 detail (5 字段含 phase / current_speaker_agent_id) + transcript (按 created_at 正序).
  //    merge 语义: 用 incoming 替换 lines (backend final), 没 streaming line 需要 留 (没 WS).
  const load = useCallback(
    async (silent = false) => {
      try {
        const [d, t] = await Promise.allSettled([
          api.getWebMeetingDetail(meetingId),
          api.getWebMeetingTranscript(meetingId),
        ]);
        if (d.status === "fulfilled") {
          setDetail(d.value);
        }
        if (t.status === "fulfilled") {
          setRealLines(t.value.lines);
        }
        if (d.status === "fulfilled" || t.status === "fulfilled") {
          setRealDataLoaded(true);
        }
      } catch (e) {
        if (!silent) console.warn("[MRLiveView] poll failed:", e);
      }
    },
    [meetingId],
  );

  useEffect(() => {
    void load(false);
    const h = setInterval(() => {
      void load(true);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(h);
  }, [load]);

  // ── timer tick — 真接成功用 detail.started_minutes_ago, 否则 fallback mock 23:14 起.
  useEffect(() => {
    const baseSec = detail
      ? Math.max(0, detail.started_minutes_ago * 60)
      : 23 * 60 + 14;
    const startMs = Date.now();
    const id = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startMs) / 1000);
      const total = baseSec + elapsed;
      setTimer(
        `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`,
      );
    }, 1000);
    return () => clearInterval(id);
  }, [detail]);

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
    if (hasRealData) {
      // 真接模式: 筛选 backend 真 lines (key = agent_id for ai / speaker_name for user)
      if (selected.size === 0) return realLines.length;
      return realLines.filter((l) =>
        selected.has(
          l.kind === "agent"
            ? l.agent_id || "ai-unknown"
            : l.speaker_name || "user-unknown",
        ),
      ).length;
    }
    // mock 模式: 既有逻辑
    if (selected.size === 0) return MR_MESSAGES.length;
    return MR_MESSAGES.filter((m) => mrMessageMatchesSelected(m, selected)).length;
  }, [selected, hasRealData, realLines]);

  const toggleSpeaker = (k: string) => {
    const n = new Set(selected);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setSelected(n);
  };

  // current meeting title — 优先 backend, fallback mock
  const meetingTitle =
    detail?.title ||
    (meetingId === "q3-roadmap" ? "Q3 路线图对齐" : "会议进行中");

  /** 当前发言 agent 显示名 (banner + 滚动区底部 hint 共用) */
  const activeSpeakerName = activeSpeakerAgentId
    ? detail?.attending_agents.find((a) => a.agent_id === activeSpeakerAgentId)
        ?.nickname ||
      detail?.attending_agents.find((a) => a.agent_id === activeSpeakerAgentId)
        ?.name ||
      null
    : null;

  return (
    // v1.4.0 舞台中央 (PM 拍 2026-05-27): root 改 灰底, 让 center 白色 transcript
    // 区 自然 突出 (灰海中的白岛). TopBar / BottomBar 也 跟 灰底融, 不打断 层次.
    // v1.4.0 § 7.1.1 双 theme: bgChip = light 灰 / dark 紫 tint. Stage (中央白岛) = bgStage.
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: MR_TOKENS.bgChip,
        position: "relative",
        overflow: "hidden",
        fontFamily:
          '-apple-system, "SF Pro Text", "PingFang SC", "Helvetica Neue", Helvetica, "Segoe UI", system-ui, sans-serif',
        color: MR_TOKENS.fgPrimary,
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

      {/* v1.4.0 Phase A · 6: mic 错误 banner — 权限拒 / 不安全上下文 / 设备不可用 等. */}
      {micError ? (
        <div
          style={{
            background: "rgba(255,59,48,0.10)",
            borderBottom: "0.5px solid rgba(255,59,48,0.30)",
            padding: "8px 24px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            color: "#FF3B30",
          }}
          role="alert"
          data-testid="mr-mic-error"
        >
          <span style={{ flex: 1 }}>⚠ {micError}</span>
          <button
            type="button"
            onClick={clearError}
            aria-label="关闭"
            style={{
              background: "none",
              border: "none",
              color: "#FF3B30",
              cursor: "pointer",
              fontSize: 16,
              padding: 0,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      ) : null}

      {/* v1.4.0 Phase A · 6: WS 连接状态 小条 — connecting / reconnecting / giving_up 时显示. */}
      {wsConn !== "idle" && wsConn !== "connected" ? (
        <div
          style={{
            background:
              wsConn === "giving_up" ? "rgba(255,59,48,0.08)" : "rgba(255,159,10,0.08)",
            borderBottom:
              wsConn === "giving_up"
                ? "0.5px solid rgba(255,59,48,0.20)"
                : "0.5px solid rgba(255,159,10,0.20)",
            padding: "4px 24px",
            fontSize: 11.5,
            color: wsConn === "giving_up" ? "#FF3B30" : "#FF9F0A",
            textAlign: "center",
          }}
          data-testid="mr-ws-state"
          data-ws-state={wsConn}
        >
          {wsConn === "connecting" && "连接中…"}
          {wsConn === "reconnecting" && "重连中…"}
          {wsConn === "giving_up" && "连接断开 (重试 失败), 请 刷新 页面"}
        </div>
      ) : null}

      <div
        style={{
          flex: 1,
          display: "flex",
          minHeight: 0,
          background: MR_TOKENS.bgChip,  // v1.4.0 舞台中央: 三栏 wrapper 灰底 (light) / 紫 tint (dark)
        }}
      >
        <MRLeftPanel
          selected={selected}
          onToggleSpeaker={toggleSpeaker}
          onJumpToMessage={jumpToMessage}
        />

        {/* Center · v1.4.0 舞台中央: 白岛 + 顶部 1px 紫色 hairline (PM 拍 2026-05-27).
          * 视觉层次: 灰海背景 (#F2F2F7) → 白岛中央 (#fff) → 紫线锚定 "AI 舞台"
          *   定位. 静态时 已经 突出, active speaker 时 顶部 光带 增强. */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            background: MR_TOKENS.bgStage,  // light: #fff / dark: 深邃星空 渐变
            borderTop: "1px solid rgba(94,92,230,0.35)",  // Mira 紫 hairline (跨 theme 共享)
          }}
        >
          {/* v1.4.0 舞台中央 (PM 拍): active speaker 时 顶部 渐变光带, 强调 "现在 X 正在发言".
            * 静态没人发言 时 不显, 避免 占高 + 信息冗余. */}
          {hasRealData && activeSpeakerName ? (
            <div
              data-testid="mr-stage-active-band"
              style={{
                background:
                  "linear-gradient(180deg, rgba(94,92,230,0.10) 0%, rgba(94,92,230,0.02) 70%, transparent)",
                padding: "8px 24px 6px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                fontWeight: 500,
                color: "#5E5CE6",
                letterSpacing: 0.2,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "#5E5CE6",
                  animation: "mrLivePulse 1.4s ease-in-out infinite",
                  flexShrink: 0,
                }}
              />
              <span>
                AI 圆桌进行中 · <strong style={{ fontWeight: 600 }}>{activeSpeakerName}</strong> 正在发言
              </span>
            </div>
          ) : null}

          {/* Sprint 3 Web W1: orchestrate phase banner (仅 auto 会议 + phase 非 null) */}
          <OrchestrateStatusBanner detail={detail} />
          <MRFilterBanner
            selected={selected}
            onChange={setSelected}
            matched={visibleCount}
            total={hasRealData ? realLines.length : MR_MESSAGES.length}
            onOpen={() => setFilter(true)}
          />
          <div
            ref={scrollRef}
            className="mr-scroll"
            onScroll={handleScroll}
            style={{
              flex: 1,
              overflow: "auto",
              background: "transparent",  // 继承 父 bgStage (light: #fff / dark: 深邃 渐变)
              paddingTop: 12,
              paddingBottom: 12,
              position: "relative",
            }}
          >
            {/* Sprint 3 Web W1: 真接没数据时, 显 "演示数据" pill 反幻觉 (PM § 7.5) */}
            {realDataLoaded && !hasRealData && (
              <div style={{ padding: "10px 28px 0" }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 10px",
                    borderRadius: 6,
                    background: "rgba(94,92,230,0.10)",
                    boxShadow: "inset 0 0 0 0.5px rgba(94,92,230,0.30)",
                    color: "#5E5CE6",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 0.3,
                  }}
                >
                  演示数据 · 这场会议暂无真实转录
                </span>
              </div>
            )}

            {visibleCount === 0 ? (
              <div
                style={{
                  padding: "120px 28px",
                  textAlign: "center",
                  color: MR_TOKENS.fgTertiary,
                }}
              >
                <div style={{ fontSize: 28, opacity: 0.4, marginBottom: 8 }}>
                  ⌕
                </div>
                筛选后无发言
                <br />
                <span style={{ fontSize: 12, color: MR_TOKENS.fgQuaternary }}>
                  试试再勾选一些人
                </span>
              </div>
            ) : hasRealData ? (
              // ── 真接模式: 渲染 backend lines (按 created_at 正序) + active speaker pulse + fade-in ──
              realLines.map((l, i) => {
                const k =
                  l.kind === "agent"
                    ? l.agent_id || "ai-unknown"
                    : l.speaker_name || "user-unknown";
                if (selected.size > 0 && !selected.has(k)) return null;
                return (
                  <div key={`${l.kind}-${l.id}-${i}`} id={`mr-msg-${i}`}>
                    {l.kind === "user" ? (
                      <MRRealHumanLine line={l} />
                    ) : (
                      <MRRealAILine
                        line={l}
                        isActiveSpeaker={
                          !!activeSpeakerAgentId && l.agent_id === activeSpeakerAgentId
                        }
                        onSupersededClick={setSupersededDrawerLine}
                      />
                    )}
                  </div>
                );
              })
            ) : (
              // ── Fallback mock 模式: 既有 R5.D 设计稿 mock (workspace 没真会议 时不空盘) ──
              MR_MESSAGES.map((m, i) => {
                if (!mrMessageMatchesSelected(m, selected)) return null;
                return <MessageRow key={i} idx={i} m={m} selected={selected} />;
              })
            )}

            {/* 真接模式: 显示 "AI 正在发言" hint (取代 mock "王俊 正在说话") */}
            {hasRealData && activeSpeakerName && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 28px 20px",
                  fontSize: 12.5,
                  color: "#5E5CE6",
                  fontWeight: 600,
                  animation: "mrFadeIn 280ms ease-out",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#5E5CE6",
                    animation: "mrLivePulse 1.2s ease-in-out infinite",
                  }}
                />
                <span>{activeSpeakerName} 正在发言</span>
                <MRWaveform active />
              </div>
            )}

            {/* mock 模式 "王俊 正在说话" — 真接模式 不渲染 (避免双 hint 冲突) */}
            {!hasRealData && (selected.size === 0 || selected.has("WJ")) && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 28px 20px",
                  fontSize: 12.5,
                  color: MR_TOKENS.fgTertiary,
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
                  background: MR_TOKENS.bgSurface,
                  border: "none",
                  boxShadow: MR_TOKENS.shadowFab,
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
          <MRInputBar
            onSendText={handleSendText}
            meSpeaker={meSpeaker}
            speakerOptions={speakerOptions}
            canBorrow={canBorrowSpeaker}
          />
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

      {/* v1.4.0 Phase C · 11 NEW-A 完整版: 超 链 drawer + 撤销 */}
      {supersededDrawerLine && (
        <MRSupersededDrawer
          line={supersededDrawerLine}
          allLines={realLines}
          meetingId={meetingId}
          myRole={me?.role}
          onClose={() => setSupersededDrawerLine(null)}
          onRestored={() => {
            // 撤销 成功 → 立刻 重新 拉 transcript (轮询 2.5s 太慢, 用户 等不及)
            void api
              .getWebMeetingTranscript(meetingId)
              .then((d) => setRealLines(d.lines))
              .catch(() => {});
          }}
        />
      )}
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
