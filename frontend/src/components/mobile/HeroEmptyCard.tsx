"use client";

/**
 * v27.0-mobile · 首页 Hero — 空 闲 状 态.
 *
 * 没 进 行 中 会议 时 替 换 主 hero — 仍 然 给 用户 "下 一步 该 看 啥" 主 锚,
 * 不 是 空 白 placeholder.
 *
 * 现 MVP: 简版 — 仅 给 "看 全 部 会议" 入口 + 一 句 提示.
 * 后 续 Phase 拿 真实 "最近 复盘" + "下 一场 即将 开始" 替 换.
 */

import Link from "next/link";

export default function HeroEmptyCard() {
  return (
    <article
      className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900/60 to-ink-900 p-5"
      data-testid="mobile-hero-empty"
    >
      <p className="text-[13px] text-zinc-500">你 现 在 空 闲</p>
      <h1 className="mt-2 text-[20px] font-medium leading-tight text-zinc-100">
        没 进 行 中 的 会议
      </h1>
      <p className="mt-2 text-[14px] leading-relaxed text-zinc-400">
        新开 一 场 推 进 决策, 或 看 看 团队 最 近 在 议 啥.
      </p>

      <div className="mt-5 flex gap-2">
        <Link
          href="/m/meetings"
          className="flex h-12 flex-1 items-center justify-center rounded-xl bg-accent-500 px-4 text-[15px] font-medium text-white shadow-lg shadow-accent-500/20 active:scale-[0.98] transition"
        >
          看 全部 会议 →
        </Link>
      </div>
    </article>
  );
}
