"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

/**
 * v23 — 报表中心 (Excel only).
 *
 * 两个报表:
 *   - 月度评价 — 选月份 → 导出当月 4 维评价表
 *   - 状态分布趋势 — 选「最近 N 天」(7/14/30/60/90) → 导出
 *
 * 精品 polish:
 *   - 月份默认本月,可下拉历史月份(过去 12 个月)
 *   - 下载时显示 spinner,失败显示 toast
 *   - 顶部「政务用户拿到后会自己挑数据着色」一句小提示
 */

function lastNMonths(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    out.push(`${yyyy}-${mm}`);
  }
  return out;
}

function fmtMonthShort(period: string): string {
  const m = period.match(/^(\d{4})-(\d{2})$/);
  if (!m) return period;
  return `${m[1]} 年 ${parseInt(m[2], 10)} 月`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const months = lastNMonths(12);
  const [period, setPeriod] = useState<string>(months[0]);
  const [days, setDays] = useState<number>(30);
  const [busyEval, setBusyEval] = useState(false);
  const [busyDist, setBusyDist] = useState(false);

  const onDownloadEval = useCallback(async () => {
    if (busyEval) return;
    setBusyEval(true);
    try {
      const { blob, filename } = await api.downloadMonthlyEvaluation(period);
      triggerDownload(blob, filename);
      toast.success(`已导出:${filename}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导出失败");
    } finally {
      setBusyEval(false);
    }
  }, [busyEval, period]);

  const onDownloadDist = useCallback(async () => {
    if (busyDist) return;
    setBusyDist(true);
    try {
      const { blob, filename } = await api.downloadStatusDistribution(days);
      triggerDownload(blob, filename);
      toast.success(`已导出:${filename}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导出失败");
    } finally {
      setBusyDist(false);
    }
  }, [busyDist, days]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 pt-20">
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="text-xs text-zinc-500 hover:text-zinc-200"
          >
            ← 看板
          </Link>
          <span className="text-zinc-700">·</span>
          <h1 className="text-2xl font-semibold text-white">报表中心</h1>
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          导出 Excel 表格 — 拿到后可以在 Excel 里自己改表头 / 着色 / 挑数据.
        </p>
      </header>

      <div className="space-y-4">
        {/* 月度评价 */}
        <section
          data-testid="report-monthly-eval"
          className="rounded-xl border border-ink-700 bg-ink-900 p-5"
        >
          <div className="flex items-start gap-3">
            <span className="text-2xl" aria-hidden>📋</span>
            <div className="flex-1">
              <h2 className="text-base font-medium text-white">月度 4 维评价</h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                全员一行一份 — 完成率 / 及时率 / 质量分 / 协作分 / 综合分 / 累计指标
              </p>
              <div className="mt-3 flex items-center gap-3">
                <label className="text-xs text-zinc-400">
                  周期
                  <select
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                    data-testid="report-eval-period"
                    className="ml-2 rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-zinc-200 focus:border-accent-500 focus:outline-none"
                  >
                    {months.map((m) => (
                      <option key={m} value={m}>
                        {fmtMonthShort(m)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={onDownloadEval}
                  disabled={busyEval}
                  data-testid="report-eval-download"
                  className="rounded-lg bg-accent-500 px-4 py-1.5 text-sm font-medium text-white shadow disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-400 transition"
                >
                  {busyEval ? "导出中…" : "↓ 导出 Excel"}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* 状态分布趋势 */}
        <section
          data-testid="report-status-dist"
          className="rounded-xl border border-ink-700 bg-ink-900 p-5"
        >
          <div className="flex items-start gap-3">
            <span className="text-2xl" aria-hidden>📈</span>
            <div className="flex-1">
              <h2 className="text-base font-medium text-white">状态分布趋势</h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                每天一行 · 8 个状态各自计数 · 当日新建 / 完成数 — 看「积压在改善吗」
              </p>
              <div className="mt-3 flex items-center gap-3">
                <label className="text-xs text-zinc-400">
                  区间
                  <select
                    value={days}
                    onChange={(e) => setDays(parseInt(e.target.value, 10))}
                    data-testid="report-dist-days"
                    className="ml-2 rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-zinc-200 focus:border-accent-500 focus:outline-none"
                  >
                    <option value={7}>近 7 天</option>
                    <option value={14}>近 14 天</option>
                    <option value={30}>近 30 天</option>
                    <option value={60}>近 60 天</option>
                    <option value={90}>近 90 天</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={onDownloadDist}
                  disabled={busyDist}
                  data-testid="report-dist-download"
                  className="rounded-lg bg-accent-500 px-4 py-1.5 text-sm font-medium text-white shadow disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-400 transition"
                >
                  {busyDist ? "导出中…" : "↓ 导出 Excel"}
                </button>
              </div>
            </div>
          </div>
        </section>

        <p className="text-center text-xs text-zinc-700">
          季度报告 / 年度报告 / PDF 格式 — 留 v23.5+
        </p>
      </div>
    </main>
  );
}
