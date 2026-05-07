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
};

export type AgentMessageStartEvent = {
  type: "agent_message_start";
  agent_id: string;
  agent_name: string;
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
};

export type AgentRecommendationEvent = {
  type: "agent_recommendation";
  agent_id: string;
  agent_name: string;
  agent_color: string;
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
