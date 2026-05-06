"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { startAudioCapture, type AudioCaptureHandle } from "@/lib/audioCapture";
import { openSttSocket, type SttEvent, type SttSocket } from "@/lib/sttSocket";
import { api, type MeetingResult, type TranscriptLine } from "@/lib/api";

type Line = { id: string; text: string; final: boolean };

function backendWsUrl(meetingId: string): string {
  if (typeof window === "undefined") return "";
  const isLocalDev = window.location.hostname === "localhost";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = isLocalDev ? "localhost:8000" : window.location.host;
  return `${proto}//${host}/ws/stt?meeting_id=${encodeURIComponent(meetingId)}`;
}

export default function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: meetingId } = use(params);

  const [phase, setPhase] = useState<"idle" | "live" | "identifying" | "done" | "error">("idle");
  const [statusText, setStatusText] = useState("待开始");
  const [liveLines, setLiveLines] = useState<Line[]>([]);
  const [result, setResult] = useState<MeetingResult | null>(null);

  const captureRef = useRef<AudioCaptureHandle | null>(null);
  const socketRef = useRef<SttSocket | null>(null);
  const interimRef = useRef<string | null>(null);
  const nextIdRef = useRef(1);
  const liveScrollRef = useRef<HTMLDivElement | null>(null);
  const pollRef = useRef<number | null>(null);
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const handleEvent = useCallback((e: SttEvent) => {
    if (e.type === "system") {
      if (e.msg === "ready") setStatusText("已连接，开始说话");
      else setStatusText(`系统：${e.msg}`);
      return;
    }
    if (e.type === "transcript") {
      setLiveLines((prev) => {
        const draft = prev.slice();
        if (e.is_final) {
          if (interimRef.current) {
            const idx = draft.findIndex((l) => l.id === interimRef.current);
            if (idx >= 0) draft[idx] = { ...draft[idx], text: e.text, final: true };
            interimRef.current = null;
          } else {
            draft.push({ id: `f${nextIdRef.current++}`, text: e.text, final: true });
          }
        } else {
          if (interimRef.current) {
            const idx = draft.findIndex((l) => l.id === interimRef.current);
            if (idx >= 0) draft[idx] = { ...draft[idx], text: e.text };
          } else {
            const id = `i${nextIdRef.current++}`;
            interimRef.current = id;
            draft.push({ id, text: e.text, final: false });
          }
        }
        return draft;
      });
    }
  }, []);

  useEffect(() => {
    if (liveScrollRef.current) {
      liveScrollRef.current.scrollTop = liveScrollRef.current.scrollHeight;
    }
  }, [liveLines]);

  const start = useCallback(async () => {
    if (phase !== "idle") return;
    setStatusText("请求麦克风权限...");
    try {
      const sock = openSttSocket({
        url: backendWsUrl(meetingId),
        onEvent: handleEvent,
        onClose: () => {
          if (phaseRef.current === "live") setStatusText("连接已断开");
        },
      });
      socketRef.current = sock;
      const cap = await startAudioCapture((frame) => sock.send(frame));
      captureRef.current = cap;
      setPhase("live");
    } catch (err) {
      console.error(err);
      setStatusText(err instanceof Error ? `启动失败：${err.message}` : "启动失败");
      setPhase("error");
      try { socketRef.current?.close(); } catch {}
    }
  }, [phase, meetingId, handleEvent]);

  const stop = useCallback(async () => {
    setStatusText("会议结束，正在做声纹识别...");
    setPhase("identifying");
    try { await captureRef.current?.stop(); } catch {}
    captureRef.current = null;
    try { socketRef.current?.close(); } catch {}
    socketRef.current = null;
    interimRef.current = null;

    try {
      await api.finalizeMeeting(meetingId);
    } catch (e) {
      console.error(e);
      setStatusText("提交识别任务失败");
      setPhase("error");
      return;
    }

    const poll = async () => {
      try {
        const r = await api.meetingResult(meetingId);
        setResult(r);
        if (r.identification_status === "ready") {
          setPhase("done");
          setStatusText("✅ 识别完成");
          return;
        }
        if (r.identification_status === "skipped") {
          setPhase("done");
          setStatusText(`已跳过声纹识别：${r.identification_message ?? ""}`);
          return;
        }
        if (r.identification_status === "failed") {
          setPhase("error");
          setStatusText(`识别失败：${r.identification_message ?? ""}`);
          return;
        }
        pollRef.current = window.setTimeout(poll, 3000);
      } catch (e) {
        console.error(e);
        pollRef.current = window.setTimeout(poll, 5000);
      }
    };
    poll();
  }, [meetingId]);

  useEffect(() => () => {
    if (pollRef.current) window.clearTimeout(pollRef.current);
    captureRef.current?.stop().catch(() => {});
    socketRef.current?.close();
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">会议室</div>
          <h1 className="mt-1 text-2xl font-semibold text-white">实时字幕 + 声纹识别</h1>
          <div className="mt-1 text-xs text-zinc-600">{meetingId}</div>
        </div>
        <Link href="/" className="text-sm text-zinc-400 hover:text-white">← 首页</Link>
      </header>

      <div className="mt-5 flex items-center gap-3">
        <span
          className={`inline-flex h-2.5 w-2.5 rounded-full ${
            phase === "live"
              ? "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/50"
              : phase === "identifying"
              ? "bg-amber-400 shadow-[0_0_8px] shadow-amber-400/50"
              : phase === "done"
              ? "bg-accent-400"
              : phase === "error"
              ? "bg-rose-400"
              : "bg-zinc-600"
          }`}
        />
        <span className="text-sm text-zinc-400">{statusText}</span>
      </div>

      <div className="mt-5 flex gap-2">
        <button
          onClick={start}
          disabled={phase !== "idle"}
          className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white shadow disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-400 transition"
        >
          开始会议
        </button>
        <button
          onClick={stop}
          disabled={phase !== "live"}
          className="rounded-lg border border-rose-500/40 px-4 py-2 text-sm text-rose-300 disabled:cursor-not-allowed disabled:opacity-30 hover:bg-rose-500/10 transition"
        >
          结束并识别
        </button>
      </div>

      {phase !== "done" ? (
        <section
          ref={liveScrollRef}
          className="mt-6 h-[60vh] overflow-y-auto rounded-xl border border-ink-700 bg-ink-900 p-6"
        >
          {liveLines.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-zinc-600">
              点「开始会议」后开口说话，字幕会出现在这里。
            </div>
          ) : (
            <ul className="space-y-3">
              {liveLines.map((l) => (
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
      ) : (
        <NamedTranscript lines={result?.lines ?? []} />
      )}
    </main>
  );
}

function NamedTranscript({ lines }: { lines: TranscriptLine[] }) {
  const palette = [
    "text-sky-300",
    "text-emerald-300",
    "text-violet-300",
    "text-rose-300",
    "text-amber-300",
    "text-teal-300",
  ];
  const colorOf = (uid: string | null): string => {
    if (!uid) return "text-zinc-500";
    let h = 0;
    for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
    return palette[h % palette.length];
  };

  return (
    <section className="mt-6 max-h-[70vh] overflow-y-auto rounded-xl border border-ink-700 bg-ink-900 p-6">
      {lines.length === 0 ? (
        <p className="text-sm text-zinc-600">这次会议没有可识别的对话。</p>
      ) : (
        <ul className="space-y-3">
          {lines.map((l) => (
            <li key={l.id} className="text-base leading-relaxed">
              <span className={`mr-3 font-medium ${colorOf(l.speaker_user_id)}`}>
                {l.speaker_name ?? "未识别"}
              </span>
              <span className="text-zinc-100">{l.text}</span>
              {l.confidence !== null && l.speaker_user_id ? (
                <span className="ml-2 text-[10px] text-zinc-600">
                  ({(l.confidence * 100).toFixed(0)}%)
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
