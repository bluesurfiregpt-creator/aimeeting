"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type User } from "@/lib/api";

export default function Home() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api
      .listUsers()
      .then(setUsers)
      .catch((e) => setErr(String(e)));
  }, []);

  const toggle = (id: string) => {
    const s = new Set(picked);
    s.has(id) ? s.delete(id) : s.add(id);
    setPicked(s);
  };

  const start = async () => {
    setErr("");
    setBusy(true);
    try {
      const m = await api.createMeeting(
        title.trim() || `会议 ${new Date().toLocaleString("zh-CN")}`,
        Array.from(picked),
      );
      router.push(`/meeting/${m.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "创建失败");
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-12">
      <header className="text-center">
        <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">aimeeting</div>
        <h1 className="mt-3 text-4xl font-semibold leading-tight text-white sm:text-5xl">
          让会议拥有<span className="text-accent-400">记忆与专家</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm text-zinc-400">
          实时字幕 · 声纹识别 · AI 专家参会 · 长期记忆
        </p>
        <div className="mt-4 flex justify-center gap-4 text-xs">
          <Link href="/enroll" className="text-zinc-500 hover:text-accent-400">
            录入声纹
          </Link>
          <span className="text-zinc-700">·</span>
          <Link href="/admin/agents" className="text-zinc-500 hover:text-accent-400">
            AI 专家配置
          </Link>
          <span className="text-zinc-700">·</span>
          <Link href="/admin/models" className="text-zinc-500 hover:text-accent-400">
            LLM 模型
          </Link>
          <span className="text-zinc-700">·</span>
          <Link href="/admin/memory" className="text-zinc-500 hover:text-accent-400">
            长期记忆
          </Link>
        </div>
      </header>

      <section className="mt-12 rounded-xl border border-ink-700 bg-ink-900 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-300">新建会议</h2>
          <Link href="/enroll" className="text-xs text-accent-400 hover:text-accent-500">
            + 录入新人声纹
          </Link>
        </div>

        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="会议主题（可不填）"
          className="mt-4 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
        />

        <div className="mt-4">
          <div className="text-xs text-zinc-500">勾选参会人（须先在「录入声纹」页录过）</div>
          {users.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-600">
              还没有人录入声纹 — 先去 <Link href="/enroll" className="text-accent-400">录入</Link>。
              （未勾选的话，会议依然可以开，只是不会贴姓名。）
            </p>
          ) : (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {users.map((u) => (
                <li key={u.id}>
                  <label
                    className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 transition ${
                      picked.has(u.id)
                        ? "border-accent-500 bg-accent-500/10"
                        : "border-ink-700 bg-ink-950 hover:border-ink-700"
                    }`}
                  >
                    <span className="flex items-center gap-2 text-sm text-white">
                      <input
                        type="checkbox"
                        checked={picked.has(u.id)}
                        onChange={() => toggle(u.id)}
                        className="h-4 w-4 accent-accent-500"
                      />
                      {u.name}
                    </span>
                    <span
                      className={`text-xs ${
                        u.has_voiceprint ? "text-emerald-300" : "text-zinc-500"
                      }`}
                    >
                      {u.has_voiceprint ? "✓" : "无声纹"}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={start}
            disabled={busy}
            className="rounded-lg bg-accent-500 px-5 py-2.5 text-sm font-medium text-white shadow disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-400 transition"
          >
            {busy ? "创建中..." : "开始会议"}
          </button>
          <span className="text-xs text-zinc-600">
            提示：创建后会跳转到会议室，开始字幕；结束后系统自动给每句话贴姓名。
          </span>
        </div>
        {err && <p className="mt-3 text-sm text-rose-400">{err}</p>}
      </section>

      <p className="mt-12 text-center text-xs text-zinc-600">
        Phase 1 + A · {new Date().getFullYear()}
      </p>
    </main>
  );
}
