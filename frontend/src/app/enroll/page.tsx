"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, type User } from "@/lib/api";
import { startAudioCapture, type AudioCaptureHandle } from "@/lib/audioCapture";

const TARGET_SECONDS = 30;
const MAX_SECONDS = 60;

export default function EnrollPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [name, setName] = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const captureRef = useRef<AudioCaptureHandle | null>(null);
  const bufRef = useRef<Uint8Array[]>([]);
  const tickRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      setUsers(await api.listUsers());
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const start = useCallback(async () => {
    if (!name.trim()) {
      setStatus("请先填写姓名");
      return;
    }
    setStatus("正在请求麦克风...");
    bufRef.current = [];
    try {
      const cap = await startAudioCapture((frame) => {
        bufRef.current.push(new Uint8Array(frame));
      });
      captureRef.current = cap;
      setRecording(true);
      setSeconds(0);
      setStatus("录音中... 自然说话即可（建议 30-60 秒，到 60s 自动停止）");
      const startedAt = performance.now();
      tickRef.current = window.setInterval(() => {
        const s = (performance.now() - startedAt) / 1000;
        setSeconds(s);
        if (s >= MAX_SECONDS) void stop();
      }, 200);
    } catch (e) {
      console.error(e);
      setStatus(e instanceof Error ? `麦克风启动失败：${e.message}` : "麦克风启动失败");
    }
  }, [name]);

  const stop = useCallback(async () => {
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    try {
      await captureRef.current?.stop();
    } catch {}
    captureRef.current = null;
    setRecording(false);

    if (seconds < 5 && bufRef.current.length === 0) {
      setStatus("没有录到音频");
      return;
    }
    const totalLen = bufRef.current.reduce((n, b) => n + b.byteLength, 0);
    const merged = new Uint8Array(totalLen);
    let p = 0;
    for (const b of bufRef.current) {
      merged.set(b, p);
      p += b.byteLength;
    }
    const blob = new Blob([merged], { type: "application/octet-stream" });

    setStatus("正在创建用户档案 + 上传声纹（pyannoteAI 处理约 5-15s）...");
    setSubmitting(true);
    try {
      const u = await api.createUser(name.trim());
      await api.enrollVoiceprint(u.id, blob);
      setStatus(`✅ ${u.name} 录入成功`);
      setName("");
      await refresh();
    } catch (e) {
      console.error(e);
      setStatus(e instanceof Error ? `❌ 失败：${e.message}` : "❌ 失败");
    } finally {
      setSubmitting(false);
    }
  }, [name, seconds, refresh]);

  useEffect(() => () => {
    if (tickRef.current) window.clearInterval(tickRef.current);
    captureRef.current?.stop().catch(() => {});
  }, []);

  const target = Math.min(seconds / TARGET_SECONDS, 1);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">enroll</div>
          <h1 className="mt-1 text-2xl font-semibold text-white">录入声纹</h1>
        </div>
        <Link href="/" className="text-sm text-zinc-400 hover:text-white">← 首页</Link>
      </header>

      <section className="rounded-xl border border-ink-700 bg-ink-900 p-6">
        <label className="block text-sm text-zinc-400">姓名</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={recording || submitting}
          placeholder="例如：张三"
          className="mt-2 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
        />

        <div className="mt-6">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>录制时长 {seconds.toFixed(1)}s · 目标 30-60s</span>
            <span>{recording ? "录音中" : "未开始"}</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-800">
            <div
              className="h-full bg-accent-500 transition-all duration-200"
              style={{ width: `${target * 100}%` }}
            />
          </div>
        </div>

        <div className="mt-6 flex gap-2">
          {!recording ? (
            <button
              onClick={start}
              disabled={submitting || !name.trim()}
              className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white shadow disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-400 transition"
            >
              开始录音
            </button>
          ) : (
            <button
              onClick={stop}
              className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white shadow hover:bg-rose-400 transition"
            >
              停止并上传
            </button>
          )}
        </div>

        {status ? (
          <p className="mt-4 text-sm text-zinc-400">{status}</p>
        ) : (
          <p className="mt-4 text-xs text-zinc-600">
            提示：找一个安静的环境，自然朗读或说话 30 秒以上。说什么内容不重要，重点是「你的声音」要清晰、有起伏。
          </p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium text-zinc-300">已录入的人</h2>
        {users.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600">还没有人录入。</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink-800 rounded-xl border border-ink-700 bg-ink-900">
            {users.map((u) => (
              <li key={u.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-white">{u.name}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    u.has_voiceprint
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-zinc-700/40 text-zinc-400"
                  }`}
                >
                  {u.has_voiceprint ? "✓ 声纹已录入" : "未录入"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
