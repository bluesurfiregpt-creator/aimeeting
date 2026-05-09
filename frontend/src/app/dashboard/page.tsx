"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Pie,
  PieChart,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, type DashboardOverview } from "@/lib/api";
import { toast } from "@/lib/toast";

/**
 * v22 — Dashboard 看板.
 *
 * 一次拉 /api/dashboard/overview,渲染:
 *   - 顶部 4 KPI 卡(总 Task / 待签收 / 红紫灯 / 本月完成率)
 *   - 中部:状态分布饼 / assignee 工作量横条 / 30d 完成折线
 *   - 底部:触发源分布饼 / 7d 创建条 / 4 维评价雷达
 *   - 顶部 admin 还能看到「生成测试评价数据」按钮(智慧住建演示用)
 *
 * 精品 polish:
 *   - 一致的暗色主题 + 高对比配色
 *   - 加载/空/错误三态都画
 *   - 手动刷新按钮(右上角图标)
 *   - 图表 tooltip / legend 中文化
 *   - 响应式:桌面 3 列,平板 2 列,手机 1 列
 */

// 精品配色板:暖橙(警示) / 冷蓝(信息) / 翠绿(完成) / 紫(协作) / 琥珀(等待) / 深红(逾期)
const PALETTE = {
  primary: "#5b8def",
  warm: "#f59e0b",
  warmDark: "#d97706",
  cool: "#06b6d4",
  green: "#10b981",
  rose: "#f43f5e",
  red: "#ef4444",
  purple: "#a855f7",
  amber: "#fbbf24",
  zinc: "#71717a",
  zincLight: "#a1a1aa",
};

const STATUS_COLOR_MAP: Record<string, string> = {
  open: "#71717a",
  dispatched: "#fbbf24",
  accepted: "#06b6d4",
  in_progress: "#0ea5e9",
  submitted: "#a855f7",
  done: "#10b981",
  archived: "#3f3f46",
  cancelled: "#52525b",
};

const STATUS_LABEL_MAP: Record<string, string> = {
  open: "未派发",
  dispatched: "待签收",
  accepted: "已签收",
  in_progress: "办理中",
  submitted: "待审核",
  done: "已完成",
  archived: "已归档",
  cancelled: "已取消",
};

const SOURCE_COLOR_MAP: Record<string, string> = {
  meeting: "#5b8def",
  leader_directive: "#a855f7",
  upper_doc: "#f59e0b",
  cron: "#10b981",
  manual: "#71717a",
  alert: "#ef4444",
  report: "#06b6d4",
};

const SOURCE_LABEL_MAP: Record<string, string> = {
  meeting: "会议决议",
  leader_directive: "领导指令",
  upper_doc: "上级文件",
  cron: "定期巡检",
  manual: "手动",
  alert: "异常预警",
  report: "问题上报",
};

function fmtPercent(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtMonthShort(period: string): string {
  // "2026-05" → "2026年5月"
  const m = period.match(/^(\d{4})-(\d{2})$/);
  if (!m) return period;
  return `${m[1]}年${parseInt(m[2], 10)}月`;
}

// ---- KPI Card ---------------------------------------------------------------

function KpiCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "neutral" | "warn" | "danger" | "good";
}) {
  const toneCls = {
    neutral: "border-ink-700 text-zinc-100",
    warn: "border-amber-500/40 text-amber-300",
    danger: "border-red-500/40 text-red-300",
    good: "border-emerald-500/40 text-emerald-300",
  }[tone];
  return (
    <div
      className={`rounded-xl border ${toneCls} bg-ink-900 p-5 transition hover:border-opacity-80`}
      data-testid={`kpi-${label}`}
    >
      <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
      {hint ? (
        <div className="mt-1 text-xs text-zinc-500">{hint}</div>
      ) : null}
    </div>
  );
}

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-xl border border-ink-700 bg-ink-900 p-5"
      data-testid={`chart-${title}`}
    >
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-white">{title}</h3>
        {hint ? <span className="text-xs text-zinc-500">{hint}</span> : null}
      </header>
      {children}
    </section>
  );
}

// ---- 各图表 -----------------------------------------------------------------

function StatusPie({ data }: { data: DashboardOverview["by_status"] }) {
  if (!data.length) {
    return (
      <p className="text-xs text-zinc-500" data-testid="empty-status">
        暂无数据
      </p>
    );
  }
  const chartData = data.map((d) => ({
    name: STATUS_LABEL_MAP[d.status] || d.status,
    value: d.count,
    rawStatus: d.status,
  }));
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
            isAnimationActive
          >
            {chartData.map((entry) => (
              <Cell
                key={entry.rawStatus}
                fill={STATUS_COLOR_MAP[entry.rawStatus] || PALETTE.zinc}
                stroke="#0b0d12"
                strokeWidth={2}
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: "#11141b",
              border: "1px solid #1f2430",
              borderRadius: 6,
            }}
            labelStyle={{ color: "#fff" }}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, color: "#a1a1aa" }}
            iconSize={8}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function SourcePie({ data }: { data: DashboardOverview["by_source"] }) {
  if (!data.length) {
    return (
      <p className="text-xs text-zinc-500" data-testid="empty-source">
        暂无数据
      </p>
    );
  }
  const chartData = data.map((d) => ({
    name: SOURCE_LABEL_MAP[d.source_type] || d.source_type,
    value: d.count,
    rawSource: d.source_type,
  }));
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
          >
            {chartData.map((entry) => (
              <Cell
                key={entry.rawSource}
                fill={SOURCE_COLOR_MAP[entry.rawSource] || PALETTE.zinc}
                stroke="#0b0d12"
                strokeWidth={2}
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: "#11141b",
              border: "1px solid #1f2430",
              borderRadius: 6,
            }}
            labelStyle={{ color: "#fff" }}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, color: "#a1a1aa" }}
            iconSize={8}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function WorkloadChart({ data }: { data: DashboardOverview["workload"] }) {
  if (!data.length) {
    return (
      <p className="text-xs text-zinc-500" data-testid="empty-workload">
        暂无活跃任务
      </p>
    );
  }
  const chartData = [...data].reverse(); // top 在上
  return (
    <div className="h-72">
      <ResponsiveContainer>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ left: 8, right: 8, top: 8, bottom: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2430" horizontal={false} />
          <XAxis
            type="number"
            allowDecimals={false}
            stroke="#71717a"
            fontSize={11}
          />
          <YAxis
            type="category"
            dataKey="name"
            stroke="#a1a1aa"
            fontSize={11}
            width={80}
          />
          <Tooltip
            contentStyle={{
              background: "#11141b",
              border: "1px solid #1f2430",
              borderRadius: 6,
            }}
            labelStyle={{ color: "#fff" }}
            formatter={(v, name) => [
              String(v ?? 0),
              name === "open_count" ? "活跃任务" : "其中已逾期",
            ]}
          />
          <Bar
            dataKey="open_count"
            fill={PALETTE.primary}
            stackId="a"
            radius={[0, 4, 4, 0]}
          />
          <Bar
            dataKey="overdue_count"
            fill={PALETTE.red}
            stackId="b"
            radius={[0, 4, 4, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CompletionLine({
  data,
}: {
  data: DashboardOverview["completion_30d"];
}) {
  if (!data.length) {
    return (
      <p className="text-xs text-zinc-500" data-testid="empty-completion">
        暂无 30 天数据
      </p>
    );
  }
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <LineChart
          data={data}
          margin={{ left: 0, right: 16, top: 8, bottom: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2430" />
          <XAxis
            dataKey="date"
            stroke="#71717a"
            fontSize={10}
            tickFormatter={(d: string) => d.slice(5)}
            interval={4}
          />
          <YAxis stroke="#71717a" fontSize={11} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              background: "#11141b",
              border: "1px solid #1f2430",
              borderRadius: 6,
            }}
            labelStyle={{ color: "#fff" }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: "#a1a1aa" }} />
          <Line
            type="monotone"
            dataKey="completed"
            name="完成"
            stroke={PALETTE.green}
            strokeWidth={2}
            dot={{ r: 2, fill: PALETTE.green }}
            activeDot={{ r: 5 }}
          />
          <Line
            type="monotone"
            dataKey="created"
            name="创建"
            stroke={PALETTE.cool}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function CreationBars({ data }: { data: DashboardOverview["creation_7d"] }) {
  if (!data.length) {
    return (
      <p className="text-xs text-zinc-500" data-testid="empty-creation">
        暂无 7 天数据
      </p>
    );
  }
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2430" />
          <XAxis
            dataKey="date"
            stroke="#71717a"
            fontSize={11}
            tickFormatter={(d: string) => d.slice(5)}
          />
          <YAxis stroke="#71717a" fontSize={11} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              background: "#11141b",
              border: "1px solid #1f2430",
              borderRadius: 6,
            }}
            labelStyle={{ color: "#fff" }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: "#a1a1aa" }} />
          <Bar
            dataKey="created"
            name="创建"
            fill={PALETTE.cool}
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function EvaluationRadar({
  data,
}: {
  data: DashboardOverview["evaluations"];
}) {
  if (!data.length) {
    return (
      <p className="text-xs text-zinc-500" data-testid="empty-evaluation">
        暂无本月评价数据
      </p>
    );
  }
  // 选 top 3 入雷达(>3 个雷达图会糊)
  const top = data.slice(0, 3);
  // 把数据转成雷达需要的形状:每个维度一行,每个 user 一列
  const dims = [
    { name: "完成率", key: "completion_rate" as const },
    { name: "及时率", key: "on_time_rate" as const },
    { name: "质量", key: "quality_score" as const },
    { name: "协作", key: "collaboration_score" as const },
  ];
  const chartData = dims.map((d) => {
    const row: Record<string, number | string> = { dimension: d.name };
    for (const u of top) row[u.name] = u[d.key];
    return row;
  });
  const colors = [PALETTE.primary, PALETTE.green, PALETTE.purple];
  return (
    <div className="h-72">
      <ResponsiveContainer>
        <RadarChart data={chartData} outerRadius="75%">
          <PolarGrid stroke="#1f2430" />
          <PolarAngleAxis dataKey="dimension" stroke="#a1a1aa" fontSize={11} />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 1]}
            stroke="#71717a"
            fontSize={10}
            tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
          />
          {top.map((u, i) => (
            <Radar
              key={u.user_id}
              name={u.name}
              dataKey={u.name}
              stroke={colors[i % colors.length]}
              fill={colors[i % colors.length]}
              fillOpacity={0.18}
              strokeWidth={2}
            />
          ))}
          <Legend
            wrapperStyle={{ fontSize: 12, color: "#a1a1aa" }}
            iconSize={8}
          />
          <Tooltip
            contentStyle={{
              background: "#11141b",
              border: "1px solid #1f2430",
              borderRadius: 6,
            }}
            labelStyle={{ color: "#fff" }}
            formatter={(v) => fmtPercent(typeof v === "number" ? v : 0)}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---- 页面主体 --------------------------------------------------------------

export default function DashboardPage() {
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.dashboardOverview();
      setData(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "看板加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onSeed = useCallback(async () => {
    if (seeding) return;
    if (!confirm("将为本月生成测试评价数据(智慧住建演示)?\n已有数据不会覆盖,只补缺.")) return;
    setSeeding(true);
    try {
      const r = await api.seedEvalData(null, false);
      toast.success(
        `Seed 完成 (${r.period})`,
        { detail: `+${r.inserted} 新增 / ${r.updated} 更新` },
      );
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Seed 失败");
    } finally {
      setSeeding(false);
    }
  }, [seeding, refresh]);

  const isLeader = data?.role === "leader";

  // 派生:总 active = 全状态分布扣掉终态
  const activeTotal = useMemo(() => {
    if (!data) return 0;
    return data.by_status
      .filter((s) => !["done", "archived", "cancelled"].includes(s.status))
      .reduce((acc, s) => acc + s.count, 0);
  }, [data]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-12 pt-20">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">看板</h1>
          {data ? (
            <p className="mt-1 text-sm text-zinc-500">
              {data.scope_label}
              <span className="mx-2 text-zinc-700">·</span>
              {fmtMonthShort(data.period)}
              <span className="mx-2 text-zinc-700">·</span>
              <span className="text-zinc-600">
                角色:{data.role === "leader" ? "领导/管理员" : data.role === "expert" ? "AI 专家用户" : "普通成员"}
              </span>
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {isLeader ? (
            <button
              type="button"
              onClick={onSeed}
              disabled={seeding}
              data-testid="dashboard-seed-eval"
              className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-ink-800 disabled:opacity-50"
              title="为本月生成评价 seed 数据(智慧住建演示)"
            >
              {seeding ? "生成中…" : "🌱 Seed 评价"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            data-testid="dashboard-refresh"
            className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-ink-800 disabled:opacity-50"
          >
            {loading ? "刷新中…" : "↻ 刷新"}
          </button>
        </div>
      </header>

      {/* 加载 / 错误态 */}
      {loading && !data ? (
        <div
          className="rounded-xl border border-ink-700 bg-ink-900 p-12 text-center text-sm text-zinc-500"
          data-testid="dashboard-loading"
        >
          看板加载中…
        </div>
      ) : err ? (
        <div
          className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-6 text-sm text-rose-300"
          data-testid="dashboard-error"
        >
          {err}
        </div>
      ) : data ? (
        <>
          {/* v23: 看板二期 + 报表入口 — 三张精品卡片,leader/admin 全可见,
              expert/member 只看到 Kanban(报表 leader-only) */}
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Link
              href="/dashboard/kanban-agents"
              data-testid="entry-kanban-agents"
              className="group rounded-xl border border-ink-700 bg-ink-900 p-4 hover:border-cyan-500/40 hover:bg-ink-800/50 transition"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl" aria-hidden>🤖</span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-100 group-hover:text-cyan-200 transition">
                    AI 专家 Kanban
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    每个 AI 专家一列,看 16 集群 谁忙谁闲
                  </div>
                </div>
              </div>
            </Link>
            <Link
              href="/dashboard/kanban-users"
              data-testid="entry-kanban-users"
              className="group rounded-xl border border-ink-700 bg-ink-900 p-4 hover:border-emerald-500/40 hover:bg-ink-800/50 transition"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl" aria-hidden>👥</span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-100 group-hover:text-emerald-200 transition">
                    科长 Kanban
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    按 assignee 分列,管事的人一目了然
                  </div>
                </div>
              </div>
            </Link>
            {isLeader ? (
              <Link
                href="/dashboard/reports"
                data-testid="entry-reports"
                className="group rounded-xl border border-ink-700 bg-ink-900 p-4 hover:border-amber-500/40 hover:bg-ink-800/50 transition"
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl" aria-hidden>📊</span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-100 group-hover:text-amber-200 transition">
                      报表中心
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      月度评价 / 状态分布 一键导出 Excel
                    </div>
                  </div>
                </div>
              </Link>
            ) : (
              <div className="rounded-xl border border-ink-800 bg-ink-950/50 p-4 opacity-50">
                <div className="flex items-start gap-3">
                  <span className="text-2xl" aria-hidden>📊</span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-500">报表中心</div>
                    <div className="mt-0.5 text-[10px] text-zinc-600">
                      仅领导/管理员可访问
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 顶部 4 KPI 卡 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="总任务"
              value={data.total_tasks.toLocaleString()}
              hint={`其中 ${activeTotal.toLocaleString()} 活跃`}
            />
            <KpiCard
              label="待签收"
              value={data.pending_review.toLocaleString()}
              hint="status=dispatched"
              tone={data.pending_review > 0 ? "warn" : "neutral"}
            />
            <KpiCard
              label="已逾期"
              value={data.overdue_red_purple.toLocaleString()}
              hint="超过截止 + 未办结"
              tone={data.overdue_red_purple > 0 ? "danger" : "neutral"}
            />
            <KpiCard
              label="本月完成率"
              value={fmtPercent(data.completion_rate_this_month)}
              hint="本月 done / 本月所有非取消"
              tone={
                data.completion_rate_this_month >= 0.8
                  ? "good"
                  : data.completion_rate_this_month >= 0.5
                  ? "neutral"
                  : "warn"
              }
            />
          </div>

          {/* 中部 3 图 */}
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card title="状态分布" hint="按 Task.status">
              <StatusPie data={data.by_status} />
            </Card>
            <Card title="工作量 Top 10" hint="活跃任务数(其中红=已逾期)">
              <WorkloadChart data={data.workload} />
            </Card>
            <Card title="30 天完成趋势" hint="日均完成 vs 创建">
              <CompletionLine data={data.completion_30d} />
            </Card>
          </div>

          {/* 底部 3 图 */}
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card title="触发源分布" hint="按 source_type">
              <SourcePie data={data.by_source} />
            </Card>
            <Card title="近 7 天新建" hint="日 Task 创建数">
              <CreationBars data={data.creation_7d} />
            </Card>
            <Card
              title="本月评价 Top 3"
              hint={
                data.evaluations.length === 0 && isLeader
                  ? "🌱 Seed 评价 → 即可看到雷达"
                  : "完成率/及时率/质量/协作 4 维"
              }
            >
              <EvaluationRadar data={data.evaluations} />
            </Card>
          </div>

          <p className="mt-6 text-center text-xs text-zinc-700">
            数据范围:{data.scope_label} · 评价 seed 仅作演示 · 真实月度评价 v23+ 自动跑
          </p>
        </>
      ) : null}
    </main>
  );
}
