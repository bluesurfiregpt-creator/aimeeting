"use client";

/**
 * v27.0-mobile · 顶部 chrome.
 *
 * 设计 极简:
 *   - 左: 问候 + 用户 名 (从 api.me 拉)
 *   - 右: 🔔 通知 (digit badge) + ⚙ 设置 折叠
 *
 * 不 放 logo (移动端 域名 + bottom nav 已足 标识).
 * 不 放 搜索框 (brief 反 chat-style, 搜 走 二级页).
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return "夜深 了";
  if (h < 11) return "早";
  if (h < 14) return "中午 好";
  if (h < 18) return "下午 好";
  return "晚上 好";
}

export default function TopBar() {
  const [name, setName] = useState<string>("");
  const [unread, setUnread] = useState<number>(0);

  useEffect(() => {
    let alive = true;
    api.me().then(
      (m) => {
        if (!alive) return;
        setName(m.name || "");
        const counts = m.task_counts;
        if (counts) {
          // 简单 合并 — 待 处理 类 累加
          const n =
            (counts.kb_sedimentation_pending ?? 0) +
            (counts.memory_draft_pending ?? 0);
          setUnread(n);
        }
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, []);

  return (
    <header
      data-testid="mobile-top-bar"
      className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-ink-800 bg-ink-950/95 px-4 backdrop-blur"
      style={{ paddingTop: "env(safe-area-inset-top, 0)" }}
    >
      <div className="min-w-0 flex-1 text-[15px]">
        <span className="text-zinc-500">{greeting()}, </span>
        <span className="font-medium text-zinc-100">{name || "..."}</span>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <Link
          href="/m/notifications"
          className="relative flex h-10 w-10 items-center justify-center text-zinc-400 active:text-zinc-200"
          title="通知"
        >
          <span className="text-lg">🔔</span>
          {unread > 0 ? (
            <span className="absolute right-1 top-1 flex h-4 min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Link>
        <Link
          href="/m/me"
          className="flex h-10 w-10 items-center justify-center text-zinc-400 active:text-zinc-200"
          title="我"
        >
          <span className="text-lg">⚙</span>
        </Link>
      </div>
    </header>
  );
}
