"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { startAudioCapture, type AudioCaptureHandle } from "@/lib/audioCapture";
import { openSttSocket, type SttEvent, type SttSocket } from "@/lib/sttSocket";
import { api, type TranscriptLine } from "@/lib/api";

type LiveLine = {
  id: string;
  text: string;
  final: boolean;
  startMs: number | null;
  endMs: number | null;
  // Filled in by speaker identification, asynchronously, possibly multiple
  // times during the meeting as more audio is processed.
  speakerName: string | null;
  speakerUserId: string | null;
};

type Phase = "idle" | "live" | "ended";

function backendWsUrl(meetingId: string): string {
  if (typeof window === "undefined") return "";
  const isLocalDev = window.location.hostname === "localhost";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = isLocalDev ? "localhost:8000" : window.location.host;
  return `${proto}//${host}/ws/stt?meeting_id=${encodeURIComponent(meetingId)}`;
}

const PALETTE = [
  "text-sky-300",
  "text-emerald-300",
  "text-violet-300",
  "text-rose-300",
  "text-amber-300",
  "text-teal-300",
];
function colorOf(uid: string | null): string {
  if (!uid) return "text-zinc-500";
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export default function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: meetingId } = use(params);

  const [phase, setPhase] = useState<Phase>("idle");
  const [statusText, setStatusText] = useState("待开始");
  const [lines, setLines] = useState<LiveLine[]>([]);

  const captureRef = useRef<AudioCaptureHandle | null>(null);
  const socketRef = useRef<SttSocket | null>(null);
  const interimRef = useRef<string | null>(null);
  const nextIdRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const phaseRef = useRef<Phase>(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Refresh the speaker names by re-fetching /result and merging by start_ms
  // (or by index as a fallback). Triggered by the WS `speakers_updated` event,
  // and once more after the meeting ends.
  const refreshSpeakers = useCallback(async () => {
    try {
      const r = await api.meetingResult(meetingId);
      if (r.lines.length === 0) return;
      setLines((prev) => mergeSpeakers(prev, r.lines));
      if (r.identification_status === "ready") {
        setStatusText("✅ 识别完成");
      }
    } catch (e) {
      console.warn("refreshSpeakers failed", e);
    }
  }, [meetingId]);

  const handleEvent = useCallback((e: SttEvent) => {
    if (e.type === "system") {
      if (e.msg === "ready") setStatusText("已连接，开始说话");
      else setStatusText(`系统：${e.msg}`);
      return;
    }
    if (e.type === "speakers_updated") {
      void refreshSpeakers();
      return;
    }
    if (e.type === "transcript") {
      setLines((prev) => {
        const draft = prev.slice();
        if (e.is_final) {
          if (interimRef.current) {
            const idx = draft.findIndex((l) => l.id === interimRef.current);
            if (idx >= 0) {
              draft[idx] = {
                ...draft[idx],
                text: e.text,
                final: true,
                startMs: e.start_ts ?? draft[idx].startMs,
                endMs: e.end_ts ?? draft[idx].endMs,
              };
            }
            interimRef.current = null;
          } else {
            draft.push({
              id: `f${nextIdRef.current++}`,
              text: e.text,
              final: true,
              startMs: e.start_ts ?? null,
              endMs: e.end_ts ?? null,
              speakerName: null,
              speakerUserId: null,
            });
          }
        } else {
          if (interimRef.current) {
            const idx = draft.findIndex((l) => l.id === interimRef.current);
            if (idx >= 0) draft[idx] = { ...draft[idx], text: e.text };
          } else {
            const id = `i${nextIdRef.current++}`;
            interimRef.current = id;
            draft.push({
              id,
              text: e.text,
              final: false,
              startMs: e.start_ts ?? null,
              endMs: e.end_ts ?? null,
              speakerName: null,
              speakerUserId: null,
            });
          }
        }
        return draft;
      });
    }
  }, [refreshSpeakers]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

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
      try { socketRef.current?.close(); } catch {}
    }
  }, [phase, meetingId, handleEvent]);

  const stop = useCallback(async () => {
    setStatusText("会议已结束，正在做最后一次声纹识别…");
    setPhase("ended");
    try { await captureRef.current?.stop(); } catch {}
    captureRef.current = null;
    try { socketRef.current?.close(); } catch {}
    socketRef.current = null;
    interimRef.current = null;
    // Server runs one final identify pass on WS close. Poll until status=ready.
    const poll = async (attemptsLeft: number) => {
      try {
        const r = await api.meetingResult(meetingId);
        setLines((prev) => mergeSpeakers(prev, r.lines));
        if (r.identification_status === "ready") {
          setStatusText("✅ 识别完成");
          return;
        }
        if (r.identification_status === "skipped") {
          setStatusText(`已跳过声纹识别：${r.identification_message ?? ""}`);
          return;
        }
        if (r.identification_status === "failed") {
          setStatusText(`识别失败：${r.identification_message ?? ""}`);
          return;
        }
      } catch (e) {
        console.warn("poll failed", e);
      }
      if (attemptsLeft > 0) {
        window.setTimeout(() => void poll(attemptsLeft - 1), 4000);
      }
    };
    void poll(60); // up to ~4 minutes
  }, [meetingId]);

  useEffect(() => () => {
    captureRef.current?.stop().catch(() => {});
    socketRef.current?.close();
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">会议室</div>
          <h1 className="mt-1 text-2xl font-semibold text-white">实时字幕 · 异步贴姓名</h1>
        </div>
        <Link href="/" className="text-sm text-zinc-400 hover:text-white">← 首页</Link>
      </header>

      <div className="mt-5 flex items-center gap-3">
        <span
          className={`inline-flex h-2.5 w-2.5 rounded-full ${
            phase === "live"
              ? "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/50"
              : phase === "ended"
              ? "bg-amber-400"
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
          结束会议
        </button>
      </div>

      <section
        ref={scrollRef}
        className="mt-6 h-[60vh] overflow-y-auto rounded-xl border border-ink-700 bg-ink-900 p-6"
      >
        {lines.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-600">
            点「开始会议」后开口说话。字幕实时出现，姓名稍后异步贴上。
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
                {l.speakerName ? (
                  <span className={`mr-3 font-medium ${colorOf(l.speakerUserId)}`}>
                    {l.speakerName}
                  </span>
                ) : l.final ? (
                  <span className="mr-3 text-xs text-zinc-600">…</span>
                ) : null}
                <span>{l.text}</span>
                {!l.final ? <span className="ml-1 animate-pulse">▌</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-3 text-xs text-zinc-600">
        STT：DashScope Paraformer · 声纹：pyannoteAI（每 ~45 秒在后台跑一次，名字会逐步贴上）
      </footer>
    </main>
  );
}

/**
 * Merge server-side identified speakers into our local live lines. We match
 * by start_ms — same precision the server stores. Lines without a server
 * counterpart yet keep their existing local state. Lines that gained or
 * changed a speaker are updated in place.
 */
function mergeSpeakers(local: LiveLine[], serverLines: TranscriptLine[]): LiveLine[] {
  if (serverLines.length === 0) return local;
  const byStartMs = new Map<number, TranscriptLine>();
  for (const s of serverLines) {
    if (s.start_ms != null) byStartMs.set(s.start_ms, s);
  }
  let mutated = false;
  const out = local.map((l) => {
    if (l.startMs == null) return l;
    const s = byStartMs.get(l.startMs);
    if (!s) return l;
    if (s.speaker_name === l.speakerName && s.speaker_user_id === l.speakerUserId) {
      return l;
    }
    mutated = true;
    return {
      ...l,
      speakerName: s.speaker_name,
      speakerUserId: s.speaker_user_id,
    };
  });
  return mutated ? out : local;
}
