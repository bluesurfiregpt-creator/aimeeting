"use client";

/**
 * v27.0-mobile P14 · 自动录音 + 闭麦切换.
 *
 * 用户反馈: "不需要开始录音按钮, 只要开始会议 / 结束会议 / 闭麦"
 * → 进 ongoing 会议自动获取麦克风 + 持续录音
 * → 暴露的控制只有: 闭麦 (pause) / 开麦 (resume) / 重试 (error 时)
 *
 * 状态机 (自动驱动):
 *   - meetingOngoing=false → 不渲 (隐藏)
 *   - 默认 micOn: 进 ongoing 时 useEffect 自动 startAudioCapture
 *   - 用户点 [闭麦]: cap.stop() 释放 mic, 显 "🔇 已闭麦"
 *   - 用户点 [开麦]: 重新 startAudioCapture
 *   - 麦克风错误 (权限拒绝等): 显 "麦克风失败 [重试]"
 *
 * audio sink: 每帧 PCM ArrayBuffer 发到 WS — 跟 P12 一样
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  startAudioCapture,
  MicPermissionError,
  type AudioCaptureHandle,
} from "@/lib/audioCapture";
import { useMeetingWsConn, useMeetingWsSend } from "@/lib/mobile/meetingWsBus";

type MicState = "micOn" | "micOff" | "error" | "starting";

function fmtElapsed(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function MeetingRecorderControl({
  meetingOngoing,
}: {
  meetingOngoing: boolean;
}) {
  const [state, setState] = useState<MicState>("starting");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [elapsed, setElapsed] = useState(0);
  const captureRef = useRef<AudioCaptureHandle | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { send } = useMeetingWsSend();
  const conn = useMeetingWsConn();
  // 防止 useEffect strict mode double-mount 导致重复 startAudioCapture
  const startingRef = useRef(false);

  const startCapture = useCallback(async () => {
    if (captureRef.current || startingRef.current) return;
    startingRef.current = true;
    setState("starting");
    setErrorMsg("");
    try {
      const cap = await startAudioCapture((frame: ArrayBuffer) => {
        send(frame);
      });
      captureRef.current = cap;
      setState("micOn");
      setElapsed(0);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = setInterval(() => {
        setElapsed((s) => s + 1);
      }, 1000);
    } catch (e) {
      const msg =
        e instanceof MicPermissionError
          ? e.message
          : e instanceof Error
          ? e.message
          : String(e);
      setErrorMsg(msg);
      setState("error");
    } finally {
      startingRef.current = false;
    }
  }, [send]);

  const stopCapture = useCallback(async () => {
    const cap = captureRef.current;
    captureRef.current = null;
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    if (cap) {
      try {
        await cap.stop();
      } catch {
        // 忽略
      }
    }
  }, []);

  // mount 时 (meetingOngoing && conn=connected) 自动开始录音
  useEffect(() => {
    if (!meetingOngoing) {
      return;
    }
    if (conn !== "connected") {
      // ws 还没连上, 等连接好再启动
      return;
    }
    // strict-mode safe: startCapture 自己 guard
    void startCapture();
  }, [meetingOngoing, conn, startCapture]);

  // unmount 时释放 mic
  useEffect(() => {
    return () => {
      void stopCapture();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 闭麦 / 开麦 toggle
  const handleToggleMute = useCallback(async () => {
    if (state === "micOn") {
      await stopCapture();
      setState("micOff");
    } else if (state === "micOff") {
      void startCapture();
    } else if (state === "error") {
      void startCapture();
    }
  }, [state, startCapture, stopCapture]);

  if (!meetingOngoing) return null;

  // ===== Render — 一行紧凑 (v1.4.0 Saga L: 浅色化 iOS) =====
  if (state === "starting") {
    return (
      <div
        className="flex items-center gap-3 text-[14px]"
        style={{ color: "#8E8E93" }}
        data-testid="mobile-recorder-starting"
      >
        <span>⏳</span>
        <span>启动麦克风… (请允许浏览器权限)</span>
      </div>
    );
  }

  if (state === "micOn") {
    return (
      <div
        className="flex items-center gap-3"
        data-testid="mobile-recorder-mic-on"
      >
        <span className="relative inline-flex h-3 w-3 shrink-0">
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
            style={{ background: "#FF3B30" }}
          />
          <span
            className="relative inline-flex h-3 w-3 rounded-full"
            style={{ background: "#FF3B30" }}
          />
        </span>
        <p className="min-w-0 flex-1 text-[14px]" style={{ color: "#FF3B30" }}>
          <span className="font-medium">正在录音</span>
          <span
            className="ml-2 tabular-nums"
            style={{ color: "rgba(255,59,48,0.70)" }}
          >
            {fmtElapsed(elapsed)}
          </span>
        </p>
        <button
          type="button"
          onClick={handleToggleMute}
          className="shrink-0 inline-flex h-10 items-center justify-center gap-1 rounded-lg px-4 text-[14px] font-medium active:scale-[0.98]"
          style={{
            background: "rgba(255,59,48,0.08)",
            border: "0.5px solid rgba(255,59,48,0.30)",
            color: "#FF3B30",
          }}
          data-testid="mobile-recorder-mute"
        >
          🔇 闭麦
        </button>
      </div>
    );
  }

  if (state === "micOff") {
    return (
      <div
        className="flex items-center gap-3"
        data-testid="mobile-recorder-mic-off"
      >
        <span className="text-[16px]" style={{ color: "#8E8E93" }}>
          🔇
        </span>
        <p
          className="min-w-0 flex-1 text-[14px]"
          style={{ color: "#3C3C43" }}
        >
          <span className="font-medium">已闭麦</span>
          <span className="ml-2" style={{ color: "#8E8E93" }}>
            点右侧恢复
          </span>
        </p>
        <button
          type="button"
          onClick={handleToggleMute}
          className="shrink-0 inline-flex h-10 items-center justify-center gap-1 rounded-lg px-4 text-[14px] font-medium text-white active:scale-[0.98]"
          style={{
            background: "#007AFF",
            boxShadow: "0 2px 6px rgba(0,122,255,0.30)",
          }}
          data-testid="mobile-recorder-unmute"
        >
          🎙 开麦
        </button>
      </div>
    );
  }

  // error
  return (
    <div data-testid="mobile-recorder-error">
      <div className="flex items-baseline gap-2">
        <span
          className="shrink-0 text-[14px] font-medium"
          style={{ color: "#FF9500" }}
        >
          ⚠ 麦克风失败
        </span>
        <button
          type="button"
          onClick={handleToggleMute}
          className="ml-auto shrink-0 text-[13px] font-medium active:opacity-60"
          style={{ color: "#FF9500" }}
        >
          重试 →
        </button>
      </div>
      <p className="mt-1 line-clamp-2 text-[12px]" style={{ color: "#8E8E93" }}>
        {errorMsg}
      </p>
    </div>
  );
}
