"use client";

/**
 * v27.0-mobile · 首页 Hero — 空闲状态.
 *
 * 没进行中会议时替换主 hero — 仍然给用户 "下一步该看啥" 主锚,
 * 不是空白 placeholder.
 *
 * 现 MVP: 简版 — 仅给 "看全部会议" 入口 + 一句提示.
 * 后续 Phase 拿真实 "最近复盘" + "下一场即将开始" 替换.
 *
 * v1.4.0 Saga L · 浅色化 (iOS 浅色).
 */

import Link from "next/link";
import { MR_COLORS } from "@/components/mobile/meeting-room/styles";

export default function HeroEmptyCard() {
  return (
    <article
      className="rounded-2xl p-5"
      style={{
        background: MR_COLORS.bgWhite,
        border: `0.5px solid ${MR_COLORS.hairline}`,
      }}
      data-testid="mobile-hero-empty"
    >
      <p className="text-[13px]" style={{ color: MR_COLORS.textTertiary }}>
        你现在空闲
      </p>
      <h1
        className="mt-2 text-[20px] font-medium leading-tight"
        style={{ color: MR_COLORS.textPrimary }}
      >
        没进行中的会议
      </h1>
      <p
        className="mt-2 text-[14px] leading-relaxed"
        style={{ color: MR_COLORS.textSecondary }}
      >
        新开一场推进决策, 或看看团队最近在议啥.
      </p>

      <div className="mt-5 flex gap-2">
        <Link
          href="/m/meetings/new"
          className="flex h-12 flex-1 items-center justify-center rounded-xl px-4 text-[15px] font-medium text-white active:scale-[0.98] transition"
          style={{
            background: MR_COLORS.systemBlue,
            boxShadow: "0 4px 12px rgba(0,122,255,0.20)",
          }}
        >
          + 新建一场
        </Link>
        <Link
          href="/m/meetings"
          className="flex h-12 flex-1 items-center justify-center rounded-xl bg-white px-4 text-[15px] active:scale-[0.98] active:bg-[#F2F2F7] transition"
          style={{
            border: `0.5px solid ${MR_COLORS.hairlineStrong}`,
            color: MR_COLORS.textPrimary,
          }}
        >
          看全部会议
        </Link>
      </div>
    </article>
  );
}
