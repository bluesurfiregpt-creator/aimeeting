"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type AuditEntry } from "@/lib/api";

const ACTION_TONE: Record<string, string> = {
  "meeting.create": "bg-emerald-500/15 text-emerald-300",
  "meeting.delete": "bg-rose-500/15 text-rose-300",
  "agent.create": "bg-violet-500/15 text-violet-300",
  "agent.update": "bg-violet-500/15 text-violet-300",
  "agent.delete": "bg-rose-500/15 text-rose-300",
  "kb.create": "bg-sky-500/15 text-sky-300",
  "kb.upload": "bg-sky-500/15 text-sky-300",
  "kb.delete": "bg-rose-500/15 text-rose-300",
  "kb_sedimentation.approve": "bg-emerald-500/15 text-emerald-300",
  "kb_sedimentation.reject": "bg-rose-500/15 text-rose-300",
  "memory_draft.approve": "bg-emerald-500/15 text-emerald-300",
  "memory_draft.reject": "bg-rose-500/15 text-rose-300",
  "agent_template.commit": "bg-violet-500/15 text-violet-300",
};

// v26.8-UI-07: action 中文摘要
const ACTION_LABEL: Record<string, string> = {
  "meeting.create": "创建会议",
  "meeting.delete": "删除会议",
  "agent.create": "创建 AI 专家",
  "agent.update": "更新 AI 专家",
  "agent.delete": "删除 AI 专家",
  "kb.create": "创建知识库",
  "kb.update": "更新知识库",
  "kb.upload": "上传 KB 文档",
  "kb.delete": "删除知识库",
  "kb_sedimentation.approve": "批准 KB 沉淀",
  "kb_sedimentation.reject": "驳回 KB 沉淀",
  "memory_draft.approve": "批准长期记忆",
  "memory_draft.reject": "驳回长期记忆",
  "agent_template.commit": "AI 模板批量创建",
  "team.create_invite": "邀请成员",
  "team.update_member": "改成员角色",
  "team.remove_member": "移除成员",
};

// v26.8-UI-07: 按类型聚合的下拉分类
const ACTION_GROUPS: { label: string; prefixes: string[] }[] = [
  { label: "全部", prefixes: [] },
  { label: "会议", prefixes: ["meeting."] },
  { label: "AI 专家", prefixes: ["agent.", "agent_template."] },
  { label: "知识库", prefixes: ["kb.", "kb_sedimentation."] },
  { label: "长期记忆", prefixes: ["memory.", "memory_draft."] },
  { label: "成员/团队", prefixes: ["team.", "access."] },
];

// v26.8-UI-07: 相对时间
function fmtRelative(iso: string): string {
  try {
    const t = new Date(iso).getTime();
    const diff = Date.now() - t;
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return "刚刚";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} 分钟前`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} 小时前`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day} 天前`;
    return new Date(iso).toLocaleDateString("zh-CN");
  } catch {
    return iso;
  }
}

// v26.8-UI-07: 一行摘要 (从 payload 提取人类可读)
function payloadSummary(r: AuditEntry): string | null {
  if (!r.payload || typeof r.payload !== "object") return null;
  const p = r.payload as Record<string, unknown>;
  const name = typeof p.name === "string" ? p.name : null;
  if (name) return name;
  const title = typeof p.title === "string" ? p.title : null;
  if (title) return title;
  if (typeof p.count === "number") return `${p.count} 个`;
  if (typeof p.email === "string") return p.email;
  if (typeof p.reason === "string" && p.reason) return `理由: ${p.reason.slice(0, 60)}`;
  return null;
}

export default function AuditAdmin() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [groupIdx, setGroupIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

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

  // 客户端 二次 group 过滤
  const filtered = rows.filter((r) => {
    const g = ACTION_GROUPS[groupIdx];
    if (!g || g.prefixes.length === 0) return true;
    return g.prefixes.some((p) => r.action.startsWith(p));
  });

  return (
    <div>
      <p className="text-sm text-zinc-500">
        本工作空间的写操作记录(创建/删除会议、Agent、记忆等)。每条记录都带时间、操作人、对象。仅本空间可见。
      </p>

      <section className="mt-6 flex flex-wrap items-center gap-2">
        {/* v26.8-UI-07: 分类下拉 (用户不必知道 action 命名规范) */}
        <select
          value={groupIdx}
          onChange={(e) => setGroupIdx(parseInt(e.target.value, 10) || 0)}
          className="rounded-lg border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm text-white focus:border-accent-500 focus:outline-none"
        >
          {ACTION_GROUPS.map((g, i) => (
            <option key={g.label} value={i}>
              {g.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="🔍 搜索操作 / 对象 / 操作人"
          className="flex-1 rounded-lg border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
        />
        <button
          onClick={refresh}
          className="rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-ink-800 transition"
        >
          🔄 刷新
        </button>
      </section>

      <section className="mt-6">
        {loading ? (
          <p className="text-sm text-zinc-600">加载中...</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-zinc-600">没有匹配的记录。</p>
        ) : (
          <ul className="divide-y divide-ink-800 rounded-xl border border-ink-700 bg-ink-900">
            {filtered.map((r) => {
              const tone = ACTION_TONE[r.action] ?? "bg-ink-800 text-zinc-300";
              const label = ACTION_LABEL[r.action] ?? r.action;
              const summary = payloadSummary(r);
              const expanded = expandedIds.has(r.id);
              const hasPayload = r.payload && Object.keys(r.payload).length > 0;
              return (
                <li key={r.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    {/* v26.8-UI-07: 相对时间 + tooltip 绝对 */}
                    <span title={new Date(r.ts).toLocaleString("zh-CN")}>
                      {fmtRelative(r.ts)}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 ${tone}`}>{label}</span>
                    <span className="text-zinc-400">by {r.user_name ?? "—"}</span>
                    {summary && (
                      <span className="text-zinc-300">→ {summary}</span>
                    )}
                    {r.target_type && (
                      <span className="text-zinc-600 font-mono text-[10px]">
                        {r.target_type}/{r.target_id?.slice(0, 8)}…
                      </span>
                    )}
                    {hasPayload && (
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedIds((s) => {
                            const next = new Set(s);
                            if (next.has(r.id)) next.delete(r.id);
                            else next.add(r.id);
                            return next;
                          });
                        }}
                        className="ml-auto text-[10px] text-accent-400 hover:text-accent-500"
                      >
                        {expanded ? "← 收起" : "详情 ↓"}
                      </button>
                    )}
                  </div>
                  {/* v26.8-UI-07: JSON 默认折叠, 点 详情 展开 */}
                  {hasPayload && expanded && (
                    <pre className="mt-2 overflow-x-auto rounded bg-ink-950 p-2 font-mono text-[11px] text-zinc-400">
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
