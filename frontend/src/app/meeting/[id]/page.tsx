"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { startAudioCapture, type AudioCaptureHandle } from "@/lib/audioCapture";
import { openSttSocket, type SttEvent, type SttSocket } from "@/lib/sttSocket";

type Line = { id: number; text: string; final: boolean };

function backendWsUrl(meetingId: string): string {
  // Resolve at runtime so it works under both http://localhost:3000 and
  // https://aimeeting.zhzjpt.cn without rebuilding.
  if (typeof window === "undefined") return "";
  const isLocalDev = window.location.hostname === "localhost";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = isLocalDev ? "localhost:8000" : window.location.host;
  return `${proto}//${host}/ws/stt?meeting_id=${encodeURIComponent(meetingId)}`;
}

export default function MeetingPage({ params }: { params: { id: string } }) {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string>("待开始");
  const [lines, setLines] = useState<Line[]>([]);
  const captureRef = useRef<AudioCaptureHandle | null>(null);
  const socketRef = useRef<SttSocket | null>(null);
  const interimRef = useRef<Line | null>(null);
  const nextIdRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const handleEvent = useCallback((e: SttEvent) => {
    if (e.type === "system") {
      setStatus(e.msg === "ready" ? "已连接，开始说话" : `系统：${e.msg}`);
      return;
    }
    if (e.type === "transcript") {
      setLines((prev) => {
        const draft = prev.slice();
        if (e.is_final) {
          if (interimRef.current) {
            const idx = draft.findIndex((l) => l.id === interimRef.current!.id);
            if (idx >= 0) draft[idx] = { id: interimRef.current.id, text: e.text, final: true };
            interimRef.current = null;
          } else {
            draft.push({ id: nextIdRef.current++, text: e.text, final: true });
          }
        } else {
          if (interimRef.current) {
            const idx = draft.findIndex((l) => l.id === interimRef.current!.id);
            if (idx >= 0) draft[idx] = { ...draft[idx], text: e.text };
          } else {
            const id = nextIdRef.current++;
            interimRef.current = { id, text: e.text, final: false };
            draft.push({ id, text: e.text, final: false });
          }
        }
        return draft;
      });
    }
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const start = useCallback(async () => {
    if (running) return;
    setStatus("请求麦克风权限...");
    try {
      const sock = openSttSocket({
        url: backendWsUrl(params.id),
        onEvent: handleEvent,
        onClose: () => setStatus("连接已断开"),
      });
      socketRef.current = sock;
      setStatus("正在连接 STT...");
      const cap = await startAudioCapture((frame) => sock.send(frame));
      captureRef.current = cap;
      setRunning(true);
    } catch (err) {
      console.error(err);
      setStatus(
        err instanceof Error ? `启动失败：${err.message}` : "启动失败：未知错误"
      );
      try {
        socketRef.current?.close();
      } catch {}
    }
  }, [running, params.id, handleEvent]);

  const stop = useCallback(async () => {
    setRunning(false);
    setStatus("已停止");
    try {
      await captureRef.current?.stop();
    } catch {}
    captureRef.current = null;
    try {
      socketRef.current?.close();
    } catch {}
    socketRef.current = null;
    interimRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      void stop();
    };
  }, [stop]);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">
            会议室 / {params.id}
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-white">
            实时字幕（Phase 1 演示）
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex h-2.5 w-2.5 rounded-full ${
              running ? "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/50" : "bg-zinc-600"
            }`}
          />
          <span className="text-sm text-zinc-400">{status}</span>
        </div>
      </header>

      <div className="mt-6 flex gap-2">
        <button
          onClick={start}
          disabled={running}
          className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white shadow disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-400 transition"
        >
          开始会议
        </button>
        <button
          onClick={stop}
          disabled={!running}
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-zinc-800 transition"
        >
          结束
        </button>
      </div>

      <section
        ref={scrollRef}
        className="mt-6 h-[60vh] overflow-y-auto rounded-xl border border-ink-700 bg-ink-900 p-6"
      >
        {lines.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-600">
            点「开始会议」后开口说话，字幕会出现在这里。
          </div>
        ) : (
          <ul className="space-y-3">
            {lines.map((l) => (
              <li
                key={l.id}
                className={
                  l.final
                    ? "text-base leading-relaxed text-zinc-100"
                    : "text-base leading-relaxed text-zinc-400"
                }
              >
                {l.text}
                {!l.final ? <span className="ml-1 animate-pulse">▌</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-4 text-xs text-zinc-600">
        采样：16kHz · 单声道 · Int16 PCM · STT：DashScope paraformer-realtime-v1
      </footer>
    </main>
  );
}
