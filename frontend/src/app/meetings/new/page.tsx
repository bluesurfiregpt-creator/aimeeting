"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type Me } from "@/lib/api";
import { AdvancedMeetingForm } from "@/components/AdvancedMeetingForm";

// v26.12-Home: 完整会议 单独 路由 — 议程 + 真人 attendees + 多选 AI + auto 模式.
// 从 首页 "📦 高级 · 配置完整会议" 折叠区 抽 出来 (用户 要求 拎 到 单独页).
// 首页 现在 留 一个 link card → 跳 这里.
export default function NewMeetingPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);

  useEffect(() => {
    api.me()
      .then((m) => { setMe(m); setMeLoaded(true); })
      .catch(() => { setMe(null); setMeLoaded(true); });
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-10">
      <Link href="/" className="text-xs text-zinc-500 hover:text-accent-400">
        ← 返回 首页
      </Link>

      <header className="mt-6">
        <h1 className="text-2xl font-semibold text-white">
          新建 完整会议
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          配置 议程 + 真人参会人 + 多 AI 专家 + 会议模式. 如果 只想 跟 单个 AI 聊,
          回 <Link href="/" className="text-accent-400 hover:text-accent-500">首页</Link> 直接 召唤 卡片更快.
        </p>
      </header>

      <section className="mt-8 rounded-xl border border-ink-700 bg-ink-900 p-5">
        <AdvancedMeetingForm me={me} meLoaded={meLoaded} />
      </section>

      <p className="mt-12 text-center text-xs text-zinc-600">
        v26.12 · {new Date().getFullYear()}
      </p>
    </main>
  );
}
