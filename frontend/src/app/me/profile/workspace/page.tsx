"use client";

/**
 * v26.5-WS · 工作空间设置 (owner+ only)
 *
 * 内容:
 *   - workspace 基础 (名 / slug — 只读)
 *   - preset 场景 (general / smart_construction / ...)
 *   - 演示数据 seed 入口
 *   - 危险区: 暂停 / 归档 (P2 后做)
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type Me } from "@/lib/api";

export default function WorkspacePage() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
  }, []);

  if (!me) return <div className="text-sm text-zinc-500">加载中…</div>;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-medium text-white">🏢 工作空间设置</h2>
        <p className="mt-1 text-sm text-zinc-500">
          管理 当前工作空间 的基础信息 / 预置场景 / 演示数据.
        </p>
      </header>

      <section className="rounded-2xl border border-ink-700 bg-ink-900 p-6">
        <h3 className="text-sm font-medium text-zinc-300">基础信息</h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 text-sm">
          <Row k="名称" v={me.workspace_name} />
          <Row k="标识 (slug)" v={me.workspace_slug} />
          <Row k="工作空间 ID" v={<code className="text-xs">{me.workspace_id}</code>} />
        </dl>
        <p className="mt-3 text-xs text-zinc-500">
          这些字段 当前 只读. 改名 / 改 slug 走 平台超管 后台 (PLATFORM_ADMIN_EMAILS).
        </p>
      </section>

      <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
        <h3 className="text-sm font-medium text-amber-200">
          🏗️ 演示数据 / 预置场景
        </h3>
        <p className="mt-2 text-sm text-zinc-400">
          一键给本工作空间 装 智慧住建 16 AI 专家 + 演示团队 + 演示任务.
          (现有 /me/profile/demo-data 入口, 上线后整合到这里)
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href="/me/profile/demo-data"
            className="rounded-lg bg-amber-500/20 px-4 py-1.5 text-xs text-amber-200 hover:bg-amber-500/30"
          >
            → 演示数据
          </Link>
          <Link
            href="/me/profile/agents"
            className="rounded-lg border border-amber-500/30 px-4 py-1.5 text-xs text-amber-200 hover:bg-amber-500/10"
          >
            → AI 专家 (含智慧住建 16 AI seed 入口)
          </Link>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-700 bg-ink-900 p-6">
        <h3 className="text-sm font-medium text-zinc-400">🚧 即将上线</h3>
        <ul className="mt-2 space-y-1 text-xs text-zinc-500">
          <li>· 改 workspace 名 / 简介</li>
          <li>· 切换 preset 场景</li>
          <li>· 暂停 / 归档 workspace (危险)</li>
          <li>· 导出 / 导入 workspace 配置</li>
        </ul>
      </section>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-950/60 p-3">
      <dt className="text-xs text-zinc-500">{k}</dt>
      <dd className="mt-1 text-sm text-zinc-100">{v}</dd>
    </div>
  );
}
