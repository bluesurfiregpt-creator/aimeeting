"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · 浅色 transcript view.
 *
 * 设计源 1:1: meeting-room.jsx:551-700 (HumanMessage + AIMessage).
 *
 * 重写浅色版:
 *   - UserLine  → HumanMessage (头像 32px 个人色 + waveform + @mention 紫高亮)
 *   - AgentLine → AIMessage (头像 26px 渐变方形 + 左 3px accent bar + data 块)
 *
 * R9 — host card + mock round 也走 transcript view 渲染:
 *   - props 新增 `hostCards` (TimelineHostItem[]) + `roundMessages` (mock round[])
 *   - 内部 merge 渲染: user/agent lines + host cards + round messages
 *
 * WS 数据流 / IntersectionObserver autoscroll / streaming AI 保持不变.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { SttEvent } from "@/lib/sttSocket";
import { mApi } from "@/lib/mobile/api";
import {
  useMeetingWsConn,
  useMeetingWsEvent,
  type WsConnState,
} from "@/lib/mobile/meetingWsBus";
import type { MobileTranscriptOut, TranscriptStreamLine } from "@/lib/mobile/types";

import { Dots, Waveform, DemoBadge } from "./meeting-room/atoms";
import {
  MOCK_AIS,
  MOCK_HUMANS,
  MRAIAvatar,
  MRHumanAvatar,
  gradientForAgentColor,
  type MockAiId,
  type MockHumanId,
} from "./shared/avatars";
import MRIcon from "./shared/Icon";
import { MR_COLORS } from "./meeting-room/styles";
import ChapterDivider from "./meeting-room/ChapterDivider";
import RoundMessage from "./meeting-room/RoundMessage";
import type { MockRoundMessage } from "./meeting-room/mock/roundtable";

/** 内部行表征 — 带 streaming + key. */
type LocalLine = TranscriptStreamLine & {
  key: string;
  streaming?: boolean;
};

/** 父级推下来的 host card 数据 (banner / chapter / strong-banner 等都走这个). */
export type TimelineHostItem =
  | {
      kind: "host";
      key: string;
      /** 排序锚点 (分钟) */
      at_minute: number;
      tone: "drift-soft" | "drift" | "drift-strong" | "timer" | "route";
      title?: string;
      body?: string;
      t?: string;
      countdown?: string | null;
      agentName: string;
      agentColor?: string | null;
      /** Render bridge — 父级提供原生 banner 组件 */
      render: () => ReactElement;
    }
  | {
      kind: "chapter";
      key: string;
      at_minute: number;
      newAgendaNumber: number;
      totalAgenda: number;
      newAgendaTitle: string;
      agendaMinutes: number | null;
      t: string;
    };

/** 筛选: speaker key. */
export type FilterSpeakerKey = string;

/** 由父级控制的筛选状态. selected.size === 0 = 不筛. */
export type FilterState = {
  selected: Set<FilterSpeakerKey>;
};

const TRIGGER_LABEL: Record<string, string> = {
  manual: "召唤",
  auto_orchestrator: "自动",
  keyword: "关键词",
  at_mention: "@",
};

function fmtMinute(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `${h}h${rem ? rem + "m" : ""}`;
}

/** speaker key — 真实 user line 用 speaker_name (或 fallback 'user-unknown') */
function speakerKeyOfLine(l: LocalLine): string {
  if (l.kind === "agent") return l.agent_id || "ai-unknown";
  return l.speaker_name || "user-unknown";
}

type Props = {
  meetingId: string;
  /** 父级注入的 host cards + chapters (按 at_minute 排) */
  hostCards?: TimelineHostItem[];
  /** mock round messages (TD2 — 永久 1 张, 永远在末尾) */
  roundMessages?: MockRoundMessage[];
  /** 筛选 (selected set; size=0 = 不筛) */
  filter?: FilterState;
  /** 父级总匹配数回调 — 用于 FilterBanner 显 X/Y */
  onMatchedCountChange?: (matched: number, total: number) => void;
  /** 暴露 jumpTo 给父级 — 父级章节 sheet 用 */
  onRegisterJump?: (jumpTo: (key: string) => void) => void;
  /** 滚动到底时回调 (用于 FAB 隐藏) */
  onScrollPosChange?: (isAtBottom: boolean) => void;
  /** v1.4.0 Saga E.E (Sprint 2-3): 2.5s 轮询 transcript (auto 会议 用,
   *  orchestrator 写 agent_message 不走 WS 推送, 必须 主动 拉).
   *  hybrid 会议 走 WS, 这里传 0 / undefined → 不轮询 (省网). */
  pollIntervalMs?: number;
  /** v1.4.0 Saga E.E: 当前 orchestrator 发言 agent_id (running 时高亮 pulse).
   *  null = 没人在发言 / 不是 auto 会议. */
  activeSpeakerAgentId?: string | null;
};

export default function MeetingTranscriptView({
  meetingId,
  hostCards = [],
  roundMessages = [],
  filter,
  onMatchedCountChange,
  onRegisterJump,
  onScrollPosChange,
  pollIntervalMs = 0,
  activeSpeakerAgentId = null,
}: Props): ReactElement {
  const [lines, setLines] = useState<LocalLine[]>([]);
  const [meta, setMeta] = useState<Pick<MobileTranscriptOut, "total_user_lines" | "total_agent_lines"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const conn = useMeetingWsConn();

  const listRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);

  // 静态拉 — v1.4.0 Saga E.E: 改为 "merge" 语义 (而非 replace).
  // 保留 streaming=true 的 临时 line (WS 正在跑的) 不被 backend 拉的 final 覆盖.
  // 同 key 已存在则跳过 (后端 line 是 final, 不更新文本); 不存在则 append.
  // (lines 顺序: 后端按 created_at 正序 + 任何 streaming live line 在末尾, sort 由
  // 渲染层 merged.sortAt 处理.)
  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      try {
        const d = await mApi.getMeetingTranscript(meetingId);
        const incomingByKey = new Map<string, LocalLine>();
        for (const l of d.lines) {
          incomingByKey.set(`${l.kind}-${l.id}`, { ...l, key: `${l.kind}-${l.id}` });
        }
        setLines((prev) => {
          // 1) 留下 streaming live agent line (key 以 'agent-live-' 起, WS 临时)
          const liveStreaming = prev.filter(
            (p) => p.streaming && p.key.startsWith("agent-live-"),
          );
          // 2) 把后端拉的 final lines (按 created_at 正序) 跟 liveStreaming 拼一起.
          //    顺序: backend final (含 user / 已落盘 agent) → streaming live.
          //    用户 visual: 看到 已 写入的 final → 末尾 还在 streaming 的 typing 行.
          return [...incomingByKey.values(), ...liveStreaming];
        });
        setMeta({
          total_user_lines: d.total_user_lines,
          total_agent_lines: d.total_agent_lines,
        });
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (isRefresh) setRefreshing(false);
        setLoading(false);
      }
    },
    [meetingId],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  // v1.4.0 Saga E.E (Sprint 2-3): 2.5s 轮询 transcript — auto 会议 用.
  // PM 决策 Q2 = WS 不上, 用 setInterval 拉 /m/meetings/{id}/transcript.
  // hybrid 会议 走 WS, pollIntervalMs=0 → 不启动 interval.
  useEffect(() => {
    if (!pollIntervalMs || pollIntervalMs <= 0) return;
    const h = setInterval(() => {
      void load(false);
    }, pollIntervalMs);
    return () => clearInterval(h);
  }, [load, pollIntervalMs]);

  const prevConnRef = useRef<typeof conn>(conn);
  useEffect(() => {
    if (prevConnRef.current === "reconnecting" && conn === "connected") {
      void load(false);
    }
    prevConnRef.current = conn;
  }, [conn, load]);

  // WS 事件
  const handleEvent = useCallback((e: SttEvent) => {
    switch (e.type) {
      case "transcript_persisted": {
        if (!e.text) break;
        const at_min =
          e.start_ms !== null && e.start_ms !== undefined
            ? Math.max(0, Math.floor(e.start_ms / 60000))
            : 0;
        setLines((prev) => {
          const key = `user-${e.line_id}`;
          if (prev.some((l) => l.key === key)) return prev;
          return [
            ...prev,
            {
              key,
              kind: "user",
              id: e.line_id,
              text: e.text!,
              at_minute: at_min,
              created_at: new Date().toISOString(),
              speaker_name: e.speaker_name ?? null,
              speaker_status: e.speaker_status ?? null,
              agent_id: null,
              agent_name: null,
              agent_nickname: null,
              agent_color: null,
              trigger: null,
              citations_count: 0,
            },
          ];
        });
        setMeta((m) =>
          m ? { ...m, total_user_lines: m.total_user_lines + 1 } : m,
        );
        break;
      }
      case "agent_message_start": {
        setLines((prev) => [
          ...prev,
          {
            key: `agent-live-${e.agent_id}-${Date.now()}`,
            kind: "agent",
            id: 0,
            text: "",
            at_minute: 0,
            created_at: new Date().toISOString(),
            speaker_name: null,
            speaker_status: null,
            agent_id: e.agent_id,
            agent_name: e.agent_name,
            agent_nickname: e.agent_nickname ?? null,
            agent_color: e.agent_color,
            trigger: "manual",
            citations_count: 0,
            streaming: true,
          },
        ]);
        break;
      }
      case "agent_message_chunk": {
        setLines((prev) => {
          for (let i = prev.length - 1; i >= 0; i--) {
            const l = prev[i];
            if (
              l.kind === "agent" &&
              l.streaming &&
              l.agent_id === e.agent_id
            ) {
              const next = [...prev];
              next[i] = { ...l, text: l.text + e.chunk };
              return next;
            }
          }
          return prev;
        });
        break;
      }
      case "agent_message_end": {
        setLines((prev) => {
          for (let i = prev.length - 1; i >= 0; i--) {
            const l = prev[i];
            if (
              l.kind === "agent" &&
              l.streaming &&
              l.agent_id === e.agent_id
            ) {
              const next = [...prev];
              next[i] = {
                ...l,
                text: e.text,
                streaming: false,
                citations_count: e.citations?.length ?? 0,
              };
              return next;
            }
          }
          return prev;
        });
        setMeta((m) =>
          m ? { ...m, total_agent_lines: m.total_agent_lines + 1 } : m,
        );
        break;
      }
      default:
        break;
    }
  }, []);

  useMeetingWsEvent(handleEvent);

  // IntersectionObserver: 跟踪 bottom anchor 可见性 (autoScroll on/off + FAB 隐显)
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const anchor = bottomAnchorRef.current;
    if (!anchor) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          autoScrollRef.current = entry.isIntersecting;
          onScrollPosChange?.(entry.isIntersecting);
        }
      },
      { threshold: 0.1 },
    );
    io.observe(anchor);
    return () => io.disconnect();
  }, [onScrollPosChange]);

  useEffect(() => {
    if (!autoScrollRef.current) return;
    const anchor = bottomAnchorRef.current;
    if (!anchor) return;
    requestAnimationFrame(() => {
      anchor.scrollIntoView({ block: "end", behavior: "smooth" });
    });
  }, [lines.length, hostCards.length]);

  // 构建合并 timeline (lines + hostCards + roundMessages)
  type TimelineEntry =
    | { kind: "line"; line: LocalLine; sortAt: number }
    | { kind: "host"; item: TimelineHostItem; sortAt: number }
    | { kind: "round"; round: MockRoundMessage; sortAt: number };

  const merged: TimelineEntry[] = [];
  lines.forEach((l, i) => {
    // 用 at_minute * 1000 + i 保证同 minute 内按到达顺序排
    merged.push({
      kind: "line",
      line: l,
      sortAt: l.at_minute * 1000 + i,
    });
  });
  hostCards.forEach((h, i) => {
    merged.push({
      kind: "host",
      item: h,
      sortAt: h.at_minute * 1000 + 500 + i, // host card 排到同分钟末
    });
  });
  roundMessages.forEach((r, i) => {
    merged.push({
      kind: "round",
      round: r,
      sortAt: r.at_minute_anchor * 1000 + 900 + i,
    });
  });
  merged.sort((a, b) => a.sortAt - b.sortAt);

  // 筛选 (基于父级 filter)
  const passesFilter = (entry: TimelineEntry): boolean => {
    if (!filter || filter.selected.size === 0) return true;
    const sel = filter.selected;
    if (entry.kind === "line") {
      const k = speakerKeyOfLine(entry.line);
      return sel.has(k);
    }
    if (entry.kind === "host") {
      return sel.has("host");
    }
    // round: 显示当 host 或任一 expert 被选中
    const r = entry.round;
    const keys = ["host", ...r.experts.map((e) => `mock-${e.who}`)];
    return keys.some((k) => sel.has(k));
  };
  const visible = merged.filter(passesFilter);

  // 通知父级 matched 数
  useEffect(() => {
    if (!onMatchedCountChange) return;
    onMatchedCountChange(visible.length, merged.length);
  }, [visible.length, merged.length, onMatchedCountChange]);

  // jumpTo
  useEffect(() => {
    if (!onRegisterJump) return;
    const jump = (key: string) => {
      const target = document.querySelector<HTMLElement>(
        `[data-mr-key="${CSS.escape(key)}"]`,
      );
      if (!target) return;
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      target.style.transition = "background 200ms ease";
      target.style.background = "rgba(0,122,255,0.10)";
      setTimeout(() => {
        target.style.background = "transparent";
      }, 1100);
    };
    onRegisterJump(jump);
  }, [onRegisterJump]);

  if (loading && lines.length === 0) {
    return (
      <div style={{ padding: 16 }}>
        <div
          style={{
            height: 16,
            background: MR_COLORS.bgWhite,
            borderRadius: 8,
            marginBottom: 8,
            opacity: 0.6,
          }}
        />
        <div
          style={{
            height: 64,
            background: MR_COLORS.bgWhite,
            borderRadius: 12,
            marginBottom: 8,
            opacity: 0.6,
          }}
        />
        <div
          style={{
            height: 80,
            background: MR_COLORS.bgWhite,
            borderRadius: 12,
            opacity: 0.6,
          }}
        />
      </div>
    );
  }

  if (error && lines.length === 0) {
    return (
      <div style={{ padding: 16, textAlign: "center" }}>
        <p style={{ fontSize: 14, color: MR_COLORS.systemRed }}>{error}</p>
        <button
          type="button"
          onClick={() => load(true)}
          style={{
            marginTop: 8,
            height: 36,
            padding: "0 16px",
            borderRadius: 8,
            border: `0.5px solid ${MR_COLORS.hairlineStrong}`,
            background: MR_COLORS.bgWhite,
            color: MR_COLORS.textPrimary,
            fontSize: 14,
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      data-testid="mobile-transcript-list"
      style={{ padding: "4px 0 8px" }}
    >
      {meta && lines.length > 0 ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 16px 8px",
            fontSize: 11,
            color: MR_COLORS.textTertiary,
          }}
        >
          <ConnDot state={conn} />
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {meta.total_user_lines} 句真人 · {meta.total_agent_lines} 条 AI
          </span>
          {refreshing ? <span>· 刷新中…</span> : null}
        </div>
      ) : null}

      {visible.length === 0 && lines.length > 0 ? (
        <div
          style={{
            padding: "60px 32px",
            textAlign: "center",
            color: MR_COLORS.textTertiary,
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          筛选后无发言
          <br />
          <span style={{ fontSize: 12, color: MR_COLORS.textQuaternary }}>
            试试再勾选一些人
          </span>
        </div>
      ) : visible.length === 0 ? (
        <p
          style={{
            marginTop: 32,
            textAlign: "center",
            fontSize: 14,
            color: MR_COLORS.textTertiary,
          }}
        >
          这场会议还没有任何发言
        </p>
      ) : (
        visible.map((entry, idx) => {
          if (entry.kind === "line") {
            const l = entry.line;
            return (
              <div
                key={l.key}
                data-mr-key={l.key}
                data-testid={
                  l.kind === "user"
                    ? "transcript-user-line"
                    : "transcript-agent-line"
                }
              >
                {l.kind === "user" ? (
                  <HumanMessage line={l} />
                ) : (
                  <AIMessage
                    line={l}
                    isActiveSpeaker={
                      !!activeSpeakerAgentId &&
                      l.agent_id === activeSpeakerAgentId
                    }
                  />
                )}
              </div>
            );
          }
          if (entry.kind === "host") {
            const h = entry.item;
            return (
              <div key={h.key} data-mr-key={h.key}>
                {h.kind === "chapter" ? (
                  <ChapterDivider
                    data={{
                      newAgendaNumber: h.newAgendaNumber,
                      totalAgenda: h.totalAgenda,
                      newAgendaTitle: h.newAgendaTitle,
                      agendaMinutes: h.agendaMinutes,
                      t: h.t,
                    }}
                  />
                ) : (
                  h.render()
                )}
              </div>
            );
          }
          // round
          const r = entry.round;
          return (
            <div key={r.key} data-mr-key={r.key}>
              <RoundMessage round={r} />
            </div>
          );
        })
      )}

      <div ref={bottomAnchorRef} style={{ height: 1 }} aria-hidden="true" />
    </div>
  );
}

// ─────── Conn dot ───────

function ConnDot({ state }: { state: WsConnState }) {
  const c =
    state === "connected"
      ? MR_COLORS.systemGreen
      : state === "reconnecting"
        ? MR_COLORS.systemAmber
        : state === "giving_up"
          ? MR_COLORS.systemRed
          : MR_COLORS.textTertiary;
  return (
    <span
      style={{
        display: "inline-flex",
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: c,
        animation:
          state === "connected" || state === "reconnecting"
            ? "mr-livePulse 1.4s ease-in-out infinite"
            : "none",
      }}
      title={
        state === "connected"
          ? "实时已连接"
          : state === "reconnecting"
            ? "重连中"
            : state === "giving_up"
              ? "连接断开"
              : "未连接"
      }
    />
  );
}

// ─────── Human / AI message renderers ───────

function HumanMessage({ line }: { line: LocalLine }) {
  // 真实 backend 不给个人色 — 用名字 hash 到固定调色板
  const name = line.speaker_name || "未识别";
  const color = humanColorForName(name);
  // 这里没 speaking 标记 (老 backend 不传) — 默认 false
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        padding: "8px 16px",
      }}
    >
      <MRHumanAvatar name={name} color={color} size={32} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 3,
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: MR_COLORS.textPrimary,
            }}
          >
            {name}
          </span>
          <span style={{ fontSize: 11, color: MR_COLORS.textTertiary }}>
            {fmtMinute(line.at_minute)}
          </span>
          {line.streaming ? <Waveform active /> : null}
        </div>
        <div
          style={{
            fontSize: 15,
            lineHeight: 1.45,
            color: MR_COLORS.textPrimary,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {renderTextWithMentions(line.text)}
        </div>
      </div>
    </div>
  );
}

function AIMessage({
  line,
  isActiveSpeaker = false,
}: {
  line: LocalLine;
  /** v1.4.0 Saga E.E: orchestrator 标记 此 agent 正在发言 → border pulse 紫 + 'AI 思考中' 提示. */
  isActiveSpeaker?: boolean;
}) {
  const display = line.agent_nickname?.trim() || line.agent_name || "AI";
  const role = line.trigger ? TRIGGER_LABEL[line.trigger] || line.trigger : "";
  const grad = gradientForAgentColor(line.agent_color);
  // 渐入动画 — 新 message append 时, 第一次 mount 触发 opacity 0 → 1 + translateY.
  // 用 mount key 简单实现, 不需要 dedicated state. CSS keyframe 'mr-aiMsgSlideIn' (注入在 styles).
  return (
    <div
      style={{
        padding: "8px 16px",
        animation: "mr-aiMsgSlideIn 280ms ease-out",
      }}
    >
      <div
        style={{
          background: MR_COLORS.bgWhite,
          borderRadius: 14,
          boxShadow: isActiveSpeaker
            ? "0 0 0 2px rgba(94,92,230,0.30), 0 1px 2px rgba(0,0,0,0.04)"
            : "0 1px 2px rgba(0,0,0,0.04)",
          border: isActiveSpeaker
            ? `0.5px solid ${MR_COLORS.systemPurple}`
            : `0.5px solid ${MR_COLORS.hairline}`,
          overflow: "hidden",
          position: "relative",
          transition: "box-shadow 200ms ease, border-color 200ms ease",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: `linear-gradient(180deg, ${grad[0]}, ${grad[1]})`,
          }}
        />
        <div style={{ padding: "11px 13px 12px 14px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div
              style={{
                position: "relative",
                display: "inline-flex",
                borderRadius: 6,
                animation: isActiveSpeaker
                  ? "mr-aiSpeakingRing 1.4s ease-in-out infinite"
                  : "none",
              }}
            >
              <MRAIAvatar agentColor={line.agent_color} size={26} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 5,
                }}
              >
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: MR_COLORS.textPrimary,
                  }}
                >
                  {display}
                </span>
                {role ? (
                  <span
                    style={{
                      fontSize: 11,
                      color: MR_COLORS.textTertiary,
                    }}
                  >
                    {role}
                  </span>
                ) : null}
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 11,
                    color: MR_COLORS.textTertiary,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {fmtMinute(line.at_minute)}
                </span>
              </div>
              {line.streaming ? (
                <div
                  style={{
                    fontSize: 10,
                    color: MR_COLORS.systemPurple,
                    marginTop: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <MRIcon name="sparkle" size={9} color={MR_COLORS.systemPurple} />
                  正在打字 <Dots />
                </div>
              ) : null}
            </div>
          </div>

          <div
            style={{
              marginTop: 9,
              fontSize: 14,
              lineHeight: 1.5,
              color: MR_COLORS.textPrimary,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {line.text}
            {line.streaming ? (
              <span
                style={{
                  marginLeft: 1,
                  display: "inline-block",
                  height: 15,
                  width: 2,
                  background: MR_COLORS.systemPurple,
                  verticalAlign: "middle",
                  animation: "mr-livePulse 0.9s ease-in-out infinite",
                }}
              />
            ) : null}
          </div>

          {line.citations_count > 0 ? (
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                color: MR_COLORS.textTertiary,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <MRIcon name="note" size={11} color={MR_COLORS.textTertiary} />
              引用 {line.citations_count} 条 KB
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function renderTextWithMentions(text: string): ReactElement {
  // 高亮 @Name / @主持人
  const parts = text.split(/(@\S+)/);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("@")) {
          return (
            <span
              key={i}
              style={{
                color: MR_COLORS.systemPurple,
                fontWeight: 500,
              }}
            >
              {p}
            </span>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

// 名字 → 调色板 (deterministic, 用 char code sum mod) ——
// backend 没给 speaker_color, 这里给个浅色一致的 fallback.
const PERSONAL_COLORS = [
  "#FF9F0A",
  "#34C759",
  "#5E5CE6",
  "#FF375F",
  "#30B0C7",
  "#FF6482",
  "#5856D6",
  "#AF52DE",
];
function humanColorForName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) & 0x7fffffff;
  }
  return PERSONAL_COLORS[h % PERSONAL_COLORS.length];
}

// Re-export 给 page.tsx
export { MOCK_AIS, MOCK_HUMANS };
export type { MockAiId, MockHumanId };
