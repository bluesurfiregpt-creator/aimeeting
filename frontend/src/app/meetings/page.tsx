"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type Meeting, type User } from "@/lib/api";

const STATUS_TONE: Record<string, string> = {
  scheduled: "bg-zinc-700/40 text-zinc-400",
  ongoing: "bg-emerald-500/15 text-emerald-300",
  finished: "bg-amber-500/15 text-amber-300",
  processed: "bg-accent-500/15 text-accent-400",
};

const STATUS_LABEL: Record<string, string> = {
  scheduled: "未开始",
  ongoing: "进行中",
  finished: "刚结束",
  processed: "已处理",
};

export default function MeetingsListPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [users, setUsers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([api.listMeetings(), api.listUsers()])
      .then(([ms, us]) => {
        if (!alive) return;
        setMeetings(ms);
        setUsers(Object.fromEntries((us as User[]).map((u) => [u.id, u.name])));
      })
      .catch(console.error)
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">history</div>
          <h1 className="mt-1 text-2xl font-semibold text-white">会议历史</h1>
        </div>
        <Link href="/" className="text-sm text-zinc-400 hover:text-white">← 首页</Link>
      </header>

      {loading ? (
        <p className="mt-8 text-sm text-zinc-600">加载中...</p>
      ) : meetings.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-600">还没开过会。</p>
      ) : (
        <ul className="mt-6 divide-y divide-ink-800 rounded-xl border border-ink-700 bg-ink-900">
          {meetings.map((m) => {
            const tone = STATUS_TONE[m.status] ?? STATUS_TONE.scheduled;
            const label = STATUS_LABEL[m.status] ?? m.status;
            const date = m.started_at ? new Date(m.started_at) : null;
            return (
              <li key={m.id}>
                <Link
                  href={`/meeting/${m.id}`}
                  className="flex items-start justify-between px-4 py-4 transition hover:bg-ink-800/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${tone}`}>{label}</span>
                      <span className="truncate text-sm font-medium text-white">{m.title}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                      {date && <span>{date.toLocaleString("zh-CN")}</span>}
                      <span>
                        参会:{" "}
                        {m.attendee_user_ids.length === 0
                          ? "无标记"
                          : m.attendee_user_ids
                              .map((id) => users[id])
                              .filter(Boolean)
                              .join("、")}
                      </span>
                    </div>
                  </div>
                  <span className="ml-4 text-zinc-500">→</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
