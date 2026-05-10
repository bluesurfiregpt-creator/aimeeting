"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

/**
 * v24.2 #2 — 自然语言问数 → 图表
 *
 * 智慧住建文档 §3.3 图表生成.示范输入:
 *   - "近 7 天每天新建多少任务"
 *   - "工作量最大的 5 个人"
 *   - "任务都来自哪些触发源"
 *   - "近 30 天逾期率有变化吗"
 *
 * LLM 选 7 个预设模板之一(防 SQL 注入 + 演示稳定),前端 recharts 渲染.
 */

const SAMPLES = [
  "近 7 天每天新建多少任务",
  "工作量最大的 8 个人",
  "任务都来自哪些触发源",
  "近 30 天逾期率有变化吗",
  "按 AI 专家分组任务量",
  "近 14 天每天完成多少任务",
  "本月任务状态分布",
];

type ChartResult = Awaited<ReturnType<typeof api.chartQA>>;

const PIE_COLORS = [
  "#38bdf8", "#34d399", "#a78bfa", "#fb7185", "#fbbf24",
  "#22d3ee", "#a3e635", "#e879f9", "#60a5fa", "#4ade80",
];

export default function ChartAskPage() {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ChartResult | null>(null);

  const ask = useCallback(
    async (q?: string) => {
      const final = (q ?? question).trim();
      if (!final) {
        toast.error("请先输入问题");
        return;
      }
      setBusy(true);
      setResult(null);
      try {
        const r = await api.chartQA(final);
        setResult(r);
        if (r.fallback_used) {
          toast.error("AI 没看懂题,fallback 默认了「状态分布」", {
            detail: "可以换个问法重试",
          });
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "查询失败");
      } finally {
        setBusy(false);
      }
    },
    [question],
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-12 pt-20">
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="text-xs text-zinc-500 hover:text-zinc-200"
          >
            ← 看板
          </Link>
          <span className="text-zinc-700">·</span>
          <h1 className="text-2xl font-semibold text-white">问数</h1>
          <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-200">
            ✨ AI
          </span>
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          用自然语言问任务/会议数据,AI 自动选模板出图。智慧住建文档 §3.3.
        </p>
      </header>

      <section className="rounded-xl border border-ink-700 bg-ink-900 p-5">
        <label className="block">
          <span className="text-xs text-zinc-500">问题</span>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                ask();
              }
            }}
            rows={3}
            maxLength={500}
            placeholder="如:近 7 天每天完成多少任务?(Cmd+Enter 提交)"
            data-testid="chart-qa-input"
            className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
          />
        </label>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] text-zinc-600">
            示例 ↓ 点一下直接跑
          </span>
          <button
            type="button"
            onClick={() => ask()}
            disabled={busy || !question.trim()}
            data-testid="chart-qa-submit"
            className="rounded-lg bg-violet-500 px-4 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-violet-400 transition"
          >
            {busy ? "🤖 LLM 分析中(5-15s)…" : "✨ 问 AI"}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {SAMPLES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setQuestion(s);
                ask(s);
              }}
              disabled={busy}
              className="rounded-full border border-ink-700 bg-ink-950 px-2.5 py-1 text-[11px] text-zinc-400 hover:border-violet-500/40 hover:text-violet-200 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      {result && (
        <section
          className="mt-6 rounded-xl border border-ink-700 bg-ink-900 p-5"
          data-testid="chart-qa-result"
        >
          <header className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-medium text-white" data-testid="chart-qa-title">
                {result.title}
              </h2>
              <p className="mt-0.5 text-[10px] text-zinc-600">
                模板 <code className="text-zinc-400">{result.template}</code> ·
                {result.params.window_days && ` 近 ${result.params.window_days} 天`}
                {result.params.top_n && ` · top ${result.params.top_n}`}
                {result.fallback_used && (
                  <span className="ml-2 text-rose-400">⚠️ AI 没看懂,默认 fallback</span>
                )}
              </p>
            </div>
          </header>

          {result.data.length === 0 ? (
            <div className="py-12 text-center text-sm text-zinc-500">
              数据为空(该 workspace 在所选时段内无相关任务)
            </div>
          ) : (
            <div className="h-80 w-full" data-testid="chart-qa-chart">
              <ResponsiveContainer width="100%" height="100%">
                {result.chart_type === "pie" ? (
                  <PieChart>
                    <Pie
                      data={result.data}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={110}
                      label={(e) => `${e.name}: ${e.value}`}
                    >
                      {result.data.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "#0a0a0a",
                        border: "1px solid #27272a",
                      }}
                    />
                    <Legend />
                  </PieChart>
                ) : result.chart_type === "bar" ? (
                  <BarChart data={result.data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="name" stroke="#a1a1aa" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#a1a1aa" tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        background: "#0a0a0a",
                        border: "1px solid #27272a",
                      }}
                    />
                    <Bar dataKey="value" fill="#a78bfa" radius={[4, 4, 0, 0]} />
                  </BarChart>
                ) : (
                  <LineChart data={result.data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="name" stroke="#a1a1aa" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#a1a1aa" tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        background: "#0a0a0a",
                        border: "1px solid #27272a",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#a78bfa"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                )}
              </ResponsiveContainer>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
