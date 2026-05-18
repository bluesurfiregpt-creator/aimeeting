"use client";

/** v27.0-mobile · /m/insights · Phase 0 占位 + smoke test API. */

import { useEffect, useState } from "react";

export default function MobileInsightsPage() {
  const [n, setN] = useState<string>("...");

  useEffect(() => {
    fetch("/api/m/insights?limit=5", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setN(`${Array.isArray(data) ? data.length : 0} 条`))
      .catch(() => setN("err"));
  }, []);

  return (
    <div className="p-4">
      <h1 className="text-lg font-medium text-zinc-100">智囊</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Phase 2 来 渲: AI 产出 (默认) / 待审 / 已入库 三 tab
      </p>
      <p className="mt-3 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 text-[11px] text-violet-300">
        Phase 0 · /api/m/insights → <span className="font-mono">{n}</span>
      </p>
    </div>
  );
}
