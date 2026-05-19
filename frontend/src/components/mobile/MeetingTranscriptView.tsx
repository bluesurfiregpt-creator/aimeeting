"use client";

/**
 * v27.0-mobile · Phase 5B · 会议完整转录视图 + 实时推送.
 *
 * P5A 基础 + 加 WebSocket 实时叠加:
 *   - 进组件挂 WS, listens on transcript_persisted / agent_message_* 事件
 *   - 新真人发言 → append 列表底部
 *   - AI 发言: agent_message_start → 追加空 bubble (streaming=true)
 *             agent_message_chunk → 找该 agent 的最后 streaming bubble 追加文本
 *             agent_message_end → 用 server 给的最终 text 校正 (citations 也带上)
 *   - 议程事件 (off_topic / time_warning / stuck) → 不在转录里渲, 父组件接
 *
 * 重连:
 *   - sttSocket 内置指数 backoff. 重连成功后静默 reload 一次拿可能错过的行.
 *
 * UX:
 *   - 顶部 meta: count + 实时绿点 (WS 连接中) / 灰点 (重连中) + 刷新按钮
 *   - 新行进来时自动滚到底 (只在用户已经在底部时, 避免打断阅读)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { SttEvent } from "@/lib/sttSocket";
import { mApi } from "@/lib/mobile/api";
import {
  useMeetingWsConn,
  useMeetingWsEvent,
  type WsConnState,
} from "@/lib/mobile/meetingWsBus";
import type { MobileTranscriptOut, TranscriptStreamLine } from "@/lib/mobile/types";

const AGENT_COLOR_BG: Record<string, string> = {
  violet: "bg-violet-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  sky: "bg-sky-500",
  rose: "bg-rose-500",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  indigo: "bg-indigo-500",
};

function agentColorBg(c: string | null): string {
  if (!c) return "bg-zinc-700";
  return AGENT_COLOR_BG[c] || "bg-zinc-700";
}

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

/** 内部行表征: 比 server 的 TranscriptStreamLine 多了 streaming + key 字段
 *  - streaming=true 时此 AI bubble 还在流式接收 (字一边接一边追加).
 *  - key 用 `${kind}-${id}` (server side id 唯一) — agent live 时用 `agent-live-${agent_id}` 临时 id.
 */
type LocalLine = TranscriptStreamLine & {
  key: string;
  streaming?: boolean;
};

export default function MeetingTranscriptView({
  meetingId,
}: {
  meetingId: string;
}) {
  const [lines, setLines] = useState<LocalLine[]>([]);
  const [meta, setMeta] = useState<Pick<MobileTranscriptOut, "total_user_lines" | "total_agent_lines"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const conn = useMeetingWsConn();

  const listRef = useRef<HTMLOListElement | null>(null);
  const autoScrollRef = useRef(true);  // 用户是否在列表底 (true=自动滚, false=用户上滑阅读历史)

  // 静态拉一次 (full snapshot)
  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      try {
        const d = await mApi.getMeetingTranscript(meetingId);
        const ll: LocalLine[] = d.lines.map((l) => ({
          ...l,
          key: `${l.kind}-${l.id}`,
        }));
        setLines(ll);
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

  // 重连成功后静默 reload 一次, 拿可能错过的行
  const prevConnRef = useRef<typeof conn>(conn);
  useEffect(() => {
    if (prevConnRef.current === "reconnecting" && conn === "connected") {
      void load(false);
    }
    prevConnRef.current = conn;
  }, [conn, load]);

  // WS 事件处理 — 订阅总线 (provider 在 page 级别开)
  const handleEvent = useCallback(
    (e: SttEvent) => {
      switch (e.type) {
        case "transcript_persisted": {
          // 服务器现在带 text + speaker_name. 直接 append.
          if (!e.text) break; // 没 text 就跳 (legacy / 老 server)
          const at_min = e.start_ms !== null && e.start_ms !== undefined
            ? Math.max(0, Math.floor(e.start_ms / 60000))
            : 0;
          setLines((prev) => {
            // 去重: 若已存在 (例如 reload 后又来一次), 跳
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
          // 追加一个 streaming 空 bubble — 临时 key (server id 还没生成)
          const at_min = 0; // 起点, 累积期间不准确, end 时也不更, 接受小偏差
          setLines((prev) => [
            ...prev,
            {
              key: `agent-live-${e.agent_id}-${Date.now()}`,
              kind: "agent",
              id: 0,                          // 临时, end 时不替换 (没真 id)
              text: "",
              at_minute: at_min,
              created_at: new Date().toISOString(),
              speaker_name: null,
              speaker_status: null,
              agent_id: e.agent_id,
              agent_name: e.agent_name,
              agent_nickname: e.agent_nickname ?? null,
              agent_color: e.agent_color,
              trigger: "manual",  // 默认; end 时不改
              citations_count: 0,
              streaming: true,
            },
          ]);
          break;
        }
        case "agent_message_chunk": {
          // 找最后一个该 agent 的 streaming bubble, 追加 chunk
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
          // 用 server 最终 text 校正 (chunk 累积可能有未刷出的尾巴), 标 streaming=false.
          // citations_count 用 e.citations?.length 给.
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
          // 其他事件 (agenda_*, dissent_*, speakers_updated 等) 不在这里处理
          break;
      }
    },
    [],
  );

  // 订阅总线
  useMeetingWsEvent(handleEvent);

  // 自动滚到底 (仅当用户已经在底)
  useEffect(() => {
    if (!autoScrollRef.current) return;
    const el = listRef.current;
    if (!el) return;
    // delay 一帧让 DOM 更新
    requestAnimationFrame(() => {
      el.scrollIntoView({ block: "end", behavior: "smooth" });
    });
  }, [lines.length]);

  // 监听用户滚动 — 若离底 > 80px 视为"上滑阅读历史", 暂停自动滚
  const onScroll = useCallback(() => {
    const el = listRef.current?.parentElement;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    autoScrollRef.current = distFromBottom < 80;
  }, []);

  if (loading && lines.length === 0) {
    return (
      <div className="space-y-2 p-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-ink-900" />
        ))}
      </div>
    );
  }

  if (error && lines.length === 0) {
    return (
      <div className="p-4 text-center">
        <p className="text-[14px] text-rose-300">{error}</p>
        <button
          type="button"
          onClick={() => load(true)}
          className="mt-2 inline-flex h-10 items-center justify-center rounded-lg border border-zinc-700 px-4 text-[14px] text-zinc-200"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 pt-3 pb-4" onScroll={onScroll}>
      {/* meta 行 */}
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[13px] text-zinc-400">
          <ConnDot state={conn} />
          共 <span className="font-medium text-zinc-200 tabular-nums">{meta?.total_user_lines ?? 0}</span> 句真人 ·{" "}
          <span className="font-medium text-zinc-200 tabular-nums">{meta?.total_agent_lines ?? 0}</span> 条 AI
        </p>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={refreshing}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-zinc-700 px-3 text-[13px] font-medium text-zinc-200 active:scale-[0.97] active:bg-ink-800 disabled:opacity-60"
        >
          {refreshing ? "刷新中…" : "↻ 刷新"}
        </button>
      </div>

      {/* 主列表 */}
      {lines.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-[14px] text-zinc-500">
          这场会议还没有任何发言
        </p>
      ) : (
        <ol
          ref={listRef}
          className="space-y-2.5"
          data-testid="mobile-transcript-list"
        >
          {lines.map((l) => (
            <li key={l.key}>
              {l.kind === "user" ? <UserLine line={l} /> : <AgentLine line={l} />}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ===== 连接状态点 =========================================================

function ConnDot({ state }: { state: WsConnState }) {
  if (state === "connected") {
    return (
      <span
        className="inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse"
        title="实时已连接"
        aria-label="实时已连接"
      />
    );
  }
  if (state === "reconnecting") {
    return (
      <span
        className="inline-flex h-2 w-2 rounded-full bg-amber-400 animate-pulse"
        title="重连中…"
        aria-label="重连中"
      />
    );
  }
  if (state === "giving_up") {
    return (
      <span
        className="inline-flex h-2 w-2 rounded-full bg-rose-500"
        title="连接断开, 请刷新"
        aria-label="连接断开"
      />
    );
  }
  if (state === "idle") {
    return (
      <span
        className="inline-flex h-2 w-2 rounded-full bg-zinc-700"
        title="未连接"
      />
    );
  }
  return (
    <span
      className="inline-flex h-2 w-2 rounded-full bg-zinc-500"
      title="连接中…"
    />
  );
}

// ===== 真人 + AI 行 =======================================================

function UserLine({ line }: { line: LocalLine }) {
  return (
    <div
      className="flex items-baseline gap-2.5 rounded-lg bg-ink-900/40 px-3 py-2.5"
      data-testid="transcript-user-line"
    >
      <span className="shrink-0 text-[13px] tabular-nums text-zinc-500">
        {fmtMinute(line.at_minute)}
      </span>
      {line.speaker_name ? (
        <span className="shrink-0 text-[14px] font-medium text-zinc-300">
          {line.speaker_name}
        </span>
      ) : (
        <span className="shrink-0 text-[14px] text-zinc-500">未识别</span>
      )}
      <p className="min-w-0 flex-1 text-[15px] leading-snug text-zinc-100 whitespace-pre-wrap">
        {line.text}
      </p>
    </div>
  );
}

function AgentLine({ line }: { line: LocalLine }) {
  const display = line.agent_nickname?.trim() || line.agent_name || "AI";
  const triggerLabel = line.trigger ? TRIGGER_LABEL[line.trigger] : null;
  return (
    <div
      className="rounded-lg border border-violet-500/25 bg-violet-500/[0.05] p-3"
      data-testid="transcript-agent-line"
    >
      <header className="flex items-center gap-2">
        <span
          className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-medium text-white ${agentColorBg(line.agent_color)}`}
        >
          ◆
        </span>
        <span className="min-w-0 truncate text-[14px] font-medium text-zinc-100">
          {display}
        </span>
        {triggerLabel ? (
          <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[12px] text-zinc-400">
            {triggerLabel}
          </span>
        ) : null}
        {line.streaming ? (
          <span className="shrink-0 rounded bg-violet-500/20 px-1.5 py-0.5 text-[12px] text-violet-200">
            正在打字…
          </span>
        ) : null}
        <span className="ml-auto shrink-0 text-[13px] tabular-nums text-zinc-500">
          {fmtMinute(line.at_minute)}
        </span>
      </header>
      <p className="mt-2 text-[15px] leading-relaxed text-zinc-100 whitespace-pre-wrap">
        {line.text}
        {line.streaming ? (
          <span className="ml-0.5 inline-block h-[15px] w-[2px] animate-pulse bg-violet-300 align-middle" />
        ) : null}
      </p>
      {line.citations_count > 0 ? (
        <p className="mt-2 text-[12px] text-zinc-500">
          📎 引用 {line.citations_count} 条 KB
        </p>
      ) : null}
    </div>
  );
}
