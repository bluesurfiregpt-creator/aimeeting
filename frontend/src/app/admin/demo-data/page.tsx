"use client";

/**
 * v25-1 — 演示数据 管理面板.
 *
 * 两个核心动作:
 *  1. ⚠️ 清除所有业务数据(双确认 + 输入工作空间名 二次校验)
 *  2. 🎬 一键灌入演示场景(16 AI + 19 用户 + 10 会议 + 30 任务 + 48 KB 文档)
 *
 * 仅 leader / admin 可调用 — 后端 require_leader_or_admin 已守.
 */

import { useState } from "react";
import { toast } from "@/lib/toast";

const API_BASE = "";

type WipeResult = {
  rows_deleted: Record<string, number>;
  total: number;
};

type SeedResult = {
  summary: Record<string, unknown>;
};

export default function DemoDataAdmin() {
  const [wipeConfirmText, setWipeConfirmText] = useState("");
  const [wipeBusy, setWipeBusy] = useState(false);
  const [wipeResult, setWipeResult] = useState<WipeResult | null>(null);
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedKbDocuments, setSeedKbDocuments] = useState(true);
  const [seedResult, setSeedResult] = useState<SeedResult | null>(null);

  const wipeAll = async () => {
    if (wipeConfirmText !== "WIPE") {
      toast.error('请在输入框里输入 "WIPE" 大写4个字母确认');
      return;
    }
    if (!confirm("⚠️ 这一步会删除当前 workspace 所有业务数据(任务/会议/KB/通知/审计/...).\n\n保留:用户账号本身 + 工作空间设置.\n\n你确定要清除吗?")) {
      return;
    }
    setWipeBusy(true);
    setWipeResult(null);
    try {
      const r = await fetch(`${API_BASE}/api/dashboard/wipe-demo-data`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: "yes_wipe_all_demo_data",
          wipe_voiceprints: true,
        }),
      });
      if (!r.ok) {
        const err = await r.text();
        throw new Error(`${r.status}: ${err}`);
      }
      const result = await r.json();
      setWipeResult(result);
      setWipeConfirmText("");
      toast.success(`✅ 已清除 ${result.total} 行数据`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`清除失败: ${msg}`);
    } finally {
      setWipeBusy(false);
    }
  };

  const seedAll = async () => {
    if (!confirm("🎬 这一步会创建 16 AI + 19 demo 用户(密码 demo123) + 10 历史会议 + 30 任务 + 48 KB 文档.\n\n建议先点上面的 ⚠️ 清除,再 seed,从干净状态开始.\n\n要继续吗?")) {
      return;
    }
    setSeedBusy(true);
    setSeedResult(null);
    try {
      const r = await fetch(`${API_BASE}/api/dashboard/seed-demo-scenario`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed_kb_documents: seedKbDocuments }),
      });
      if (!r.ok) {
        const err = await r.text();
        throw new Error(`${r.status}: ${err}`);
      }
      const result = await r.json();
      setSeedResult(result);
      toast.success(`✅ 演示场景已就绪`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Seed 失败: ${msg}`);
    } finally {
      setSeedBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-white">演示数据管理</h2>
        <p className="mt-2 text-sm text-zinc-400">
          客户演示前 一键清除 + 灌入完整智慧住建场景.建议顺序:先 ⚠️ 清除,再 🎬 seed.
        </p>
      </div>

      {/* ========== Wipe ========== */}
      <section className="rounded-2xl border-2 border-rose-500/30 bg-rose-500/5 p-6">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-rose-200">
          <span>⚠️</span> 清除当前 workspace 所有业务数据
        </h3>
        <div className="mt-3 space-y-2 text-sm text-zinc-300">
          <p className="text-rose-200">
            这是 <b>不可逆</b> 操作.成功后:
          </p>
          <ul className="ml-4 list-disc space-y-1 text-zinc-300">
            <li>清除:任务、会议、转写、Agent 发言、知识库 + 文档 + chunks、长期记忆、领导指令、上级文件、通知、审计日志、cron 规则、声纹、Agent 配置(16 AI 会被删,seed 时重建)</li>
            <li>保留:登录用户(包括你自己)、工作空间本身、LLM 模型配置</li>
          </ul>
          <p className="mt-2 text-zinc-400">
            注:演示用户(demo.xxx@futian.gov.cn)若已存在不会重复创建,seed 时会复用.
          </p>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="block text-xs uppercase tracking-wider text-rose-300">
              输入 <code className="rounded bg-rose-500/20 px-1.5 py-0.5">WIPE</code> 确认
            </label>
            <input
              value={wipeConfirmText}
              onChange={(e) => setWipeConfirmText(e.target.value)}
              placeholder="WIPE"
              className="mt-1 w-full rounded-lg border border-rose-500/30 bg-ink-900/60 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-rose-400 focus:outline-none"
              disabled={wipeBusy}
            />
          </div>
          <button
            onClick={wipeAll}
            disabled={wipeBusy || wipeConfirmText !== "WIPE"}
            className="rounded-lg bg-rose-600 px-6 py-2 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500"
          >
            {wipeBusy ? "清除中..." : "⚠️ 立即清除"}
          </button>
        </div>

        {wipeResult && (
          <div className="mt-5 rounded-lg border border-rose-500/20 bg-ink-950/40 p-4">
            <div className="text-sm font-semibold text-rose-200">
              ✅ 已清除 {wipeResult.total} 行
            </div>
            <table className="mt-2 w-full text-xs text-zinc-400">
              <tbody>
                {Object.entries(wipeResult.rows_deleted)
                  .filter(([, v]) => v > 0)
                  .map(([k, v]) => (
                    <tr key={k} className="border-b border-ink-800">
                      <td className="py-1 pr-3 font-mono text-zinc-500">{k}</td>
                      <td className="py-1 text-right text-zinc-200">{v}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ========== Seed ========== */}
      <section className="rounded-2xl border-2 border-violet-500/30 bg-violet-500/5 p-6">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-violet-200">
          <span>🎬</span> 一键灌入智慧住建演示场景
        </h3>
        <div className="mt-3 space-y-2 text-sm text-zinc-300">
          <p>
            幂等 — 已存在的 demo 用户 / Agent 会跳过.建议先清除再 seed.
          </p>
          <ul className="ml-4 list-disc space-y-1 text-zinc-300">
            <li>16 AI 智慧住建专家(15 业务 + 1 住建智脑)</li>
            <li>19 demo 用户(密码 <code className="rounded bg-violet-500/20 px-1.5 py-0.5">demo123</code>),覆盖 leader / admin / expert / member 各角色 + 5 部门</li>
            <li>10 会议(7 已结束含 transcript / agent message / action item;2 进行中;1 计划中)</li>
            <li>30 任务(各状态分布,可激活看板/趋势/月度评价)</li>
            <li>5 上级文件 + 5 领导指令(LLM 拆解结果已 mock)</li>
            <li>16 AI × 3 篇 KB 文档 = 48 篇,含 embedding(实测 30-60s)</li>
          </ul>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={seedKbDocuments}
            onChange={(e) => setSeedKbDocuments(e.target.checked)}
            className="rounded border-violet-500/30 bg-ink-900/60"
            disabled={seedBusy}
          />
          灌入 48 篇 KB 文档(取消可加快 seed,但 Agent 引用会空)
        </label>

        <div className="mt-5">
          <button
            onClick={seedAll}
            disabled={seedBusy}
            className="rounded-lg bg-violet-600 px-6 py-2 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500"
          >
            {seedBusy ? "Seed 中(可能 30-60s,KB embedding 耗时)..." : "🎬 一键 seed 演示场景"}
          </button>
        </div>

        {seedResult && (
          <div className="mt-5 rounded-lg border border-violet-500/20 bg-ink-950/40 p-4">
            <div className="text-sm font-semibold text-violet-200">✅ 演示场景已就绪</div>
            <table className="mt-2 w-full text-xs text-zinc-400">
              <tbody>
                {Object.entries(seedResult.summary).map(([k, v]) => (
                  <tr key={k} className="border-b border-ink-800">
                    <td className="py-1 pr-3 font-mono text-zinc-500">{k}</td>
                    <td className="py-1 text-right text-zinc-200">{String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 text-xs text-zinc-400">
              下一步:用 <code className="rounded bg-violet-500/15 px-1 py-0.5">demo.lijg@futian.gov.cn</code>(局长 / leader 角色) 或任意 demo.xxx@futian.gov.cn 账号(密码 <code className="rounded bg-violet-500/15 px-1 py-0.5">demo123</code>)登录,体验完整业务场景.
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
