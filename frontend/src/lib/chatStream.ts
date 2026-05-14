// v26.13.1: AI 私聊 调试模式 — SSE 流 客户端 + chat-stt WS 客户端.
//
// 后端 SSE 帧 格式:
//   data: {"type":"agent_message_start", "agent_id": "...", ...}
//   data: {"type":"agent_message_chunk", "chunk": "..."}
//   data: {"type":"agent_message_end", "text": "...", "citations": [...]}
//   data: {"type":"chat_debug_info", "kb_hits": 3, "memory_hits": 1}
//   data: {"type":"chat_quota", "remaining_today": 47, "daily_limit": 50}
//   data: {"type":"system", "msg": "..."}

function backendBase(): string {
  if (typeof window === "undefined") return "";
  if (window.location.hostname === "localhost") return "http://localhost:8000";
  return "";
}

function backendWsBase(): string {
  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  if (window.location.hostname === "localhost") return `${proto}//localhost:8000`;
  return `${proto}//${window.location.host}`;
}

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatAttachment = {
  filename: string;
  text: string;
};

export type ChatStreamEvent =
  | { type: "chat_quota"; remaining_today: number; daily_limit: number }
  | { type: "agent_message_start"; agent_id: string; agent_name: string; agent_nickname?: string | null; agent_color: string }
  | { type: "agent_message_chunk"; agent_id: string; chunk: string }
  | { type: "agent_message_end"; agent_id: string; text: string; citations: AgentCitation[] }
  | { type: "chat_debug_info"; agent_id: string; kb_hits: number; memory_hits: number }
  // v26.13.2: AI 回完 + 没引用 KB → 后端 推 此帧 让 前端 显 "用 Perplexity 补充" 按钮
  | { type: "kb_miss_hint"; agent_id: string; kb_id: string; suggested_query: string; reason: string }
  | { type: "system"; msg: string };

export type AgentCitation = {
  chunk_id: string;
  document_id: string;
  document_filename: string;
  chunk_index: number;
  snippet: string;
  distance: number;
};

/**
 * Stream a chat with an agent via SSE.
 *
 * Caller pattern:
 *   const ctrl = new AbortController();
 *   for await (const ev of streamChat({ agentId, messages, attachments, signal: ctrl.signal })) {
 *     handle(ev);
 *   }
 *
 * Abort the controller to cancel mid-stream.
 */
export async function* streamChat(opts: {
  agentId: string;
  messages: ChatMessage[];
  attachments?: ChatAttachment[];
  signal?: AbortSignal;
}): AsyncGenerator<ChatStreamEvent, void, unknown> {
  const r = await fetch(
    backendBase() + `/api/agents/${opts.agentId}/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        messages: opts.messages,
        attachments: opts.attachments ?? [],
      }),
      signal: opts.signal,
    },
  );

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    let detail = text;
    try {
      detail = JSON.parse(text)?.detail || text;
    } catch {}
    throw new Error(
      r.status === 429
        ? detail || "配额超限"
        : detail || `HTTP ${r.status}`,
    );
  }

  if (!r.body) {
    throw new Error("response body is null");
  }

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE frames are separated by \n\n
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        // Each frame: one or more "data: ..." lines (we only emit single-line)
        for (const line of frame.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload) continue;
          try {
            yield JSON.parse(payload) as ChatStreamEvent;
          } catch (e) {
            console.warn("chat stream: bad SSE frame", payload, e);
          }
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// chat-stt WebSocket — 调试模式 语音输入
// ---------------------------------------------------------------------------
export type ChatSttEvent =
  | { type: "transcript"; text: string; is_final: boolean; start_ts?: number | null; end_ts?: number | null }
  | { type: "system"; msg: string };

export interface ChatSttSocket {
  /** 喂 PCM 音频帧 (跟 v25 ws_stt 同一套格式: 16kHz 16-bit mono PCM frames) */
  send: (frame: ArrayBuffer) => void;
  /** 主动 关闭 */
  close: () => void;
}

export function openChatSttSocket(opts: {
  onEvent: (e: ChatSttEvent) => void;
  onClose?: () => void;
}): ChatSttSocket {
  const url = `${backendWsBase()}/ws/chat-stt`;
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";

  ws.addEventListener("message", (ev) => {
    try {
      const data = JSON.parse(ev.data) as ChatSttEvent;
      opts.onEvent(data);
    } catch (e) {
      console.warn("chat-stt: bad WS frame", ev.data, e);
    }
  });
  ws.addEventListener("close", () => {
    opts.onClose?.();
  });
  ws.addEventListener("error", (e) => {
    console.warn("chat-stt WS error", e);
  });

  return {
    send: (frame: ArrayBuffer) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(frame);
    },
    close: () => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: "stop" }));
        }
        ws.close();
      } catch {}
    },
  };
}
