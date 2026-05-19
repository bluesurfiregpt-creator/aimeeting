"use client";

/**
 * v27.0-mobile P12 · 手机端录音控制 — 让 mobile 真能开会, 不只 viewer.
 *
 * 复用桌面端 startAudioCapture (16kHz mono Int16 PCM), 复用 mobile 已有的
 * MeetingWsProvider (WS to /ws/stt). audio binary 通过 WS 发, 后端 FunASR
 * ASR → transcript_persisted 事件广播回所有客户端 (含 mobile 自己),
 * P5B 的 MeetingTranscriptView 实时显.
 *
 * 状态:
 *   idle      — 没录音. 显 "🎙 开始录音" 蓝色按钮
 *   requesting — 拿麦克风权限中. 显 loading
 *   live      — 录音中. 显红色脉动 ● + 计时 + "停止" 按钮
 *   error     — 麦克风拒绝/不可用. 显错误 + 重试 / 知道了
 *
 * 录音逻辑:
 *   - start: startAudioCapture(sink) → 拿到 PCM ArrayBuffer 帧 → sendBinary 到 WS
 *   - stop: capture.stop() 释放 mic + AudioContext + sendJson({action:"stop"}) 通知后端
 *
 * 安全:
 *   - getUserMedia 需要 HTTPS (生产已是)
 *   - 麦权限被拒绝时 显友好提示, 不阻塞用户 用其他功能 (召 AI / 推议程)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  startAudioCapture,
  MicPermissionError,
  type AudioCaptureHandle,
} from "@/lib/audioCapture";
import { useMeetingWsConn, useMeetingWsSend } from "@/lib/mobile/meetingWsBus";

type RecState = "idle" | "requesting" | "live" | "error";

function fmtElapsed(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function MeetingRecorderControl({
  meetingOngoing,
}: {
  /** 仅 ongoing 会议才显完整 UI; scheduled / finished 隐藏 */
  meetingOngoing: boolean;
}) {
  const [state, setState] = useState<RecState>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [elapsed, setElapsed] = useState(0);  // 录音已多少秒
  const captureRef = useRef<AudioCaptureHandle | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { send, sendJson } = useMeetingWsSend();
  const conn = useMeetingWsConn();

  // 启动录音
  const handleStart = useCallback(async () => {
    if (state === "live" || state === "requesting") return;
    setState("requesting");
    setErrorMsg("");
    try {
      const cap = await startAudioCapture((frame: ArrayBuffer) => {
        // 每帧 PCM (4096 samples × Int16 = 8192 bytes) 走 ws binary
        send(frame);
      });
      captureRef.current = cap;
      setState("live");
      setElapsed(0);
      // 计时器
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
    }
  }, [state, send]);

  // 停止录音 (不结束会议, 只是 mic stop, 让用户能再次 start)
  const handleStop = useCallback(async () => {
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
        // 释放失败也继续 UI 回到 idle
      }
    }
    // 不发 {action:"stop"} — 那会让后端 break ws loop, 影响其他订阅者收事件
    // mobile recorder 停 只代表"暂停麦克风", 不代表会议结束.
    // 真要结束会议走 sticky bar 的 "结束会议" 按钮 (P4.2 finalize endpoint).
    setState("idle");
    setElapsed(0);
  }, []);

  // unmount 时释放 mic
  useEffect(() => {
    return () => {
      void captureRef.current?.stop().catch(() => {});
      captureRef.current = null;
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  if (!meetingOngoing) {
    return null;
  }

  // ===== Render — 紧凑一行式 (sticky bar 装得下) =====
  // 文案精简到最少, 一行内说清, 大按钮在右侧.
  if (state === "idle") {
    return (
      <div className="flex items-center gap-3" data-testid="mobile-recorder-idle">
        <span className="text-[18px]">🎙</span>
        <p className="min-w-0 flex-1 truncate text-[14px] text-zinc-300">
          点右侧开始 — 你说话 AI 自动转文字
        </p>
        <button
          type="button"
          onClick={handleStart}
          disabled={conn !== "connected"}
          className="shrink-0 inline-flex h-10 items-center justify-center rounded-lg bg-accent-500 px-4 text-[14px] font-medium text-white shadow-md shadow-accent-500/20 active:scale-[0.98] active:bg-accent-600 disabled:opacity-50"
          data-testid="mobile-recorder-start"
        >
          {conn !== "connected" ? "连接中…" : "开始录音"}
        </button>
      </div>
    );
  }

  if (state === "requesting") {
    return (
      <div className="flex items-center gap-3 text-[14px] text-accent-200">
        <span>⏳ 请允许麦克风…</span>
      </div>
    );
  }

  if (state === "live") {
    return (
      <div
        className="flex items-center gap-3"
        data-testid="mobile-recorder-live"
      >
        <span className="relative inline-flex h-3 w-3 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-rose-500" />
        </span>
        <p className="min-w-0 flex-1 text-[14px] text-rose-100">
          <span className="font-medium">正在录音</span>
          <span className="ml-2 tabular-nums text-rose-200/80">
            {fmtElapsed(elapsed)}
          </span>
        </p>
        <button
          type="button"
          onClick={handleStop}
          className="shrink-0 inline-flex h-10 items-center justify-center rounded-lg border border-rose-500/40 bg-ink-950/60 px-4 text-[14px] font-medium text-rose-200 active:scale-[0.98] active:bg-rose-500/[0.15]"
          data-testid="mobile-recorder-stop"
        >
          停止
        </button>
      </div>
    );
  }

  // error — 紧凑双行 (错误信息可能较长)
  return (
    <div data-testid="mobile-recorder-error">
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 text-[14px] font-medium text-amber-200">
          ⚠ 麦克风启动失败
        </span>
        <button
          type="button"
          onClick={handleStart}
          className="ml-auto shrink-0 text-[13px] font-medium text-amber-300 active:text-amber-200"
        >
          重试 →
        </button>
      </div>
      <p className="mt-1 line-clamp-2 text-[12px] text-zinc-400">{errorMsg}</p>
    </div>
  );
}
