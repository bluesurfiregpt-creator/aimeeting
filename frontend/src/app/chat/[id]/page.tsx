"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type Agent } from "@/lib/api";

// v26.12-Home: 私聊 mock 页 — v26.13 真实现 一对一 chat.
// 现在 这个 路由 + 入口 + 跳转 都 接通 了, v26.13 只 改 这个 文件 内容即可上线.
// 占位 内容:
//   - 顶部: ← 返回首页
//   - 中部: AI 头像 + 名字 + "敬请期待" 占位
//   - 底部 CTA: "想 现在 跟 我 聊? 邀请到 会议" 兜底 给一个 真能用 的 出口

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

export default function ChatMockPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { id } = use(params);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [creatingMeeting, setCreatingMeeting] = useState(false);

  useEffect(() => {
    api.getAgent(id)
      .then(setAgent)
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "加载失败"));
  }, [id]);

  const inviteToMeeting = async () => {
    if (!agent) return;
    setCreatingMeeting(true);
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
      const detail = e instanceof Error ? e.message : "创建会议失败";
      alert(detail);
      setCreatingMeeting(false);
    }
  };

  if (loadErr) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-10">
        <Link href="/" className="text-xs text-zinc-500 hover:text-accent-400">
          ← 返回 首页
        </Link>
        <div className="mt-12 rounded-xl border border-rose-500/30 bg-rose-500/5 p-6 text-center">
          <p className="text-sm text-rose-300">无法加载 AI 专家: {loadErr}</p>
        </div>
      </main>
    );
  }

  const colorHex = agent
    ? AGENT_COLOR_HEX[agent.color || "violet"] || AGENT_COLOR_HEX.violet
    : "#8b5cf6";

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-10">
      {/* 顶部 — 返回 */}
      <Link href="/" className="text-xs text-zinc-500 hover:text-accent-400">
        ← 返回 首页
      </Link>

      {/* AI hero — 头像 + 名字 + 外号 */}
      <div className="mt-10 flex flex-col items-center text-center">
        {agent ? (
          <>
            <div
              className="grid h-24 w-24 place-items-center overflow-hidden rounded-full text-2xl font-semibold text-white"
              style={{
                background: agent.avatar_url ? undefined : colorHex,
                boxShadow: `0 0 0 3px ${colorHex}40, 0 0 32px ${colorHex}30`,
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
            <h1 className="mt-4 text-2xl font-semibold text-zinc-100">
              {agent.name}
            </h1>
            {agent.nickname && (
              <p className="mt-1 text-sm text-zinc-500">〈{agent.nickname}〉</p>
            )}
            {agent.domain && (
              <span className="mt-2 rounded-full border border-ink-700 bg-ink-900 px-3 py-1 text-xs text-zinc-400">
                {agent.domain}
              </span>
            )}
            {agent.persona && (
              <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-zinc-400">
                {agent.persona}
              </p>
            )}
          </>
        ) : (
          <div className="h-24 w-24 animate-pulse rounded-full bg-ink-800" />
        )}
      </div>

      {/* Mock placeholder — "敬请期待" */}
      <div className="mt-10 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6 text-center">
        <div className="text-4xl">🚧</div>
        <h2 className="mt-3 text-base font-semibold text-amber-200">
          一对一 私聊 · 敬请期待
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-xs text-amber-200/70">
          单独 跟 这位 专家 聊 — 不开会议, 不占 字幕通道, history 累积.
          <br />
          预计 v26.13 上线.
        </p>
      </div>

      {/* 兜底 CTA — 想 现在 跟 这位 AI 协作? 邀请到 会议 */}
      <div className="mt-6 rounded-xl border border-ink-700 bg-ink-900 p-5">
        <h3 className="text-sm font-medium text-zinc-200">想 现在 就 跟 TA 协作?</h3>
        <p className="mt-1 text-xs text-zinc-500">
          新建一场 会议, 自动 邀请 这位 AI 加入. 跟 私聊 体验 接近 (打字也能聊).
        </p>
        <button
          type="button"
          onClick={inviteToMeeting}
          disabled={!agent || creatingMeeting}
          className="mt-4 w-full rounded-lg bg-accent-500 px-4 py-2.5 text-sm font-medium text-white shadow transition hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="chat-mock-invite-meeting"
        >
          {creatingMeeting ? "创建会议中…" : "🎤 邀请到 新会议"}
        </button>
      </div>

      <p className="mt-12 text-center text-xs text-zinc-600">
        v26.12 · 私聊 mock 占位
      </p>
    </main>
  );
}
