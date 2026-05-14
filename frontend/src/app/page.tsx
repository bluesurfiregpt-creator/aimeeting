"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type Agent, type AgendaItem, type Me, type User } from "@/lib/api";

// v26.3.1: 谁能创建 auto 会议.跟后端 require_leader_or_admin 对齐.
const AUTO_CREATE_ROLES = new Set(["owner", "admin", "leader"]);

type DraftAgendaRow = { title: string; time_budget_min: string };

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

// v26.12-Home: agent.color → 卡片头像 圆环 / footer-button accent 用的 hex.
// 跟 AGENT_COLOR_BG 同一套色系,但 拿 hex 而不是 Tailwind class.
const AGENT_COLOR_HEX: Record<string, string> = {
  violet: "#8b5cf6",
  rose: "#f43f5e",
  emerald: "#10b981",
  amber: "#f59e0b",
  sky: "#0ea5e9",
  cyan: "#06b6d4",
  lime: "#84cc16",
  fuchsia: "#d946ef",
  blue: "#3b82f6",
  green: "#22c55e",
  orange: "#f97316",
  red: "#ef4444",
  teal: "#14b8a6",
  indigo: "#6366f1",
  pink: "#ec4899",
  yellow: "#eab308",
};

// v26.12-Home: 数字 格式化 — "1247" → "1247 次" / "12345" → "1.2 万" 风格统一.
// 截图 是 "23.45 万次使用" / "319.75 万次使用", 我们 学 但 数据 量级 低先 这样:
//  - < 10000: 1247 次
//  - >= 10000: 1.24 万次
function formatInvokeCount(n: number): string {
  if (n < 10000) return `${n} 次`;
  return `${(n / 10000).toFixed(2)} 万次`;
}

// ============================================================================
// v26.12-Home: 首页 重做 — AI 优先 信息架构
// ============================================================================
// 老 首页 是 "新建会议 长表单", AI 是 表单里 一个 checkbox 列表.
// 现在 改成 "AI 卡片 浏览 → 召唤" — AI 是 主角, 老 form 退到 折叠区 (高级).
// 召唤 二选一: 💬 私聊 (mock, v26.13 真实现) / 🎤 邀请到会议 (= 创建 hybrid + prefill).
// ============================================================================
export default function Home() {
  const router = useRouter();

  // === 新 主流程 state ===
  const [me, setMe] = useState<Me | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<"hot" | "new">("hot");
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [summoning, setSummoning] = useState<Agent | null>(null);
  const [summonBusy, setSummonBusy] = useState(false);

  // 搜索 防抖 — 用户 stop typing 300ms 后才 调 API, 避免 每个 字符 都 触发
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    api.me()
      .then((m) => { setMe(m); setMeLoaded(true); })
      .catch(() => { setMe(null); setMeLoaded(true); });
  }, []);

  // 拉 agents — sort / search 变 时 重新 调 backend (active_only=true 只看 启用 的)
  useEffect(() => {
    setAgentsLoading(true);
    api.listAgents({
      sort,
      q: debouncedSearch || undefined,
      active_only: true,
    })
      .then((rows) => setAgents(rows))
      .catch(() => setAgents([]))
      .finally(() => setAgentsLoading(false));
  }, [sort, debouncedSearch]);

  // 提取 所有 domain (用于 chip 行 横向 滚动 筛选)
  const allDomains = useMemo(() => {
    const set = new Set<string>();
    for (const a of agents) {
      if (a.domain) set.add(a.domain);
    }
    return Array.from(set).sort();
  }, [agents]);

  // domain 客户端 进一步 过滤 (排除 不符合 当前 domainFilter 的)
  const visibleAgents = useMemo(() => {
    if (!domainFilter) return agents;
    return agents.filter((a) => a.domain === domainFilter);
  }, [agents, domainFilter]);

  // 召唤 - 邀请入会 = 创建 hybrid 会议 自动 prefill 该 AI → 跳 /meeting/<id>.
  // 现在 简化: 不 查 当前 是否 有 进行中会议. 用户 想 "加入 已有会议" 后期 再加 fallback.
  const handleInviteToMeeting = async (agent: Agent) => {
    setSummonBusy(true);
    try {
      const m = await api.createMeeting(
        `与 ${agent.nickname || agent.name} 的对话`,
        [],
        null,
        [agent.id],
        "hybrid",
      );
      router.push(`/meeting/${m.id}`);
    } catch (e) {
      console.error("create meeting failed", e);
      const detail = e instanceof Error ? e.message : "创建会议失败";
      alert(detail);
      setSummonBusy(false);
    }
  };

  // 召唤 - 私聊 → 跳 /chat/<agent_id> (v26.13 上 真实现, 当前 是 mock 页)
  const handlePrivateChat = (agent: Agent) => {
    router.push(`/chat/${agent.id}`);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10">
      <header className="text-center">
        <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">aimeeting</div>
        <h1 className="mt-3 text-4xl font-semibold leading-tight text-white sm:text-5xl">
          让会议拥有<span className="text-accent-400">记忆与专家</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm text-zinc-400">
          实时字幕 · 声纹识别 · AI 专家参会 · 长期记忆
        </p>
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

      {/* v26.12-Home: 搜索框 — 防抖 300ms 后 调 backend, 走 ILIKE name/nickname/persona/domain */}
      <div className="mt-10">
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500">
            🔍
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索 AI 专家(姓名 / 外号 / 领域 / 擅长)"
            className="w-full rounded-xl border border-ink-700 bg-ink-900 py-3 pl-11 pr-4 text-sm text-white placeholder:text-zinc-500 focus:border-accent-500 focus:outline-none"
            data-testid="home-search"
          />
        </div>
      </div>

      {/* v26.12-Home: 专家 section header — 标题 + 最热/最新 toggle */}
      <div className="mt-8 flex items-center justify-between">
        <h2 className="flex items-baseline gap-2 text-base font-medium text-zinc-200">
          🌟 专家
          <span className="text-xs font-normal text-zinc-500">
            {agentsLoading ? "加载中…" : `${visibleAgents.length} 位`}
          </span>
        </h2>
        <div
          className="inline-flex items-center rounded-lg border border-ink-700 bg-ink-900 p-0.5 text-xs"
          data-testid="home-sort"
        >
          <button
            type="button"
            onClick={() => setSort("hot")}
            className={`rounded-md px-3 py-1 transition ${
              sort === "hot"
                ? "bg-accent-500 text-white shadow"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            最热
          </button>
          <button
            type="button"
            onClick={() => setSort("new")}
            className={`rounded-md px-3 py-1 transition ${
              sort === "new"
                ? "bg-accent-500 text-white shadow"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            最新
          </button>
        </div>
      </div>

      {/* v26.12-Home: domain chip 行 — 横向 滚动 (移动 / 平板 友好), 全部 + 各 domain */}
      <div className="scrollbar-thin mt-3 flex gap-1.5 overflow-x-auto pb-2">
        <button
          type="button"
          onClick={() => setDomainFilter(null)}
          className={`shrink-0 rounded-full border px-3 py-1 text-xs transition ${
            domainFilter === null
              ? "border-accent-500 bg-accent-500/15 text-accent-200"
              : "border-ink-700 bg-ink-900 text-zinc-400 hover:border-ink-600 hover:text-zinc-200"
          }`}
        >
          全部
        </button>
        {allDomains.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDomainFilter(d)}
            className={`shrink-0 rounded-full border px-3 py-1 text-xs transition ${
              domainFilter === d
                ? "border-accent-500 bg-accent-500/15 text-accent-200"
                : "border-ink-700 bg-ink-900 text-zinc-400 hover:border-ink-600 hover:text-zinc-200"
            }`}
          >
            {d}
          </button>
        ))}
      </div>

      {/* v26.12-Home: 卡片 grid — 4 列 (desktop) / 3 列 (lg) / 2 列 (sm) / 1 列 (mobile) */}
      <div className="mt-4">
        {agentsLoading ? (
          <p className="rounded-xl border border-ink-800 bg-ink-900/40 py-12 text-center text-sm text-zinc-500">
            加载 AI 专家…
          </p>
        ) : visibleAgents.length === 0 ? (
          <div className="rounded-xl border border-ink-800 bg-ink-900/40 py-12 text-center">
            <p className="text-sm text-zinc-400">
              {debouncedSearch || domainFilter
                ? `没找到匹配的 AI 专家`
                : "还没有 AI 专家"}
            </p>
            {!debouncedSearch && !domainFilter && (
              <Link
                href="/me/profile/agents"
                className="mt-3 inline-block text-xs text-accent-400 hover:text-accent-500"
              >
                + 去 AI 配置 创建
              </Link>
            )}
          </div>
        ) : (
          <ul
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            data-testid="agent-grid"
          >
            {visibleAgents.map((a) => (
              <li key={a.id}>
                <AgentCard agent={a} onSummon={() => setSummoning(a)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* v26.12-Home: 召唤 modal — 私聊 / 邀请入会 二选一 */}
      {summoning && (
        <SummonModal
          agent={summoning}
          busy={summonBusy}
          onPrivateChat={() => handlePrivateChat(summoning)}
          onInvite={() => handleInviteToMeeting(summoning)}
          onClose={() => setSummoning(null)}
        />
      )}

      {/* v26.12-Home: "高级 · 完整 会议" 折叠区 — 默认 关. 留 老用户 / 议程+真人+多AI 高级 场景. */}
      <details className="mt-12 rounded-xl border border-ink-800 bg-ink-900/40">
        <summary className="cursor-pointer select-none px-5 py-4 text-sm text-zinc-300 hover:bg-ink-900/60">
          📦 高级 · 配置完整会议(议程 / 真人 / 多选 AI / 模式)
        </summary>
        <div className="border-t border-ink-800 p-5">
          <AdvancedMeetingForm me={me} meLoaded={meLoaded} />
        </div>
      </details>

      <p className="mt-12 text-center text-xs text-zinc-600">
        v26.12 · {new Date().getFullYear()}
      </p>
    </main>
  );
}

// ============================================================================
// AgentCard — 单个 AI 卡片 (4-up grid 用)
// ============================================================================
function AgentCard({
  agent,
  onSummon,
}: {
  agent: Agent;
  onSummon: () => void;
}) {
  const colorHex = AGENT_COLOR_HEX[agent.color || "violet"] || AGENT_COLOR_HEX.violet;
  const initial = (agent.nickname || agent.name).slice(0, 1).toUpperCase();
  return (
    <article
      className="group flex h-full flex-col rounded-xl border border-ink-700 bg-ink-900 p-4 transition hover:-translate-y-0.5 hover:border-accent-500/50 hover:shadow-lg hover:shadow-accent-500/5"
      data-testid="agent-card"
    >
      {/* 头部: 头像 + 名字 + 外号 */}
      <div className="flex items-start gap-3">
        <div
          className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full text-sm font-semibold text-white"
          style={{
            background: agent.avatar_url ? undefined : colorHex,
            boxShadow: `0 0 0 1.5px ${colorHex}40`,
          }}
        >
          {agent.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={agent.avatar_url}
              alt={agent.name}
              className="h-full w-full object-cover"
            />
          ) : (
            initial
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-zinc-100">
            {agent.name}
          </div>
          {agent.nickname ? (
            <div className="truncate text-[11px] text-zinc-500">
              〈{agent.nickname}〉
            </div>
          ) : (
            <div className="truncate text-[11px] text-zinc-600">
              {agent.domain || "AI 专家"}
            </div>
          )}
        </div>
      </div>

      {/* domain + 1-2 个 关键词 chip */}
      <div className="mt-3 flex flex-wrap gap-1">
        {agent.domain && (
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] ${
              AGENT_COLOR_BG[agent.color || "violet"] || AGENT_COLOR_BG.violet
            }`}
          >
            {agent.domain}
          </span>
        )}
        {(agent.keywords ?? []).slice(0, 2).map((k) => (
          <span
            key={k}
            className="rounded-full border border-ink-700 bg-ink-950 px-2 py-0.5 text-[10px] text-zinc-400"
          >
            {k}
          </span>
        ))}
      </div>

      {/* persona 截 3 行 (line-clamp-3) — 没 persona 时 给 一行 占位 */}
      <p className="mt-3 line-clamp-3 min-h-[3rem] text-xs leading-5 text-zinc-400">
        {agent.persona?.trim() || "暂无介绍 — 由 manager 在 AI 配置页 补完."}
      </p>

      {/* mt-auto 把 footer 压 到 卡片 底部, 让 不同 高度 卡片 footer 对齐 */}
      <div className="mt-auto flex items-center justify-between border-t border-ink-800 pt-3">
        <span className="text-[11px] text-zinc-500">
          💬 {formatInvokeCount(agent.invoke_count ?? 0)}使用
        </span>
        {/* group-hover 出现 召唤按钮 — desktop 鼠标 在卡片上 才显, 移动端 一直显 */}
        <button
          type="button"
          onClick={onSummon}
          className="rounded-lg bg-accent-500 px-3 py-1 text-xs font-medium text-white shadow transition hover:bg-accent-400 sm:opacity-0 sm:group-hover:opacity-100"
          data-testid="agent-summon-btn"
        >
          📣 召唤
        </button>
      </div>
    </article>
  );
}

// ============================================================================
// SummonModal — 召唤 弹窗 (私聊 / 邀请入会 二选一)
// ============================================================================
function SummonModal({
  agent,
  busy,
  onPrivateChat,
  onInvite,
  onClose,
}: {
  agent: Agent;
  busy: boolean;
  onPrivateChat: () => void;
  onInvite: () => void;
  onClose: () => void;
}) {
  const colorHex = AGENT_COLOR_HEX[agent.color || "violet"] || AGENT_COLOR_HEX.violet;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-ink-700 bg-ink-900 p-5 shadow-2xl"
      >
        <div className="flex items-center gap-3">
          <div
            className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full text-sm font-semibold text-white"
            style={{
              background: agent.avatar_url ? undefined : colorHex,
              boxShadow: `0 0 0 1.5px ${colorHex}40`,
            }}
          >
            {agent.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={agent.avatar_url}
                alt={agent.name}
                className="h-full w-full object-cover"
              />
            ) : (
              (agent.nickname || agent.name).slice(0, 1).toUpperCase()
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-zinc-100">
              召唤 {agent.nickname || agent.name}
            </h2>
            <p className="truncate text-xs text-zinc-500">
              {agent.domain || "AI 专家"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        <p className="mt-4 text-xs text-zinc-500">选择 协作 方式:</p>

        <div className="mt-2 space-y-2">
          <button
            type="button"
            onClick={onPrivateChat}
            disabled={busy}
            data-testid="summon-private-chat"
            className="flex w-full items-center gap-3 rounded-lg border border-ink-700 bg-ink-950 px-4 py-3 text-left transition hover:border-accent-500 hover:bg-ink-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="text-xl">💬</span>
            <div className="flex-1">
              <div className="text-sm font-medium text-zinc-100">
                一对一 私聊
                <span className="ml-2 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] text-amber-300">
                  即将上线
                </span>
              </div>
              <p className="text-[11px] text-zinc-500">
                单独 跟 这位 专家 聊 — 不开会议, 不占 字幕通道
              </p>
            </div>
            <span className="text-zinc-600">→</span>
          </button>

          <button
            type="button"
            onClick={onInvite}
            disabled={busy}
            data-testid="summon-invite-meeting"
            className="flex w-full items-center gap-3 rounded-lg border border-accent-500 bg-accent-500/10 px-4 py-3 text-left transition hover:bg-accent-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="text-xl">🎤</span>
            <div className="flex-1">
              <div className="text-sm font-medium text-zinc-100">
                邀请到 会议
              </div>
              <p className="text-[11px] text-zinc-500">
                {busy ? "创建中…" : "新建一场 hybrid 会议, 自动 邀请 这位 AI 加入"}
              </p>
            </div>
            <span className="text-accent-300">→</span>
          </button>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            disabled={busy}
            className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// AdvancedMeetingForm — "高级 · 完整 会议" 折叠区 内容.
// 这 是 v26.12 之前 整个 首页 主流程. 现在 退到 折叠区, 留 给 议程 + 真人 +
// 多选 AI + auto 模式 的 高级 场景.
// ============================================================================
function AdvancedMeetingForm({
  me,
  meLoaded,
}: {
  me: Me | null;
  meLoaded: boolean;
}) {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickedAgents, setPickedAgents] = useState<Set<string>>(new Set());
  const [agentSearch, setAgentSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
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
      .catch(() => setAgents([]));
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
              placeholder="🔍 搜索 AI 专家 (按名字 / 领域 / 关键词)"
              className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
            />
            {pickedAgents.size > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {Array.from(pickedAgents).slice(0, 10).map((aid) => {
                  const a = agents.find((x) => x.id === aid);
                  if (!a) return null;
                  return (
                    <span
                      key={aid}
                      className="inline-flex items-center gap-1 rounded-full bg-accent-500/15 px-2 py-0.5 text-[10px] text-accent-300"
                    >
                      🤖 {a.name}
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
        {agents.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600" data-testid="no-agents-hint">
            还没有 AI 专家。去 <Link href="/me/profile/agents" className="text-accent-400">AI 配置</Link> 创建。
          </p>
        ) : (
          <div className="mt-3 space-y-3" data-testid="agent-picker">
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
              const groups: Record<string, typeof agents> = {};
              for (const a of filtered) {
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
              const groupCount = sortedGroups.length;
              return sortedGroups.map(([groupName, groupAgents]) => {
                const isCollapsed = q
                  ? false
                  : (collapsedGroups.has(groupName)
                      || (groupCount > 4 && !collapsedGroups.has(`_open:${groupName}`)));
                const toggleCollapse = () => {
                  setCollapsedGroups((s) => {
                    const next = new Set(s);
                    if (groupCount > 4) {
                      const openKey = `_open:${groupName}`;
                      if (next.has(openKey)) next.delete(openKey);
                      else next.add(openKey);
                    } else {
                      if (next.has(groupName)) next.delete(groupName);
                      else next.add(groupName);
                    }
                    return next;
                  });
                };
                return (
                  <div key={groupName}>
                    <button
                      type="button"
                      onClick={toggleCollapse}
                      className="mb-1.5 flex w-full items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300"
                    >
                      <span className="text-[10px]" aria-hidden>
                        {isCollapsed ? "▶" : "▼"}
                      </span>
                      <span className="font-medium">{groupName}</span>
                      <span className="text-zinc-700">·</span>
                      <span>{groupAgents.length} AI</span>
                    </button>
                    {!isCollapsed && (
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {groupAgents.map((a) => {
                          const tone =
                            AGENT_COLOR_BG[a.color || "violet"] || AGENT_COLOR_BG.violet;
                          const isOn = pickedAgents.has(a.id);
                          return (
                            <li key={a.id} className="relative group/agent">
                              <label
                                className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 transition hover:shadow-md ${
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
                                  {a.avatar_url ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={a.avatar_url}
                                      alt={a.name}
                                      className="h-6 w-6 rounded-full object-cover"
                                    />
                                  ) : (
                                    <span className="text-base" aria-hidden>🤖</span>
                                  )}
                                  {a.name}
                                </span>
                                {a.domain && (
                                  <span className="ml-2 truncate text-[10px] text-zinc-500">
                                    {a.domain}
                                  </span>
                                )}
                              </label>
                              {a.full_body_url && (
                                <div className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 hidden w-80 rounded-xl border border-ink-700 bg-ink-900 p-3 shadow-2xl group-hover/agent:block">
                                  <div className="flex gap-3">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={a.full_body_url}
                                      alt={a.name}
                                      width={80}
                                      height={155}
                                      className="rounded border border-ink-700 object-cover"
                                    />
                                    <div className="min-w-0 flex-1 text-xs">
                                      <div className="font-medium text-white">{a.name}</div>
                                      {a.domain && (
                                        <div className="text-zinc-500">{a.domain}</div>
                                      )}
                                      {a.persona && (
                                        <p className="mt-1.5 line-clamp-4 text-zinc-300">
                                          {a.persona}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              });
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
