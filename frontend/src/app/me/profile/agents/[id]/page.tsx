"use client";

/**
 * v26.9-Avatar · AI 专家详情页 (数字员工工卡)
 *
 * 路由: /me/profile/agents/{agent_id}
 *
 * 设计理念: AI 专家 = 数字员工, 有 身份 (形象) / 简历 (人格) /
 *           技能 (KB) / 经验 (Memory) / 履历 (会议/任务).
 *
 * 布局:
 *   左 220x388 区: 全身像 (hover 切换 静态 ↔ 动图)
 *   右: 工卡信息 + 形象 3 张缩略 + 3 个 tab (工卡/知识/记忆)
 *
 * ABAC:
 *   - 任何 ws 成员 可看 (workspace 隔离)
 *   - 编辑/上传形象: 走 is_agent_manager (跟 PATCH 同等级)
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  api,
  type Agent,
  type KnowledgeBase,
  type Me,
  type Memory,
} from "@/lib/api";
import { toast } from "@/lib/toast";

const FULL_ADMIN = new Set(["owner", "admin", "leader"]);

type Tab = "card" | "kb" | "memory";

export default function AgentDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const agentId = params?.id ?? "";
  const [agent, setAgent] = useState<Agent | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [allKbs, setAllKbs] = useState<KnowledgeBase[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [tab, setTab] = useState<Tab>("card");
  const [loading, setLoading] = useState(true);
  // hover 切换 全身像 (静态 ↔ 动图)
  const [hovering, setHovering] = useState(false);

  const refresh = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const [a, m, kbs, mems] = await Promise.all([
        api.getAgent(agentId),
        api.me().catch(() => null),
        api.listKnowledgeBases().catch(() => [] as KnowledgeBase[]),
        api.listMemories(undefined, undefined, agentId).catch(() => [] as Memory[]),
      ]);
      setAgent(a);
      setMe(m);
      setAllKbs(kbs);
      setMemories(mems);
    } catch (e) {
      void e;  // api.ts toast
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) return <div className="text-sm text-zinc-500">加载中…</div>;
  if (!agent) return <div className="text-sm text-rose-400">⚠️ 找不到这个 AI 专家</div>;

  const isFullAdmin = me ? FULL_ADMIN.has(me.role) : false;
  const canEdit = isFullAdmin || (me?.user_id && agent.primary_user_id === me.user_id);
  // 关联的 KB
  const boundKbs = allKbs.filter((kb) => (agent.knowledge_base_ids ?? []).includes(kb.id));
  // 当前显示的全身像: hover 时显示动图, 否则静态
  const heroSrc = hovering && agent.full_body_animated_url
    ? agent.full_body_animated_url
    : agent.full_body_url;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/me/profile/agents"
          className="text-xs text-zinc-400 hover:text-zinc-200"
        >
          ← AI 专家列表
        </Link>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Link
              href={`/me/profile/agents?edit=${agent.id}`}
              className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-ink-800"
            >
              ✏️ 编辑配置
            </Link>
          </div>
        )}
      </div>

      {/* Hero: 左全身像 + 右工卡 */}
      <section className="grid gap-6 lg:grid-cols-[220px_1fr]">
        {/* 左: 全身像 */}
        <div>
          <div
            className="relative overflow-hidden rounded-2xl border border-ink-700 bg-gradient-to-br from-violet-500/10 to-sky-500/10"
            style={{ width: 220, height: 408 }}
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
          >
            {heroSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={heroSrc}
                alt={agent.name}
                width={200}
                height={388}
                className="absolute inset-0 m-auto h-[388px] w-[200px] object-contain"
              />
            ) : (
              <div className="grid h-full place-items-center text-center text-zinc-600">
                <div>
                  <div className="text-6xl" aria-hidden>🤖</div>
                  <p className="mt-3 text-xs">
                    暂无形象
                    {canEdit && (
                      <>
                        <br />
                        <span className="text-[10px] text-zinc-700">
                          在 编辑配置 中上传
                        </span>
                      </>
                    )}
                  </p>
                </div>
              </div>
            )}
            {agent.full_body_animated_url && agent.full_body_url && (
              <div className="absolute bottom-2 right-2 rounded-full bg-black/40 px-2 py-0.5 text-[10px] text-zinc-300">
                {hovering ? "🎬 动" : "🖼 静 / hover 切换"}
              </div>
            )}
          </div>
          {/* 形象 3 张缩略 */}
          <div className="mt-3 flex gap-2">
            <AvatarThumb url={agent.avatar_url} label="头像" size={48} />
            <AvatarThumb url={agent.full_body_url} label="静态" size={48} aspect="tall" />
            <AvatarThumb
              url={agent.full_body_animated_url}
              label="动图"
              size={48}
              aspect="tall"
            />
          </div>
        </div>

        {/* 右: 工卡信息 */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-medium text-white">{agent.name}</h1>
            {agent.role === "moderator" && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
                🛡 系统内置
              </span>
            )}
            {!agent.is_active && (
              <span className="rounded-full bg-zinc-700/40 px-2 py-0.5 text-xs text-zinc-400">
                已停用
              </span>
            )}
            {me && agent.primary_user_id === me.user_id && (
              <span
                className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300"
                title="你是这个 AI 的 primary_user (管理人)"
              >
                🛠 我管理
              </span>
            )}
          </div>
          <dl className="grid gap-2 sm:grid-cols-2 text-xs">
            <KV k="领域" v={agent.domain || "—"} />
            <KV
              k="科室主管"
              v={agent.primary_user_name
                ? `🛠 ${agent.primary_user_name}`
                : <span className="text-amber-300">⚠️ 未绑科室</span>}
            />
            <KV
              k="颜色 tag"
              v={
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: cssColor(agent.color) }}
                  />
                  {agent.color ?? "—"}
                </span>
              }
            />
            <KV
              k="创建时间"
              v={new Date(agent.created_at).toLocaleDateString("zh-CN")}
            />
          </dl>
        </div>
      </section>

      {/* Tabs */}
      <nav className="flex gap-1 border-b border-ink-700">
        <TabBtn label="🪪 工卡" active={tab === "card"} onClick={() => setTab("card")} />
        <TabBtn label={`📚 知识 (${boundKbs.length})`} active={tab === "kb"} onClick={() => setTab("kb")} />
        <TabBtn label={`🧠 记忆 (${memories.length})`} active={tab === "memory"} onClick={() => setTab("memory")} />
      </nav>

      {/* Tab content */}
      {tab === "card" && (
        <CardTab agent={agent} />
      )}
      {tab === "kb" && (
        <KbTab kbs={boundKbs} />
      )}
      {tab === "memory" && (
        <MemoryTab memories={memories} />
      )}
    </div>
  );
}

// ---- 子组件 ---------------------------------------------------------

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-950/60 p-2.5">
      <dt className="text-[10px] uppercase tracking-wider text-zinc-500">{k}</dt>
      <dd className="mt-0.5 text-sm text-zinc-100">{v}</dd>
    </div>
  );
}

function AvatarThumb({
  url,
  label,
  size = 48,
  aspect = "square",
}: {
  url: string | null | undefined;
  label: string;
  size?: number;
  aspect?: "square" | "tall";
}) {
  const h = aspect === "tall" ? Math.round(size * 388 / 200) : size;
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="overflow-hidden rounded border border-ink-700 bg-ink-950/60"
        style={{ width: size, height: h }}
        title={url ? `${label} 已上传` : `${label} 未上传`}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-zinc-700 text-[10px]">
            空
          </div>
        )}
      </div>
      <span className="text-[10px] text-zinc-500">{label}</span>
    </div>
  );
}

function TabBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-t-lg px-4 py-2 text-sm transition ${
        active
          ? "border-b-2 border-accent-500 text-white"
          : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {label}
    </button>
  );
}

function CardTab({ agent }: { agent: Agent }) {
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-ink-700 bg-ink-900 p-4">
        <h3 className="text-xs uppercase tracking-wider text-zinc-500">
          👤 人格 · Persona
        </h3>
        <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-200">
          {agent.persona || <span className="text-zinc-600">(未填)</span>}
        </p>
      </section>
      {agent.keywords && agent.keywords.length > 0 && (
        <section className="rounded-xl border border-ink-700 bg-ink-900 p-4">
          <h3 className="text-xs uppercase tracking-wider text-zinc-500">
            🏷 触发关键词
          </h3>
          <p className="mt-1 text-[11px] text-zinc-500">
            会议中 当真人说话 含这些关键词时, 系统会 自动 召唤 该 AI 回应.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {agent.keywords.map((k) => (
              <span
                key={k}
                className="rounded bg-ink-800 px-2 py-0.5 text-xs text-zinc-300"
              >
                {k}
              </span>
            ))}
          </div>
        </section>
      )}
      {(agent.tone || agent.boundary) && (
        <section className="grid gap-3 sm:grid-cols-2">
          {agent.tone && (
            <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
              <h3 className="text-xs uppercase tracking-wider text-zinc-500">
                🎙 语气
              </h3>
              <p className="mt-2 text-sm text-zinc-200">{agent.tone}</p>
            </div>
          )}
          {agent.boundary && (
            <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
              <h3 className="text-xs uppercase tracking-wider text-zinc-500">
                🚧 边界
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-200">
                {agent.boundary}
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function KbTab({ kbs }: { kbs: KnowledgeBase[] }) {
  if (kbs.length === 0) {
    return (
      <div className="rounded-xl border border-ink-700 bg-ink-900 p-8 text-center text-sm text-zinc-500">
        <div className="text-3xl" aria-hidden>📚</div>
        <p className="mt-2">该 AI 未关联任何 知识库</p>
        <p className="mt-1 text-xs text-zinc-600">
          在 编辑配置 中, 给 AI 绑定 KB, 它就能 RAG 引用 这些文档.
        </p>
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {kbs.map((kb) => (
        <li
          key={kb.id}
          className="flex items-center justify-between rounded-xl border border-ink-700 bg-ink-900 p-4"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white">📚 {kb.name}</span>
              {kb.owner_agent_name && (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">
                  归属 {kb.owner_agent_name}
                </span>
              )}
            </div>
            {kb.description && (
              <p className="mt-1 truncate text-xs text-zinc-500">{kb.description}</p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span>📄 {kb.document_count} 文档</span>
              <span>🧩 {kb.chunk_count} 分块</span>
            </div>
          </div>
          <Link
            href={`/me/profile/knowledge/${kb.id}`}
            className="ml-3 shrink-0 rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-ink-800"
          >
            → 查看
          </Link>
        </li>
      ))}
    </ul>
  );
}

function MemoryTab({ memories }: { memories: Memory[] }) {
  if (memories.length === 0) {
    return (
      <div className="rounded-xl border border-ink-700 bg-ink-900 p-8 text-center text-sm text-zinc-500">
        <div className="text-3xl" aria-hidden>🧠</div>
        <p className="mt-2">该 AI 还没有 长期记忆</p>
        <p className="mt-1 text-xs text-zinc-600">
          会议结束 / 任务办结 时 系统会 自动 抽取候选记忆,
          经审批 后入库 给 AI 做 RAG 上下文.
        </p>
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {memories.map((m) => (
        <li
          key={m.id}
          className="rounded-xl border border-ink-700 bg-ink-900 p-3 text-sm"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-violet-300">
              {m.scope}
            </span>
            {(m.agents ?? []).map((a) => (
              <span
                key={a.id}
                className={`rounded-full px-2 py-0.5 text-[10px] ${
                  a.is_primary
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-zinc-700/30 text-zinc-400"
                }`}
                title={a.is_primary ? "primary (主)" : "subscriber (订阅)"}
              >
                {a.is_primary ? "⭐" : "🔗"} {a.name}
              </span>
            ))}
            <span className="text-zinc-600">
              重要度 {m.importance.toFixed(1)}
            </span>
            <span className="text-zinc-600">
              {new Date(m.created_at).toLocaleDateString("zh-CN")}
            </span>
          </div>
          <p className="mt-2 text-zinc-200">{m.content}</p>
        </li>
      ))}
    </ul>
  );
}

function cssColor(name: string | null | undefined): string {
  return (
    {
      violet: "#8b5cf6",
      sky: "#38bdf8",
      emerald: "#34d399",
      amber: "#fbbf24",
      rose: "#fb7185",
      teal: "#2dd4bf",
    } as Record<string, string>
  )[name ?? ""] ?? "#8b5cf6";
}
