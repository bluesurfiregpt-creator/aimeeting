"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type Agent } from "@/lib/api";

// v26.12-Home: agent 颜色名 → Tailwind class 映射 (用于 chip / card 颜色)
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

      {/* v26.12-Home-fix2: Hero CTA — AI 渐变描边 + 流动动画 + 发光阴影.
          用户 反馈: "新建会议 应该 亮眼, 放 中间 位置".
          从 页面底部 link card 升级 到 首屏 主入口, 视觉 引导.
          描边: violet → fuchsia → amber → emerald → cyan 流动.
          内部: ink-950 暗背景 + 大字 + ✨ + 副标 + 右侧 → 箭头. */}
      <div className="mt-10">
        <Link
          href="/meetings/new"
          data-testid="home-advanced-meeting-link"
          className="group relative block overflow-hidden rounded-2xl p-[2px] shadow-xl shadow-violet-500/20 transition hover:shadow-2xl hover:shadow-violet-500/40"
        >
          {/* 描边: 流动 AI 渐变 (CSS animation 在 globals.css) */}
          <span
            aria-hidden
            className="absolute inset-0 rounded-2xl animate-ai-flow"
          />
          {/* 内部 卡片 — ink-950 暗底, 跟 描边 形成 对比 */}
          <span className="relative flex items-center justify-between gap-4 rounded-[14px] bg-ink-950 px-6 py-5 transition group-hover:bg-ink-900">
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-lg animate-ai-sparkle" aria-hidden>✨</span>
                <span className="text-base font-semibold text-white sm:text-lg">
                  新建 完整会议
                </span>
                <span className="rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-200">
                  AI 驱动
                </span>
              </span>
              <span className="mt-1 block text-xs text-zinc-400 sm:text-sm">
                配置 议程 + 真人参会人 + 多 AI 专家 + 会议模式 — 完整 定制 一场 跨域协作
              </span>
            </span>
            {/* 右侧 → 箭头 — group-hover 时 滑动一点 */}
            <span className="shrink-0 grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg transition group-hover:translate-x-0.5 group-hover:scale-105">
              →
            </span>
          </span>
        </Link>
      </div>

      {/* v26.12-Home: 搜索框 — 防抖 300ms 后 调 backend, 走 ILIKE name/nickname/persona/domain */}
      <div className="mt-6">
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
            className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
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
