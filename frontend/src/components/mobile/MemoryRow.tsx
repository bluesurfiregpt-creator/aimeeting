"use client";

/**
 * v27.0-mobile · Phase 4.4 · 长期记忆库单行.
 *
 * /m/insights "已入库" tab 用. 一条 long-term memory =
 *   - 内容 (全文, 不截)
 *   - 关联 agents (主 agent 高亮 + 其它 muted)
 *   - scope chip (user / project / org)
 *   - 来源会议 link (如有)
 *   - 入库时间 + curated_by 标识 (如有, 否则 "AI 自动入库")
 *
 * 点开来源会议 跳 /m/meetings/<id>.
 */

import Link from "next/link";
import type { MemoryOut } from "@/lib/mobile/types";

const SCOPE_LABEL: Record<string, { label: string; chipBg: string; chipText: string }> = {
  user: {
    label: "个人",
    chipBg: "bg-emerald-500/15",
    chipText: "text-emerald-300",
  },
  project: {
    label: "项目",
    chipBg: "bg-accent-500/15",
    chipText: "text-accent-300",
  },
  org: {
    label: "组织",
    chipBg: "bg-violet-500/15",
    chipText: "text-violet-300",
  },
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export default function MemoryRow({ memory }: { memory: MemoryOut }) {
  const scope = SCOPE_LABEL[memory.scope] || {
    label: memory.scope,
    chipBg: "bg-zinc-800",
    chipText: "text-zinc-300",
  };
  const primary = memory.agents.find((a) => a.is_primary);
  const others = memory.agents.filter((a) => !a.is_primary);

  return (
    <article
      className="rounded-2xl bg-ink-900 p-4"
      data-testid="mobile-memory-row"
    >
      {/* 内容 */}
      <p className="text-[16px] leading-relaxed text-zinc-50">
        {memory.content}
      </p>

      {/* 元数据行: scope + 关联 agents */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center rounded-md px-2 py-1 text-[13px] font-medium ${scope.chipBg} ${scope.chipText}`}
        >
          {scope.label}
        </span>
        {primary ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-violet-500/15 px-2 py-1 text-[13px] font-medium text-violet-300">
            🤖 {primary.name}
            <span className="text-[12px] font-normal text-violet-400/80">
              · 主
            </span>
          </span>
        ) : null}
        {others.map((a) => (
          <span
            key={a.id}
            className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-[13px] text-zinc-300"
          >
            🤖 {a.name}
          </span>
        ))}
      </div>

      {/* 底部: 时间 + 来源会议 link + curated_by */}
      <footer className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px] text-zinc-500">
        <span className="tabular-nums">入库 {fmtDate(memory.created_at)}</span>
        {memory.curated_by_user_id ? (
          <span>· 由用户审入</span>
        ) : (
          <span>· AI 自动入库</span>
        )}
        {memory.source_meeting_id ? (
          <Link
            href={`/m/meetings/${memory.source_meeting_id}`}
            className="ml-auto text-accent-400 active:text-accent-300"
          >
            来源会议 →
          </Link>
        ) : null}
      </footer>
    </article>
  );
}
