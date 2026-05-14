"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type Agent, type AgendaItem, type Me, type User } from "@/lib/api";
import { SkeletonAgentGrid } from "@/components/Skeleton";

// v26.3.1: 谁能创建 auto 会议.跟后端 require_leader_or_admin 对齐.
const AUTO_CREATE_ROLES = new Set(["owner", "admin", "leader"]);

type DraftAgendaRow = { title: string; time_budget_min: string };

// v25.7-#1: agent 颜色名 → Tailwind class 映射(meeting page 也有,这里重复 一份)
const AGENT_COLOR_BG: Record<string, string> = {
  violet: "bg-violet-500/15 text-violet-200 border-violet-500/30",
  rose: "bg-rose-500/15 text-rose-200 border-rose-500/30",
  emerald: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30",
  amber: "bg-amber-500/15 text-amber-200 border-amber-500/30",
  sky: "bg-sky-500/15 text-sky-200 border-sky-500/30",
  cyan: "bg-cyan-500/15 text-cyan-200 border-cyan-500/30",
  lime: "bg-lime-500/15 text-lime-200 border-lime-500/30",
  fuchsia: "bg-fuchsia-500/15 text-fuchsia-200 border-fuchsia-500/30",
  blue: "bg-blue-500/15 text-blue-200 border-blue-500/30",
  green: "bg-green-500/15 text-green-200 border-green-500/30",
  orange: "bg-orange-500/15 text-orange-200 border-orange-500/30",
  red: "bg-red-500/15 text-red-200 border-red-500/30",
  teal: "bg-teal-500/15 text-teal-200 border-teal-500/30",
  indigo: "bg-indigo-500/15 text-indigo-200 border-indigo-500/30",
  pink: "bg-pink-500/15 text-pink-200 border-pink-500/30",
  yellow: "bg-yellow-500/15 text-yellow-200 border-yellow-500/30",
};

// v26.13.2-fix3: agent.color → hex (头像 圈环 + 占位背景 用), 跟 首页 一套.
const AGENT_COLOR_HEX: Record<string, string> = {
  violet: "#8b5cf6", rose: "#f43f5e", emerald: "#10b981", amber: "#f59e0b",
  sky: "#0ea5e9", cyan: "#06b6d4", lime: "#84cc16", fuchsia: "#d946ef",
  blue: "#3b82f6", green: "#22c55e", orange: "#f97316", red: "#ef4444",
  teal: "#14b8a6", indigo: "#6366f1", pink: "#ec4899", yellow: "#eab308",
};

function formatInvokeCount(n: number): string {
  if (n < 10000) return `${n} 次`;
  return `${(n / 10000).toFixed(1)} 万次`;
}

// v26.12-Home: 完整会议 表单 —— 抽 成 共享组件, 同时 给 首页 折叠区 (废弃, 留链接) 和
// /meetings/new 独立页 用. 行为 跟 v26.12 之前 首页 主流程 完全 一致, 没 改 业务.
export function AdvancedMeetingForm({
  me,
  meLoaded,
}: {
  me: Me | null;
  meLoaded: boolean;
}) {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickedAgents, setPickedAgents] = useState<Set<string>>(new Set());
  const [agentSearch, setAgentSearch] = useState("");
  // v26.13.2-fix3: collapsedGroups 已 不需要 — 新 picker 是 flat 卡片 grid 不再 分组折叠
  const [title, setTitle] = useState("");
  const [agendaRows, setAgendaRows] = useState<DraftAgendaRow[]>([
    { title: "", time_budget_min: "" },
  ]);
  const [mode, setMode] = useState<"hybrid" | "auto">("hybrid");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const canCreateAuto = !meLoaded || (!!me && AUTO_CREATE_ROLES.has(me.role));

  useEffect(() => {
    api.listUsers().then(setUsers).catch((e) => setErr(String(e)));
    api.listAgents()
      .then((rows) => setAgents(rows.filter((a) => a.is_active)))
      .catch(() => setAgents([]))
      .finally(() => setAgentsLoading(false));
  }, []);

  const toggle = (id: string) => {
    const s = new Set(picked);
    s.has(id) ? s.delete(id) : s.add(id);
    setPicked(s);
  };

  const toggleAgent = (id: string) => {
    const s = new Set(pickedAgents);
    s.has(id) ? s.delete(id) : s.add(id);
    setPickedAgents(s);
  };

  const start = async () => {
    setErr("");
    if (mode === "auto") {
      const validAgendaCount = agendaRows.filter((r) => r.title.trim()).length;
      if (validAgendaCount < 2) {
        setErr("AI 自主会议 至少 2 个议程项");
        return;
      }
      if (pickedAgents.size < 3) {
        setErr("AI 自主会议 至少邀请 3 个 AI 专家");
        return;
      }
    }
    setBusy(true);
    try {
      const cleaned: AgendaItem[] = agendaRows
        .map((r) => ({
          title: r.title.trim(),
          time_budget_min: r.time_budget_min.trim()
            ? Math.max(1, Math.min(600, parseInt(r.time_budget_min, 10) || 0)) || null
            : null,
        }))
        .filter((r) => r.title.length > 0);
      const m = await api.createMeeting(
        title.trim() || `会议 ${new Date().toLocaleString("zh-CN")}`,
        Array.from(picked),
        cleaned.length ? cleaned : null,
        Array.from(pickedAgents),
        mode,
      );
      router.push(mode === "auto" ? `/meeting/${m.id}/orchestrate` : `/meeting/${m.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "创建失败");
      setBusy(false);
    }
  };

  const updateAgendaRow = (idx: number, key: "title" | "time_budget_min", v: string) => {
    setAgendaRows((rows) => {
      const next = rows.map((r, i) => (i === idx ? { ...r, [key]: v } : r));
      if (
        idx === next.length - 1 &&
        key === "title" &&
        v.trim().length > 0
      ) {
        next.push({ title: "", time_budget_min: "" });
      }
      return next;
    });
  };

  const removeAgendaRow = (idx: number) => {
    setAgendaRows((rows) => {
      const next = rows.filter((_, i) => i !== idx);
      return next.length ? next : [{ title: "", time_budget_min: "" }];
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-300">完整会议</h3>
        <Link href="/me/profile/voiceprints" className="text-xs text-accent-400 hover:text-accent-500">
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

      <div className="mt-4" data-testid="mode-selector">
        <div className="text-xs text-zinc-500">会议模式</div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label
            className={`flex cursor-pointer flex-col rounded-lg border px-3 py-2.5 transition ${
              mode === "hybrid"
                ? "border-accent-500 bg-accent-500/10 text-white"
                : "border-ink-700 bg-ink-950 text-zinc-300 hover:border-zinc-600"
            }`}
          >
            <div className="flex items-center gap-2">
              <input
                type="radio"
                checked={mode === "hybrid"}
                onChange={() => setMode("hybrid")}
                className="h-4 w-4 accent-accent-500"
              />
              <span className="text-sm font-medium">👥 真人 + AI 混合(默认)</span>
            </div>
            <span className="ml-6 mt-0.5 text-[11px] text-zinc-500">
              传统会议体验.真人发言 + @AI 触发 + 关键词激活 AI 专家.
            </span>
          </label>
          <label
            className={`flex flex-col rounded-lg border px-3 py-2.5 transition ${
              !canCreateAuto
                ? "cursor-not-allowed border-ink-800 bg-ink-950 text-zinc-600 opacity-60"
                : mode === "auto"
                ? "cursor-pointer border-amber-500 bg-amber-500/10 text-white"
                : "cursor-pointer border-ink-700 bg-ink-950 text-zinc-300 hover:border-zinc-600"
            }`}
            title={!canCreateAuto ? "仅 owner/admin/leader 角色可创建 AI 自主会议" : undefined}
          >
            <div className="flex items-center gap-2">
              <input
                type="radio"
                checked={mode === "auto"}
                onChange={() => canCreateAuto && setMode("auto")}
                disabled={!canCreateAuto}
                className="h-4 w-4 accent-amber-500 disabled:cursor-not-allowed"
              />
              <span className="text-sm font-medium">
                🤖 AI 自主会议(v26.3){!canCreateAuto && " 🔒"}
              </span>
            </div>
            <span className="ml-6 mt-0.5 text-[11px] text-zinc-500">
              {canCreateAuto ? (
                <>
                  召集人 + N 个 AI 专家,系统自动推进议程,AI 轮流发言收敛共识,
                  无需真人参会.要求 ≥2 议程 + ≥3 AI 专家.
                </>
              ) : (
                <>仅 owner / admin / leader 角色可创建.跨科室决策需领导召集.</>
              )}
            </span>
          </label>
        </div>
      </div>

      <div className="mt-4" data-testid="agenda-section">
        <div className="text-xs text-zinc-500">
          议程项
          {mode === "auto" ? (
            <span className="ml-1 text-amber-300">
              (AI 自主模式必填 · 至少 2 项 · 系统按顺序自动推进)
            </span>
          ) : (
            <span> (可选 · 填了系统会自动监督跑题 + 时间预算)</span>
          )}
        </div>
        <ul className="mt-2 space-y-2">
          {agendaRows.map((r, i) => (
            <li key={i} className="flex items-center gap-2" data-testid={`agenda-row-${i}`}>
              <span className="w-6 shrink-0 text-right text-xs text-zinc-600">{i + 1}.</span>
              <input
                data-testid={`agenda-title-${i}`}
                type="text"
                value={r.title}
                onChange={(e) => updateAgendaRow(i, "title", e.target.value)}
                placeholder="议程项（如：合规风险评估）"
                className="flex-1 rounded-lg border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
              />
              <input
                data-testid={`agenda-budget-${i}`}
                type="number"
                min={1}
                max={600}
                value={r.time_budget_min}
                onChange={(e) => updateAgendaRow(i, "time_budget_min", e.target.value)}
                placeholder="分钟"
                className="w-20 rounded-lg border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
              />
              {agendaRows.length > 1 || r.title.trim() ? (
                <button
                  type="button"
                  data-testid={`agenda-remove-${i}`}
                  onClick={() => removeAgendaRow(i)}
                  className="shrink-0 text-xs text-zinc-600 hover:text-rose-400"
                  title="删除该议程项"
                >
                  ✕
                </button>
              ) : (
                <span className="w-4" />
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4">
        <div className="text-xs text-zinc-500">
          勾选参会人（须先在「录入声纹」页录过）
          {mode === "auto" && (
            <span className="ml-1 text-amber-300">
              (AI 自主模式 不需勾真人;召集人即你自己)
            </span>
          )}
        </div>
        {users.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600">
            还没有人录入声纹 — 先去 <Link href="/me/profile/voiceprints" className="text-accent-400">录入</Link>。
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

      <div className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-zinc-500">
            邀请 AI 专家
            {pickedAgents.size > 0 && (
              <span className="ml-2 rounded-full bg-accent-500/20 px-2 py-0.5 text-[10px] font-medium text-accent-300">
                已选 {pickedAgents.size}
              </span>
            )}
            {mode === "auto" ? (
              <span className="ml-1 text-amber-300">
                (AI 自主模式必勾 · 至少 3 个)
              </span>
            ) : (
              <span className="text-zinc-600">
                {" "}(可多选;不勾则会议中没有 AI 自动发言)
              </span>
            )}
          </div>
          <Link href="/me/profile/agents" className="text-xs text-zinc-600 hover:text-accent-400">
            + 管理 AI 专家
          </Link>
        </div>
        {agents.length > 0 && (
          <div className="mt-2 space-y-2">
            <input
              type="text"
              value={agentSearch}
              onChange={(e) => setAgentSearch(e.target.value)}
              placeholder="🔍 搜索 AI 专家 (按名字 / 外号 / 领域 / 关键词)"
              className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
            />
            {pickedAgents.size > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {Array.from(pickedAgents).slice(0, 10).map((aid) => {
                  const a = agents.find((x) => x.id === aid);
                  if (!a) return null;
                  // v26.12-Home: nickname 优先 显示
                  const dn = a.nickname?.trim() || a.name;
                  return (
                    <span
                      key={aid}
                      className="inline-flex items-center gap-1 rounded-full bg-accent-500/15 px-2 py-0.5 text-[10px] text-accent-300"
                    >
                      🤖 {dn}
                      <button
                        type="button"
                        onClick={() => toggleAgent(aid)}
                        className="text-accent-200 hover:text-rose-300"
                        title="移除"
                      >
                        ✕
                      </button>
                    </span>
                  );
                })}
                {pickedAgents.size > 10 && (
                  <span className="text-[10px] text-zinc-500">
                    + 还有 {pickedAgents.size - 10}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
        {agentsLoading ? (
          <div className="mt-3">
            <SkeletonAgentGrid items={8} />
          </div>
        ) : agents.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600" data-testid="no-agents-hint">
            还没有 AI 专家。去 <Link href="/me/profile/agents" className="text-accent-400">AI 配置</Link> 创建。
          </p>
        ) : (
          // v26.13.2-fix3: 改 折叠分组 list → 4-up 卡片 grid (跟 首页 v26.12-Home 一套).
          // 字体 不再 小, 信息 不再 一行 挤. 整 卡片 click toggle 多选, 选中 紫边 + ✓ 角标.
          <div className="mt-3" data-testid="agent-picker">
            {(() => {
              const q = agentSearch.trim().toLowerCase();
              const filtered = q
                ? agents.filter((a) => {
                    const hay = [
                      a.name,
                      a.nickname ?? "",
                      a.domain ?? "",
                      ...(a.keywords ?? []),
                    ].join(" ").toLowerCase();
                    return hay.includes(q);
                  })
                : agents;
              if (filtered.length === 0) {
                return (
                  <p className="rounded-lg border border-ink-700 bg-ink-950 p-3 text-center text-xs text-zinc-500">
                    没找到匹配「{q}」的 AI 专家
                  </p>
                );
              }
              return (
                <ul className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {filtered.map((a) => {
                    const isOn = pickedAgents.has(a.id);
                    const colorHex = AGENT_COLOR_HEX[a.color || "violet"] || AGENT_COLOR_HEX.violet;
                    const dn = a.nickname?.trim() || a.name;
                    const initial = dn.slice(0, 1).toUpperCase();
                    return (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => toggleAgent(a.id)}
                          className={`group/agent relative flex h-full w-full flex-col rounded-xl border p-3 text-left transition ${
                            isOn
                              ? "border-accent-500 bg-accent-500/10 shadow-lg shadow-accent-500/10"
                              : "border-ink-700 bg-ink-900 hover:-translate-y-0.5 hover:border-ink-600 hover:shadow-md"
                          }`}
                        >
                          {/* 选中 ✓ 角标 */}
                          {isOn && (
                            <span
                              className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-accent-500 text-[10px] font-bold text-white shadow"
                              aria-label="已选"
                            >
                              ✓
                            </span>
                          )}

                          {/* 头部: 头像 + 名字 + 外号 */}
                          <div className="flex items-start gap-2.5">
                            <div
                              className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full text-sm font-semibold text-white"
                              style={{
                                background: a.avatar_url ? undefined : colorHex,
                                boxShadow: `0 0 0 1.5px ${colorHex}40`,
                              }}
                            >
                              {a.avatar_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={a.avatar_url}
                                  alt={dn}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                initial
                              )}
                            </div>
                            <div className="min-w-0 flex-1 pr-5">
                              <div className="truncate text-sm font-medium text-zinc-100">
                                {dn}
                              </div>
                              {a.nickname?.trim() ? (
                                <div className="truncate text-[10px] text-zinc-500">
                                  〈{a.name}〉
                                </div>
                              ) : a.domain ? (
                                <div className="truncate text-[10px] text-zinc-500">
                                  {a.domain}
                                </div>
                              ) : null}
                            </div>
                          </div>

                          {/* chip 行: domain + 1-2 个 关键词 */}
                          <div className="mt-2 flex flex-wrap gap-1">
                            {a.domain && (
                              <span
                                className={`rounded-full border px-1.5 py-0.5 text-[9px] ${
                                  AGENT_COLOR_BG[a.color || "violet"] || AGENT_COLOR_BG.violet
                                }`}
                              >
                                {a.domain}
                              </span>
                            )}
                            {(a.keywords ?? []).slice(0, 2).map((k) => (
                              <span
                                key={k}
                                className="rounded-full border border-ink-700 bg-ink-950 px-1.5 py-0.5 text-[9px] text-zinc-400"
                              >
                                {k}
                              </span>
                            ))}
                          </div>

                          {/* persona 截 2 行 */}
                          <p className="mt-2 line-clamp-2 min-h-[2.2rem] text-[11px] leading-4 text-zinc-400">
                            {a.persona?.trim() || "暂无介绍"}
                          </p>

                          {/* 底部: 调用次数 + primary_user (mt-auto 顶到底) */}
                          <div className="mt-auto flex items-center justify-between gap-1 border-t border-ink-800 pt-1.5 text-[10px] text-zinc-500">
                            <span>💬 {formatInvokeCount(a.invoke_count ?? 0)}</span>
                            {a.primary_user_name && (
                              <span className="truncate" title={`primary_user: ${a.primary_user_name}`}>
                                🛠 {a.primary_user_name}
                              </span>
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              );
            })()}
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={start}
          disabled={busy}
          className={`rounded-lg px-5 py-2.5 text-sm font-medium shadow disabled:cursor-not-allowed disabled:opacity-50 transition ${
            mode === "auto"
              ? "bg-amber-500 text-amber-950 hover:bg-amber-400"
              : "bg-accent-500 text-white hover:bg-accent-400"
          }`}
        >
          {busy
            ? "创建中..."
            : mode === "auto"
            ? "🤖 创建 AI 自主会议"
            : "开始会议"}
        </button>
        <span className="text-xs text-zinc-600">
          {mode === "auto"
            ? "创建后会跳转到 Orchestrate 控制台,点 「启动」 让 AI 开会."
            : "创建后会跳转到会议室，开始字幕；结束后系统自动给每句话贴姓名。"}
        </span>
      </div>
      {err && <p className="mt-3 text-sm text-rose-400">{err}</p>}
    </div>
  );
}
