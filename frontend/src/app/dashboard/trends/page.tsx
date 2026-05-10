"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api";

/**
 * v24.2 #4 — 趋势分析 + 异常检测页(智慧住建文档 §3.3).
 *
 * 3 个指标 sparkline + 大字数 + 趋势标签 + 异常红框:
 *   每日新建任务数 / 每日完成数 / 每日逾期率
 *
 * 跟 alert_monitor 互补:
 *   alert_monitor → 反应式(创建 Task)
 *   trends 页    → 描述式(给 leader 看趋势 + 7 天预测)
 */

type TrendStat = {
  label: string;
  unit: string;
  series: { name: string; value: number }[];
  mean: number;
  std: number;
  current: number;
  z_score: number;
  slope_per_day: number;
  forecast_7d: number;
  anomaly: boolean;
  trend_label: string;
};

type TrendsData = Awaited<ReturnType<typeof api.trends>>;

const TREND_COLOR: Record<string, string> = {
  上升: "text-rose-300",
  下降: "text-emerald-300",
  平稳: "text-zinc-300",
  样本不足: "text-zinc-500",
  无数据: "text-zinc-500",
};

const TREND_EMOJI: Record<string, string> = {
  上升: "↗",
  下降: "↘",
  平稳: "→",
  样本不足: "?",
  无数据: "?",
};

function fmtNumber(n: number, unit: string) {
  if (unit === "%") return `${(n * 100).toFixed(1)}%`;
  return n.toFixed(unit === "条" ? 0 : 2);
}

function MetricCard({ stat }: { stat: TrendStat }) {
  return (
    <section
      className={`rounded-xl border p-5 ${
        stat.anomaly
          ? "border-rose-500/40 bg-rose-500/5"
          : "border-ink-700 bg-ink-900"
      }`}
      data-testid="trend-metric-card"
      data-anomaly={stat.anomaly ? "1" : "0"}
    >
      <header className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-medium text-zinc-200">{stat.label}</h3>
          {stat.anomaly && (
            <p className="mt-0.5 text-[10px] text-rose-300">
              ⚠️ 异常 z={stat.z_score.toFixed(2)}(超 2σ)
            </p>
          )}
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold text-white">
            {fmtNumber(stat.current, stat.unit)}
          </div>
          <div className={`text-[11px] ${TREND_COLOR[stat.trend_label] || ""}`}>
            {TREND_EMOJI[stat.trend_label]} {stat.trend_label}
          </div>
        </div>
      </header>

      <div className="mt-3 h-24 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={stat.series}>
            <defs>
              <linearGradient id={`g-${stat.label}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#a78bfa" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="name" hide />
            <YAxis hide />
            <Tooltip
              contentStyle={{
                background: "#0a0a0a",
                border: "1px solid #27272a",
              }}
              labelStyle={{ color: "#a1a1aa" }}
              formatter={(v) => [fmtNumber(typeof v === "number" ? v : 0, stat.unit), stat.label]}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#a78bfa"
              strokeWidth={2}
              fill={`url(#g-${stat.label})`}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] text-zinc-500">
        <div>
          <div>均值</div>
          <div className="text-zinc-300">{fmtNumber(stat.mean, stat.unit)}</div>
        </div>
        <div>
          <div>标准差</div>
          <div className="text-zinc-300">{fmtNumber(stat.std, stat.unit)}</div>
        </div>
        <div>
          <div>7 日预测</div>
          <div className="text-zinc-300">
            {fmtNumber(stat.forecast_7d, stat.unit)}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function TrendsPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<TrendsData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.trends(days);
      setData(r);
    } catch {
      // toasted by api
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-12 pt-20">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard"
              className="text-xs text-zinc-500 hover:text-zinc-200"
            >
              ← 看板
            </Link>
            <span className="text-zinc-700">·</span>
            <h1 className="text-2xl font-semibold text-white">趋势分析</h1>
            <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-200">
              ✨ AI v24.2
            </span>
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            描述式分析(只看不动作);异常 = z-score 超 ±2σ.智慧住建文档 §3.3.
          </p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(parseInt(e.target.value, 10))}
          data-testid="trends-days-select"
          className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-zinc-200 focus:border-violet-500 focus:outline-none"
        >
          {[7, 14, 30, 60, 90].map((d) => (
            <option key={d} value={d}>
              近 {d} 天
            </option>
          ))}
        </select>
      </header>

      {loading ? (
        <div className="text-sm text-zinc-500">加载中…</div>
      ) : data ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {Object.entries(data.metrics).map(([key, stat]) => (
            <MetricCard key={key} stat={stat as TrendStat} />
          ))}
        </div>
      ) : null}
    </main>
  );
}
