"use client";

/**
 * v1.4.0 Phase A · 6 (NORTH_STAR § 6.1 痛点: Web 大屏能说话) · useWebMeetingStt hook
 *
 * Web R5.D 会议室 mic + STT WS — 跟 mobile MeetingWsProvider 同一份 backend
 * 协议 (`/ws/stt?meeting_id=<id>`), 但 单 view 用, 不走 Provider 模式 (Mobile
 * 的 Provider 是 因为 多 子组件 都要 订阅 WS event).
 *
 * 行为:
 *   - mount 时 open WS, 监听 SttEvent (transcript / agent_message_* / agenda_* / ...)
 *   - toggleMic(): on 时 startAudioCapture(sink → ws.send) + 状态 mic_on,
 *     off 时 capture.stop()
 *   - 暴露 lines: 真实 WS 推送 transcript_persisted + agent_message_* 累积
 *   - connState 给 UI 显小绿点
 *   - error 失败 (mic 权限 / WS 掉线) UI 提示
 *
 * 注意:
 *   - Web 会议室 是 light theme, 跟 mobile 浅色 一致
 *   - 不复用 mobile MeetingWsProvider Context (避免 import path 复杂),
 *     直接 用 openSttSocket library (lib/sttSocket.ts) 共享
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { openSttSocket, type SttEvent, type SttSocket } from "@/lib/sttSocket";
import {
  startAudioCapture,
  MicPermissionError,
  type AudioCaptureHandle,
} from "@/lib/audioCapture";

export type WebWsConnState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "giving_up";

/** 简化版 SttLine — 跟 mobile 区分, 仅 含 UI 必需字段. */
export type WebSttLine = {
  key: string;
  kind: "user" | "agent";
  /** db line_id (user) 或 0 (streaming agent live, 未 persist) */
  id: number;
  text: string;
  /** speaker name (user line) 或 agent name (agent line) */
  speaker_name?: string | null;
  agent_id?: string | null;
  agent_name?: string | null;
  agent_nickname?: string | null;
  agent_color?: string | null;
  start_ms?: number | null;
  /** 是否还在流式 (agent_message_chunk 期间 true, end 后 false) */
  streaming?: boolean;
};

export type UseWebMeetingSttResult = {
  conn: WebWsConnState;
  micOn: boolean;
  toggleMic: () => Promise<void>;
  /** 来自 WS 的 实时 lines (累积 transcript_persisted + agent_message_*). */
  liveLines: WebSttLine[];
  /** 最近一次 mic / WS error — UI 可弹 toast 或 banner */
  error: string | null;
  clearError: () => void;
  /** v1.4.0 Phase A 后置: send JSON action 到 backend (text_message / invoke_agent / ...).
   *  WS 没连 时 静默 丢 (sttSocket buffer + reconnect 后 flush). */
  sendJson: (payload: unknown) => void;
};

export function useWebMeetingStt(meetingId: string): UseWebMeetingSttResult {
  const [conn, setConn] = useState<WebWsConnState>("idle");
  const [micOn, setMicOn] = useState(false);
  const [liveLines, setLiveLines] = useState<WebSttLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  const sockRef = useRef<SttSocket | null>(null);
  const captureRef = useRef<AudioCaptureHandle | null>(null);

  // ─── WS event handler ───
  const handleEvent = useCallback((e: SttEvent) => {
    switch (e.type) {
      case "reconnect_state": {
        if (e.state === "connecting" || e.state === "lost") setConn("reconnecting");
        else if (e.state === "connected") setConn("connected");
        else if (e.state === "giving_up") setConn("giving_up");
        break;
      }
      case "transcript_persisted": {
        if (!e.text) break;
        const key = `user-${e.line_id}`;
        setLiveLines((prev) => {
          if (prev.some((l) => l.key === key)) return prev;
          return [
            ...prev,
            {
              key,
              kind: "user",
              id: e.line_id,
              text: e.text!,
              speaker_name: e.speaker_name ?? null,
              start_ms: e.start_ms ?? null,
              streaming: false,
            },
          ];
        });
        break;
      }
      case "agent_message_start": {
        setLiveLines((prev) => [
          ...prev,
          {
            key: `agent-live-${e.agent_id}-${Date.now()}`,
            kind: "agent",
            id: 0,
            text: "",
            agent_id: e.agent_id,
            agent_name: e.agent_name,
            agent_nickname: e.agent_nickname ?? null,
            agent_color: e.agent_color,
            streaming: true,
          },
        ]);
        break;
      }
      case "agent_message_chunk": {
        setLiveLines((prev) => {
          for (let i = prev.length - 1; i >= 0; i--) {
            const l = prev[i];
            if (l.kind === "agent" && l.streaming && l.agent_id === e.agent_id) {
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
        setLiveLines((prev) => {
          for (let i = prev.length - 1; i >= 0; i--) {
            const l = prev[i];
            if (l.kind === "agent" && l.streaming && l.agent_id === e.agent_id) {
              const next = [...prev];
              next[i] = { ...l, text: e.text, streaming: false };
              return next;
            }
          }
          return prev;
        });
        break;
      }
      default:
        // 其他 event (agenda_*, dissent_detected, agent_recommendation, ...) 暂不在
        // 此 hook 处理 — view 层 (MRLiveView) 若需要, 可 加 additional subscribe.
        break;
    }
  }, []);

  // ─── Mount: open WS ───
  useEffect(() => {
    if (typeof window === "undefined") return;
    setConn("connecting");
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/ws/stt?meeting_id=${meetingId}`;
    const sock = openSttSocket({
      url,
      onEvent: handleEvent,
    });
    sockRef.current = sock;
    return () => {
      // 关 WS 前 先关 mic capture (避免 leak)
      const cap = captureRef.current;
      if (cap) {
        void cap.stop();
        captureRef.current = null;
      }
      sock.close();
      sockRef.current = null;
      setConn("idle");
      setMicOn(false);
    };
  }, [meetingId, handleEvent]);

  // ─── Mic toggle ───
  const toggleMic = useCallback(async () => {
    // 关 mic
    if (micOn || captureRef.current) {
      try {
        await captureRef.current?.stop();
      } catch {
        /* ignore stop errors */
      }
      captureRef.current = null;
      setMicOn(false);
      return;
    }
    // 开 mic
    setError(null);
    try {
      const handle = await startAudioCapture((frame) => {
        // sink: PCM frame → WS binary send
        sockRef.current?.send(frame);
      });
      captureRef.current = handle;
      setMicOn(true);
    } catch (e) {
      const msg =
        e instanceof MicPermissionError
          ? e.message
          : e instanceof Error
            ? `麦克风启动失败: ${e.message}`
            : "麦克风启动失败 (未知错误)";
      setError(msg);
      setMicOn(false);
    }
  }, [micOn]);

  const clearError = useCallback(() => setError(null), []);

  // v1.4.0 Phase A 后置: 暴露 sendJson, 让 MRInputBar 走 WS text_message.
  const sendJson = useCallback((payload: unknown) => {
    sockRef.current?.sendJson(payload);
  }, []);

  return { conn, micOn, toggleMic, liveLines, error, clearError, sendJson };
}
