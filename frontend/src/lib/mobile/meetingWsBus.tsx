"use client";

/**
 * v27.0-mobile P5B · 会议页 WS 事件总线.
 *
 * 单 WebSocket 连接, 多组件订阅. 设计动机:
 *   - WS 应在 page 级别打开 (转录折叠没展开时 agenda banner 也要工作)
 *   - 多个子组件需要不同事件 (TranscriptView 看 transcript / agent 类,
 *     AgendaEventBanner 看 agenda 类)
 *   - 不能两个连接 — 浪费带宽 + 后端 broadcast 2x.
 *
 * 用法:
 *   MeetingWsProvider meetingId={id}
 *     TranscriptView  ← 内部 useMeetingWsEvent(handler)
 *     AgendaBannerHost  ← 同样
 *   /MeetingWsProvider
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { openSttSocket, type SttEvent, type SttSocket } from "@/lib/sttSocket";

export type WsConnState = "idle" | "connecting" | "connected" | "reconnecting" | "giving_up";

type Handler = (e: SttEvent) => void;

type Ctx = {
  conn: WsConnState;
  /** 订阅 — 返回 unsubscribe. 在 useEffect 里调. */
  subscribe: (h: Handler) => () => void;
};

const MeetingWsContext = createContext<Ctx | null>(null);

export function MeetingWsProvider({
  meetingId,
  children,
}: {
  meetingId: string;
  children: ReactNode;
}) {
  const [conn, setConn] = useState<WsConnState>("idle");
  const subscribersRef = useRef<Set<Handler>>(new Set());
  const sockRef = useRef<SttSocket | null>(null);

  const subscribe = useCallback((h: Handler) => {
    subscribersRef.current.add(h);
    return () => {
      subscribersRef.current.delete(h);
    };
  }, []);

  useEffect(() => {
    setConn("connecting");
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/ws/stt?meeting_id=${meetingId}`;
    const sock = openSttSocket({
      url,
      onEvent: (e) => {
        // 拦截连接状态事件
        if (e.type === "reconnect_state") {
          if (e.state === "connecting" || e.state === "lost") setConn("reconnecting");
          else if (e.state === "connected") setConn("connected");
          else if (e.state === "giving_up") setConn("giving_up");
        }
        // 派发给所有订阅者
        for (const h of subscribersRef.current) {
          try {
            h(e);
          } catch (err) {
            // 单订阅者错误不影响其他
            console.error("[meetingWsBus] subscriber threw:", err);
          }
        }
      },
    });
    sockRef.current = sock;
    // openSttSocket 不发 connecting 事件; 假定 socket 创建后短时间连上
    // sttSocket 内部会在 onopen 时发 reconnect_state:"connected"
    return () => {
      sock.close();
      sockRef.current = null;
      setConn("idle");
    };
  }, [meetingId]);

  return (
    <MeetingWsContext.Provider value={{ conn, subscribe }}>
      {children}
    </MeetingWsContext.Provider>
  );
}

/** 订阅 WS 事件. handler 改变时会重新订阅 — 用 useCallback 包稳定. */
export function useMeetingWsEvent(handler: Handler) {
  const ctx = useContext(MeetingWsContext);
  useEffect(() => {
    if (!ctx) return;
    return ctx.subscribe(handler);
  }, [ctx, handler]);
}

/** 拿连接状态 (mobile 头部小绿点用). */
export function useMeetingWsConn(): WsConnState {
  const ctx = useContext(MeetingWsContext);
  return ctx?.conn ?? "idle";
}
