"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type Agent, type AgendaItem, type Me, type User } from "@/lib/api";

// v26.3.1: 谁能创建 auto 会议.跟后端 require_leader_or_admin 对齐.
const AUTO_CREATE_ROLES = new Set(["owner", "admin", "leader"]);

type DraftAgendaRow = { title: string; time_budget_min: string }; // string for input

// v25.7-#1: agent 颜色名 → Tailwind class 映射(meeting page 已有,这里复制)
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

export default function Home() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickedAgents, setPickedAgents] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  // M3.0: agenda items (optional). Each row: title (required) + budget min.
  // `agenda` is committed to the API only when at least one row has a title.
  // Empty rows are dropped on submit; the trailing empty row is the "add" UX.
  const [agendaRows, setAgendaRows] = useState<DraftAgendaRow[]>([
    { title: "", time_budget_min: "" },
  ]);
  // v26.3 召集人模式 — hybrid (默认,v26.0/.1/.2 行为) / auto (全 AI 自主)
  const [mode, setMode] = useState<"hybrid" | "auto">("hybrid");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // v26.3.1: 当前用户 role,expert/member 不能选 auto 模式.
  // v26.3.1-fix1: meLoaded 三态 (null = 未拉, Me = 已拉成功, false = 拉失败) 避免 SSR
  // 瞬间 disabled='' 闪烁 — 默认乐观给可点状态,fetch 完发现 expert/member 再 disable.
  const [me, setMe] = useState<Me | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  // 未加载完 → 默认 enable (绝大多数用户是 leader_or_admin);加载完再判定.
  const canCreateAuto = !meLoaded || (!!me && AUTO_CREATE_ROLES.has(me.role));

  useEffect(() => {
    api
      .listUsers()
      .then(setUsers)
      .catch((e) => setErr(String(e)));
    // v25.7-#1: 拉 active AI 专家列表
    api
      .listAgents()
      .then((rows) => setAgents(rows.filter((a) => a.is_active)))
      .catch(() => setAgents([]));
    // v26.3.1: 拉 me 用于决定是否显示 auto 模式 radio
    api.me()
      .then((m) => { setMe(m); setMeLoaded(true); })
      .catch(() => { setMe(null); setMeLoaded(true); });
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
    // v26.3 auto 前端校验
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
        Array.from(pickedAgents),  // v25.7-#1
        mode,  // v26.3
      );
      // v26.3 auto 模式直接跳 orchestrate 控制台
      router.push(mode === "auto" ? `/meeting/${m.id}/orchestrate` : `/meeting/${m.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "创建失败");
      setBusy(false);
    }
  };

  const updateAgendaRow = (idx: number, key: "title" | "time_budget_min", v: string) => {
    setAgendaRows((rows) => {
      const next = rows.map((r, i) => (i === idx ? { ...r, [key]: v } : r));
      // If user just typed in the last row's title, append a new empty row
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
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-12">
      <header className="text-center">
        <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">aimeeting</div>
        <h1 className="mt-3 text-4xl font-semibold leading-tight text-white sm:text-5xl">
          让会议拥有<span className="text-accent-400">记忆与专家</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm text-zinc-400">
          实时字幕 · 声纹识别 · AI 专家参会 · 长期记忆
        </p>
        {/* v26.5-WS: 首页只留 2 个核心链接 (会议历史 + 工作站).
            原先的 5 个链接 (声纹/AI/LLM/记忆/历史) 已合并到 /me/profile 工作站. */}
        <div className="mt-4 flex justify-center gap-4 text-xs">
          <Link href="/meetings" className="text-zinc-500 hover:text-accent-400">
            📚 会议历史
          </Link>
          <span className="text-zinc-700">·</span>
          <Link href="/me/profile" className="text-zinc-500 hover:text-accent-400">
            👤 我的工作站
          </Link>
        </div>
      </header>

      <section className="mt-12 rounded-xl border border-ink-700 bg-ink-900 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-300">新建会议</h2>
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

        {/* v26.3 会议模式选择 */}
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

        {/* M3.0: 议程（可选）— 填了就启动 agenda monitor 跑题/时间预警 */}
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

        {/* v25.7-#1: 邀请 AI 专家(可多选;不勾任何 = 无 AI 触发) */}
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <div className="text-xs text-zinc-500">
              邀请 AI 专家
              {mode === "auto" ? (
                <span className="ml-1 text-amber-300">
                  (AI 自主模式必勾 · 至少 3 个 · 系统会让它们轮流发言;
                  必须先在 admin 给每个 AI 专家绑科室账号才能接任务)
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
          {agents.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-600" data-testid="no-agents-hint">
              还没有 AI 专家。去 <Link href="/me/profile/agents" className="text-accent-400">AI 配置</Link> 创建。
            </p>
          ) : (
            // v26.6-04: 按 primary_user_name 分组 (用 domain 作为 fallback);
            // 让 用户 一眼能看出 "邀请房屋安全科长的 3 个 AI" / "物业科的 2 个 AI"
            <div className="mt-3 space-y-3" data-testid="agent-picker">
              {(() => {
                // 分组 key: primary_user_name 优先 (主科室), domain fallback, "未分组" 兜底
                const groups: Record<string, typeof agents> = {};
                for (const a of agents) {
                  const key = a.primary_user_name
                    ? `👤 ${a.primary_user_name}`
                    : a.domain
                      ? `📂 ${a.domain}`
                      : "未分组";
                  if (!groups[key]) groups[key] = [];
                  groups[key].push(a);
                }
                const sortedGroups = Object.entries(groups).sort((a, b) =>
                  a[0].localeCompare(b[0]),
                );
                return sortedGroups.map(([groupName, groupAgents]) => (
                  <div key={groupName}>
                    <div className="mb-1.5 flex items-center gap-2 text-xs text-zinc-500">
                      <span className="font-medium">{groupName}</span>
                      <span className="text-zinc-700">·</span>
                      <span>{groupAgents.length} AI</span>
                    </div>
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {groupAgents.map((a) => {
                        const tone =
                          AGENT_COLOR_BG[a.color || "violet"] || AGENT_COLOR_BG.violet;
                        const isOn = pickedAgents.has(a.id);
                        return (
                          <li key={a.id}>
                            <label
                              className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 transition ${
                                isOn
                                  ? tone
                                  : "border-ink-700 bg-ink-950 text-zinc-300 hover:border-zinc-600"
                              }`}
                            >
                              <span className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={isOn}
                                  onChange={() => toggleAgent(a.id)}
                                  className="h-4 w-4 accent-accent-500"
                                />
                                🤖 {a.name}
                              </span>
                              {a.domain && (
                                <span className="ml-2 truncate text-[10px] text-zinc-500">
                                  {a.domain}
                                </span>
                              )}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ));
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
      </section>

      <p className="mt-12 text-center text-xs text-zinc-600">
        Phase 1 + A · {new Date().getFullYear()}
      </p>
    </main>
  );
}
