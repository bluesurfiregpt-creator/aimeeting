export type TranscriptEvent = {
  type: "transcript";
  text: string;
  is_final: boolean;
  start_ts?: number | null;
  end_ts?: number | null;
};

export type SystemEvent = {
  type: "system";
  msg: string;
};

export type SpeakersUpdatedEvent = {
  type: "speakers_updated";
};

export type TranscriptPersistedEvent = {
  type: "transcript_persisted";
  line_id: number;
  start_ms: number | null;
  end_ms: number | null;
  // v27.0-mobile P5B: 加 text + speaker_name + speaker_status, 让 viewer (mobile)
  // 不靠 interim 上下文也能直接 append 实时行. 桌面端旧逻辑忽略这些字段.
  text?: string;
  speaker_name?: string | null;
  speaker_status?: string | null;
};

export type AgentMessageStartEvent = {
  type: "agent_message_start";
  agent_id: string;
  agent_name: string;
  /** v26.12-Home: 拟人 外号 (可空). 前端 bubble: nickname 主 + name 副 (有的话) */
  agent_nickname?: string | null;
  agent_color: string;
};

export type AgentMessageChunkEvent = {
  type: "agent_message_chunk";
  agent_id: string;
  chunk: string;
};

export type AgentMessageEndEvent = {
  type: "agent_message_end";
  agent_id: string;
  text: string;
  // v24.3 #1: RAG 命中的 KB chunks(可选 / 可空数组)
  citations?: {
    chunk_id: string;
    document_id: string;
    document_filename: string;
    chunk_index: number;
    snippet: string;
    distance: number;
  }[];
};

export type AgentRecommendationEvent = {
  type: "agent_recommendation";
  agent_id: string;
  agent_name: string;
  /** v26.12-Home: 拟人外号 (可空), 前端 banner 优先 显 nickname */
  agent_nickname?: string | null;
  agent_color: string;
  reason: string;
};

export type DissentDetectedEvent = {
  type: "dissent_detected";
  topic: string;
  parties: string[];
  suggested_agent_id: string;
  suggested_agent_name: string;
  /** v26.12-Home: 拟人外号 (可空) */
  suggested_agent_nickname?: string | null;
  suggested_agent_color: string;
  reason: string;
};

/** M3.0: discussion has drifted from the current agenda item.
 *  v26.14-P4.2: 加 off_topic_severity 三档 — 前端 P4.3 据此 渲 不同 强度.
 *    - "suspected": 轻度怀疑 (3-4 句 弱关联), 角落 提示, 不打断
 *    - "confirmed": 确认偏离 (5+ 句 不沾边), banner 显眼 + 可关
 *    - "severe":   严重偏题 (8+ 句 + 占议程 50%+), 全屏 modal + auto_summon 倒计时
 *  老 后端 不带 severity 时 视为 "confirmed" 兼容. */
export type AgendaOffTopicEvent = {
  type: "agenda_off_topic";
  off_topic_severity?: "suspected" | "confirmed" | "severe";
  off_topic_summary: string;
  current_agenda_item: string | null;
  suggested_agenda_item: string | null;
  moderator_agent_id: string;
  moderator_agent_name: string;
  /** v26.12-Home: 主持人 AI 拟人外号 (可空) */
  moderator_agent_nickname?: string | null;
  moderator_agent_color: string;
  reason: string;
  /** v26.14-P4.2: severe 时 LLM 给 倒计时, 不操作 自动 召唤 主持人. */
  auto_summon_after_s?: number | null;
};

/** M3.0: current agenda item's time budget is ≥ 80% spent. */
export type AgendaTimeWarningEvent = {
  type: "agenda_time_warning";
  time_warning_text: string;
  elapsed_min: number;
  moderator_agent_id: string;
  moderator_agent_name: string;
  moderator_agent_nickname?: string | null;  // v26.12-Home
  moderator_agent_color: string;
  reason: string;
};

/** M3.0.4: discussion is going in circles — repeat positions, no new info.
 *  Stronger signal than off_topic. Frontend renders this with a visible
 *  countdown; if the user does nothing within `auto_summon_after_s`
 *  seconds the moderator is summoned automatically. */
export type AgendaStuckEvent = {
  type: "agenda_stuck";
  stuck_summary: string;
  auto_summon_after_s: number;
  moderator_agent_id: string;
  moderator_agent_name: string;
  moderator_agent_nickname?: string | null;  // v26.12-Home
  moderator_agent_color: string;
  reason: string;
};

/** v26.11-fix2: 房间 广播 — 有人 邀请 了 新 AI 加入 本场会议.
 *  前端 收到 后 重新 拉一次 meeting + agents, AI 画廊 立刻 出现 新头像.
 *  跨 客户端 同步 — 自己 邀请 也会 收到 (state 一致). */
export type AgentsInvitedEvent = {
  type: "agents_invited";
  agent_ids: string[];                 // 本次 真正 新增 的 (idempotent 已 去重)
  attendee_agent_ids: string[];        // meeting 的 完整 邀请 列表 (含 本次 新增 + 旧)
};

/** v26.14-P5.1: 议程 推进 (or 跳转) — 全 房间 同步 进度.
 *  jump 也走 此 event (前端 不需 区分 — 都是 "进度 变了, 去刷"). */
export type AgendaAdvancedEvent = {
  type: "agenda_advanced";
  from_idx: number;
  to_idx: number;
  is_complete: boolean;     // 议程 全部 走完 (to_idx >= len(agenda))
  advanced_by_user_id: string;
  advanced_by_user_name: string;
};

/** v26.14-P5.3: LLM 判 当前 项 似乎 已 收口 / 总结 — 建议 推进 下一项.
 *  跟 off_topic / stuck 互斥, 同 banner slot. controller 见 "立刻 推进" 按钮. */
export type AgendaAdvanceSuggestedEvent = {
  type: "agenda_advance_suggested";
  advance_reason: string;
  current_agenda_item: string | null;
  next_agenda_item: string | null;
  current_agenda_idx: number | null;
  next_agenda_idx: number | null;
  moderator_agent_id: string;
  moderator_agent_name: string;
  moderator_agent_nickname?: string | null;
  moderator_agent_color: string;
  reason: string;
};

/** v26.14-P6.3: LLM 判 出现 多个 立场 但 没人 拍板 — 主持人 主动 总结 收口.
 *  跟 stuck 同 套 — 倒计时 后 自动 召唤 主持人 用 decision_summary_query 发言. */
export type AgendaDecisionSummaryEvent = {
  type: "agenda_decision_summary";
  decision_brief: string;
  decision_summary_query: string;
  current_agenda_item: string | null;
  auto_summon_after_s: number;
  moderator_agent_id: string;
  moderator_agent_name: string;
  moderator_agent_nickname?: string | null;
  moderator_agent_color: string;
  reason: string;
};

/** Synthetic event the wrapper emits on its own (not from the wire) so
 *  the UI can show "重连中…" / "已重连" without snooping at WS state. */
export type ReconnectEvent = {
  type: "reconnect_state";
  state: "connecting" | "connected" | "lost" | "giving_up";
  attempt?: number;
};

export type SttEvent =
  | TranscriptEvent
  | SystemEvent
  | SpeakersUpdatedEvent
  | TranscriptPersistedEvent
  | AgentMessageStartEvent
  | AgentMessageChunkEvent
  | AgentMessageEndEvent
  | AgentRecommendationEvent
  | DissentDetectedEvent
  | AgendaOffTopicEvent
  | AgendaTimeWarningEvent
  | AgendaStuckEvent
  | AgentsInvitedEvent
  | AgendaAdvancedEvent
  | AgendaAdvanceSuggestedEvent
  | AgendaDecisionSummaryEvent
  | ReconnectEvent;

export interface SttSocket {
  send: (frame: ArrayBuffer) => void;
  sendJson: (payload: unknown) => void;
  close: () => void;
}

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000]; // exponential cap
const MAX_ATTEMPTS = RECONNECT_DELAYS_MS.length + 5; // a few stays at 16s

/**
 * Auto-reconnecting STT socket.
 *
 * Behaviour:
 * - On unexpected close, retry with exponential backoff (1s, 2s, 4s, 8s,
 *   16s, then cap at 16s) up to MAX_ATTEMPTS times.
 * - User-initiated close (sock.close()) suppresses reconnect.
 * - Audio frames received while disconnected are dropped (not buffered) —
 *   they'd be stale by the time we reconnect; ASR latency on stale audio
 *   is worse than a small gap.
 * - JSON control messages (e.g. invoke_agent) ARE buffered until the next
 *   open, so user clicks during a brief reconnect aren't silently lost.
 * - Emits ReconnectEvent so the UI can display state.
 */
export function openSttSocket(opts: {
  url: string;
  onEvent: (e: SttEvent) => void;
  onClose?: () => void;
}): SttSocket {
  let ws: WebSocket | null = null;
  let attempt = 0;
  let userClosed = false;
  let reconnectTimer: number | null = null;
  let bufferedJson: string[] = [];

  const connect = () => {
    if (userClosed) return;
    opts.onEvent({
      type: "reconnect_state",
      state: attempt === 0 ? "connecting" : "connecting",
      attempt,
    });
    const sock = new WebSocket(opts.url);
    sock.binaryType = "arraybuffer";
    ws = sock;

    sock.onopen = () => {
      attempt = 0;
      opts.onEvent({ type: "reconnect_state", state: "connected" });
      // Flush any queued JSON control messages
      const pending = bufferedJson;
      bufferedJson = [];
      for (const j of pending) {
        try { sock.send(j); } catch { /* will get dropped if socket already toast */ }
      }
    };

    sock.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      try {
        opts.onEvent(JSON.parse(ev.data) as SttEvent);
      } catch {
        // ignore malformed
      }
    };

    sock.onerror = () => {
      // We rely on onclose to drive the retry; just surface state here.
      opts.onEvent({ type: "reconnect_state", state: "lost", attempt });
    };

    sock.onclose = () => {
      ws = null;
      opts.onClose?.();
      if (userClosed) return;
      if (attempt >= MAX_ATTEMPTS) {
        opts.onEvent({ type: "reconnect_state", state: "giving_up", attempt });
        return;
      }
      const delay =
        RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
      attempt += 1;
      opts.onEvent({ type: "reconnect_state", state: "lost", attempt });
      reconnectTimer = window.setTimeout(connect, delay);
    };
  };

  connect();

  return {
    send: (frame) => {
      // Drop frames while disconnected — we'd just deliver stale audio
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(frame);
    },
    sendJson: (payload) => {
      const text = JSON.stringify(payload);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(text);
      } else {
        bufferedJson.push(text);
      }
    },
    close: () => {
      userClosed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        try {
          ws.send(JSON.stringify({ action: "stop" }));
        } catch {}
        try {
          ws.close();
        } catch {}
      }
    },
  };
}
