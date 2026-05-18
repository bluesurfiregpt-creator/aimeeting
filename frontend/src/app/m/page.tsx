"use client";

/**
 * v27.0-mobile · /m · 今日 工作台 (首页).
 *
 * Phase 0 占位 — 仅 验证 路由 + layout 通. Phase 1 拉 /api/m/workbench + 三 大段 渲染.
 */

import { useEffect, useState } from "react";

export default function MobileHomePage() {
  const [pingStatus, setPingStatus] = useState<string>("…");

  useEffect(() => {
    fetch("/api/m/workbench", { credentials: "include" })
      .then((r) => setPingStatus(`API ${r.status}`))
      .catch((e) => setPingStatus(`err: ${String(e).slice(0, 50)}`));
  }, []);

  return (
    <div className="space-y-4 p-4">
      <section>
        <h2 className="text-xs uppercase tracking-wider text-zinc-500">现在 推进</h2>
        <div className="mt-2 rounded-lg border border-ink-700 bg-ink-900 p-4 text-sm text-zinc-400">
          Phase 1 来 渲: 进行中 会议 横向 carousel
        </div>
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-wider text-zinc-500">等 我 处理</h2>
        <div className="mt-2 rounded-lg border border-ink-700 bg-ink-900 p-4 text-sm text-zinc-400">
          Phase 1 来 渲: 待 确认 / 待 审 / 阻塞
        </div>
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-wider text-zinc-500">
          AI 智囊 · 今日 产出
        </h2>
        <div className="mt-2 rounded-lg border border-ink-700 bg-ink-900 p-4 text-sm text-zinc-400">
          Phase 1 来 渲: AI 智囊 卡 list
        </div>
      </section>

      <section className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 text-[11px] text-violet-300">
        Phase 0 · 基础设施 检查 · /api/m/workbench → <span className="font-mono">{pingStatus}</span>
      </section>
    </div>
  );
}
