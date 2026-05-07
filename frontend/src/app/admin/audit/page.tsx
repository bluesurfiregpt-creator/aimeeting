"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type AuditEntry } from "@/lib/api";

const ACTION_TONE: Record<string, string> = {
  "meeting.create": "bg-emerald-500/15 text-emerald-300",
  "meeting.delete": "bg-rose-500/15 text-rose-300",
  "agent.create": "bg-violet-500/15 text-violet-300",
  "agent.update": "bg-violet-500/15 text-violet-300",
  "agent.delete": "bg-rose-500/15 text-rose-300",
};

export default function AuditAdmin() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.listAudit(filter || undefined);
      setRows(r);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div>
      <p className="text-sm text-zinc-500">
        本工作空间的写操作记录(创建/删除会议、Agent、记忆等)。每条记录都带时间、操作人、对象。仅本空间可见。
      </p>

      <section className="mt-6 flex items-center gap-2">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="按 action 过滤(如 meeting.create / agent.delete)"
          className="flex-1 rounded-lg border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
        />
        <button
          onClick={refresh}
          className="rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-ink-800 transition"
        >
          刷新
        </button>
      </section>

      <section className="mt-6">
        {loading ? (
          <p className="text-sm text-zinc-600">加载中...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-zinc-600">没有匹配的记录。</p>
        ) : (
          <ul className="divide-y divide-ink-800 rounded-xl border border-ink-700 bg-ink-900">
            {rows.map((r) => {
              const tone = ACTION_TONE[r.action] ?? "bg-ink-800 text-zinc-300";
              return (
                <li key={r.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span>{new Date(r.ts).toLocaleString("zh-CN")}</span>
                    <span className={`rounded-full px-2 py-0.5 font-mono ${tone}`}>{r.action}</span>
                    <span className="text-zinc-400">by {r.user_name ?? "—"}</span>
                    {r.target_type && (
                      <span className="text-zinc-600">
                        target: {r.target_type}/{r.target_id?.slice(0, 8)}…
                      </span>
                    )}
                  </div>
                  {r.payload && Object.keys(r.payload).length > 0 && (
                    <pre className="mt-1 overflow-x-auto rounded bg-ink-950 p-2 font-mono text-xs text-zinc-400">
                      {JSON.stringify(r.payload, null, 2)}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
