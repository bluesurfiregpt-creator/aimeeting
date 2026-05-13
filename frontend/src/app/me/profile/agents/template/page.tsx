"use client";

/**
 * v26.5-WS · AI 模板生成器 (预留页)
 *
 * 未来功能: admin 输入一段场景描述 (例:"福田区住建局,房屋安全 + 物业 + ..."),
 * LLM 帮忙批量生成 N 个 AI 专家配置 (name / domain / persona / keywords / KB),
 * admin 预览 + 编辑 + 一键创建.
 *
 * 当前状态: 占位页, 展示功能轮廓 + 现有 一键 seed 16 智慧住建 AI 入口.
 */

import Link from "next/link";

export default function AgentTemplatePage() {
  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-medium text-white">✨ AI 模板生成器</h2>
        <p className="mt-1 text-sm text-zinc-500">
          用 LLM 帮你 一次性 生成 N 个 AI 专家配置 (人格 / 关键词 / KB 绑定).
          针对不同行业 / 部门 一键 装好.
        </p>
      </header>

      <section className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-6">
        <div className="flex items-start gap-3">
          <span className="text-3xl" aria-hidden>
            🚧
          </span>
          <div>
            <h3 className="text-sm font-medium text-violet-200">
              即将上线 · v26.6 计划
            </h3>
            <p className="mt-2 text-sm text-zinc-400">
              功能轮廓:
            </p>
            <ul className="mt-2 space-y-1 text-sm text-zinc-300">
              <li>1. 用 自然语言 描述场景 (如「教育局 AI 助手 5 个」)</li>
              <li>2. LLM 自动 推算 5 个 AI 专家的 name / domain / persona / 关键词 / 是否要 KB</li>
              <li>3. 预览 + 编辑 (可单个删 / 改 prompt)</li>
              <li>4. 一键批量创建 (会同时建对应 KB)</li>
              <li>5. 可选: primary_user 自动分配给 工作空间内 manager (按 domain 匹配)</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
        <h3 className="text-sm font-medium text-amber-200">
          🏗️ 当前已有 · 智慧住建 16 AI 一键 seed
        </h3>
        <p className="mt-2 text-sm text-zinc-400">
          v24.1 已经实现 — 一键给本工作空间 装上 福田区住建局 15 业务 AI + 1 住建智脑.
          入口在 AI 专家列表页 顶部 banner.
        </p>
        <Link
          href="/me/profile/agents"
          className="mt-3 inline-block rounded-lg bg-amber-500/20 px-4 py-1.5 text-xs text-amber-200 hover:bg-amber-500/30"
        >
          → 去 AI 专家列表
        </Link>
      </section>
    </div>
  );
}
