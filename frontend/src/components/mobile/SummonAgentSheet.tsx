"use client";

/**
 * v27.0-mobile · Phase 4.2 · 召 AI 弹层 sheet.
 *
 * 行为:
 *   - 半屏 sheet 从底部弹起 (iOS 风)
 *   - 列已邀请的 AI 专家, 一项一行 (色块 + nickname + domain)
 *   - 选一个 → 高亮 → 点底部 "派他发言" 按钮 → 调 summon API → toast → sheet 收
 *   - 选好后还能改选, 没选不能 submit
 *   - 顶部有可选 "提示给 AI 一句话" 输入框 (空就用默认 prompt)
 *
 * 不依赖第三方 sheet 库 — 用 fixed + transition 自己撸.
 */

import { useEffect, useState } from "react";
import type { AgentMini } from "@/lib/mobile/types";

const COLOR_DOT: Record<string, string> = {
  violet: "bg-violet-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  sky: "bg-sky-500",
  rose: "bg-rose-500",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  indigo: "bg-indigo-500",
};

function colorDot(c: string | null): string {
  if (!c) return "bg-zinc-700";
  return COLOR_DOT[c] || "bg-zinc-700";
}

export default function SummonAgentSheet({
  open,
  agents,
  busy = false,
  onClose,
  onSubmit,
}: {
  open: boolean;
  agents: AgentMini[];
  busy?: boolean;
  onClose: () => void;
  onSubmit: (agentId: string, query: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState<string>("");

  // 关 sheet 时清空选择
  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setQuery("");
    }
  }, [open]);

  if (!open) return null;

  const selected = agents.find((a) => a.agent_id === selectedId);
  const canSubmit = !!selectedId && !busy;

  return (
    <div className="fixed inset-0 z-50" data-testid="mobile-summon-sheet">
      {/* 背景遮罩 */}
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      {/* sheet 主体 */}
      <div
        className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-hidden rounded-t-3xl border-t border-ink-800 bg-ink-950 shadow-2xl"
        role="dialog"
        aria-modal="true"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {/* 顶部把手 + 标题 */}
        <div className="flex flex-col items-center pt-3 pb-2">
          <div className="h-1 w-10 rounded-full bg-zinc-700" />
          <h2 className="mt-3 text-[17px] font-semibold text-zinc-50">
            召唤专家发言
          </h2>
          <p className="mt-1 text-[13px] text-zinc-400">
            选一位, 立刻基于刚才的讨论给出意见
          </p>
        </div>

        {/* AI 列表 (滚动区) */}
        <div className="max-h-[40vh] overflow-y-auto px-4 py-2">
          {agents.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-[14px] text-zinc-400">
              这个会议室还没邀请 AI 专家.
              <br />
              请桌面端先添加.
            </p>
          ) : (
            <ul className="space-y-2">
              {agents.map((a) => {
                const display = a.nickname?.trim() || a.name;
                const isSel = a.agent_id === selectedId;
                return (
                  <li key={a.agent_id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(a.agent_id)}
                      disabled={busy}
                      className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition active:scale-[0.99] disabled:opacity-60 ${
                        isSel
                          ? "border-accent-500/60 bg-accent-500/10"
                          : "border-ink-800 bg-ink-900 active:bg-ink-800"
                      }`}
                    >
                      <span
                        className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-medium text-white ${colorDot(
                          a.color,
                        )}`}
                      >
                        ◆
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[16px] font-medium text-zinc-50">
                          {display}
                        </p>
                        {a.domain ? (
                          <p className="mt-0.5 truncate text-[13px] text-zinc-400">
                            {a.domain}
                          </p>
                        ) : null}
                      </div>
                      {isSel ? (
                        <span className="text-[18px] text-accent-300">✓</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 可选 query 输入 */}
        {agents.length > 0 ? (
          <div className="px-4 pb-2">
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={busy}
              placeholder="(可选) 给 AI 一句话提示, 不写走默认"
              rows={2}
              className="w-full resize-none rounded-xl border border-ink-800 bg-ink-900 px-3 py-2.5 text-[14px] text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500/60 focus:outline-none disabled:opacity-60"
            />
          </div>
        ) : null}

        {/* 底部 actions */}
        <div className="flex gap-2 border-t border-ink-800 bg-ink-950 px-4 pt-3 pb-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex h-12 flex-1 items-center justify-center rounded-xl border border-zinc-700 px-4 text-[15px] text-zinc-200 active:scale-[0.98] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() =>
              selectedId && onSubmit(selectedId, query.trim())
            }
            className="flex h-12 flex-[2] items-center justify-center rounded-xl bg-accent-500 px-4 text-[15px] font-medium text-white shadow-lg shadow-accent-500/20 active:scale-[0.98] active:bg-accent-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy
              ? "派发中…"
              : selected
              ? `召唤 ${selected.nickname?.trim() || selected.name}`
              : "选一位专家"}
          </button>
        </div>
      </div>
    </div>
  );
}
