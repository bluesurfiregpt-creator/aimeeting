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
 *
 * v1.4.0 Saga K · 浅色化 (跟 /m today + /m/me 一致, iOS 浅色).
 */

import Link from "next/link";
import type { MemoryOut } from "@/lib/mobile/types";
import { MR_COLORS } from "@/components/mobile/meeting-room/styles";

type ScopeChip = { label: string; bg: string; fg: string };

const SCOPE_LABEL: Record<string, ScopeChip> = {
  user: {
    label: "个人",
    bg: "rgba(52,199,89,0.12)",
    fg: MR_COLORS.systemGreen,
  },
  project: {
    label: "项目",
    bg: "rgba(0,122,255,0.10)",
    fg: MR_COLORS.systemBlue,
  },
  org: {
    label: "组织",
    bg: "rgba(94,92,230,0.10)",
    fg: MR_COLORS.systemPurple,
  },
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export default function MemoryRow({ memory }: { memory: MemoryOut }) {
  const scope: ScopeChip = SCOPE_LABEL[memory.scope] || {
    label: memory.scope,
    bg: "rgba(60,60,67,0.08)",
    fg: MR_COLORS.textSecondary,
  };
  const primary = memory.agents.find((a) => a.is_primary);
  const others = memory.agents.filter((a) => !a.is_primary);

  return (
    <article
      className="rounded-2xl p-4"
      style={{
        background: MR_COLORS.bgWhite,
        border: `0.5px solid ${MR_COLORS.hairline}`,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}
      data-testid="mobile-memory-row"
    >
      {/* 内容 */}
      <p
        className="text-[16px] leading-relaxed"
        style={{ color: MR_COLORS.textPrimary }}
      >
        {memory.content}
      </p>

      {/* 元数据行: scope + 关联 agents */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center rounded-md px-2 py-1 text-[13px] font-medium"
          style={{ background: scope.bg, color: scope.fg }}
        >
          {scope.label}
        </span>
        {primary ? (
          <span
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium"
            style={{
              background: "rgba(94,92,230,0.10)",
              color: MR_COLORS.systemPurple,
            }}
          >
            🤖 {primary.name}
            <span
              className="text-[12px] font-normal"
              style={{ color: "rgba(94,92,230,0.70)" }}
            >
              · 主
            </span>
          </span>
        ) : null}
        {others.map((a) => (
          <span
            key={a.id}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px]"
            style={{
              background: "rgba(60,60,67,0.06)",
              color: MR_COLORS.textSecondary,
            }}
          >
            🤖 {a.name}
          </span>
        ))}
      </div>

      {/* 底部: 时间 + 来源会议 link + curated_by */}
      <footer
        className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]"
        style={{ color: MR_COLORS.textTertiary }}
      >
        <span className="tabular-nums">入库 {fmtDate(memory.created_at)}</span>
        {memory.curated_by_user_id ? (
          <span>· 由用户审入</span>
        ) : (
          <span>· AI 自动入库</span>
        )}
        {memory.source_meeting_id ? (
          <Link
            href={`/m/meetings/${memory.source_meeting_id}`}
            className="ml-auto"
            style={{ color: MR_COLORS.systemBlue }}
          >
            来源会议 →
          </Link>
        ) : null}
      </footer>
    </article>
  );
}
