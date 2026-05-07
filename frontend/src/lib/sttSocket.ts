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

export type SttEvent =
  | TranscriptEvent
  | SystemEvent
  | SpeakersUpdatedEvent
  | TranscriptPersistedEvent
  | AgentMessageStartEvent
  | AgentMessageChunkEvent
  | AgentMessageEndEvent;

export interface SttSocket {
  send: (frame: ArrayBuffer) => void;
  sendJson: (payload: unknown) => void;
  close: () => void;
}

export function openSttSocket(opts: {
  url: string;
  onEvent: (e: SttEvent) => void;
  onClose?: () => void;
}): SttSocket {
  const ws = new WebSocket(opts.url);
  ws.binaryType = "arraybuffer";

  let buffered: ArrayBuffer[] = [];
  let bufferedJson: string[] = [];

  ws.onopen = () => {
    for (const f of buffered) ws.send(f);
    buffered = [];
    for (const j of bufferedJson) ws.send(j);
    bufferedJson = [];
  };

  ws.onmessage = (ev) => {
    if (typeof ev.data !== "string") return;
    try {
      const parsed = JSON.parse(ev.data) as SttEvent;
      opts.onEvent(parsed);
    } catch {
      // ignore malformed
    }
  };

  ws.onclose = () => opts.onClose?.();
  ws.onerror = () => opts.onClose?.();

  return {
    send: (frame) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(frame);
      else if (ws.readyState === WebSocket.CONNECTING) buffered.push(frame);
    },
    sendJson: (payload) => {
      const text = JSON.stringify(payload);
      if (ws.readyState === WebSocket.OPEN) ws.send(text);
      else if (ws.readyState === WebSocket.CONNECTING) bufferedJson.push(text);
    },
    close: () => {
      try {
        ws.send(JSON.stringify({ action: "stop" }));
      } catch {}
      try {
        ws.close();
      } catch {}
    },
  };
}
