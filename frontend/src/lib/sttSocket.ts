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

export type SttEvent = TranscriptEvent | SystemEvent;

export interface SttSocket {
  send: (frame: ArrayBuffer) => void;
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

  ws.onopen = () => {
    for (const f of buffered) ws.send(f);
    buffered = [];
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
