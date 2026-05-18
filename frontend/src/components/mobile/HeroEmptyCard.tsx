"use client";

/**
 * v27.0-mobile · 首页 Hero — 空闲状态.
 *
 * 没进行中会议时替换主 hero — 仍然给用户 "下一步该看啥" 主锚,
 * 不是空白 placeholder.
 *
 * 现 MVP: 简版 — 仅给 "看全部会议" 入口 + 一句提示.
 * 后续 Phase 拿真实 "最近复盘" + "下一场即将开始" 替换.
 */

import Link from "next/link";

export default function HeroEmptyCard() {
  return (
    <article
      className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900/60 to-ink-900 p-5"
      data-testid="mobile-hero-empty"
    >
      <p className="text-[13px] text-zinc-500">你现在空闲</p>
      <h1 className="mt-2 text-[20px] font-medium leading-tight text-zinc-100">
        没进行中的会议
      </h1>
      <p className="mt-2 text-[14px] leading-relaxed text-zinc-400">
        新开一场推进决策, 或看看团队最近在议啥.
      </p>

      <div className="mt-5 flex gap-2">
        <Link
          href="/m/meetings"
          className="flex h-12 flex-1 items-center justify-center rounded-xl bg-accent-500 px-4 text-[15px] font-medium text-white shadow-lg shadow-accent-500/20 active:scale-[0.98] transition"
        >
          看全部会议 →
        </Link>
      </div>
    </article>
  );
}
