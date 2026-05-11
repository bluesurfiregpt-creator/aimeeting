"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  api,
  CLASSIFICATION_BADGE_CLASSES,
  CLASSIFICATION_LABELS,
  type RoutePreview,
  type TaskDetail,
} from "@/lib/api";
import { toast } from "@/lib/toast";

/**
 * v23.5 — /task/[id] 任务详情页.
 *
 * 哲学:
 *   - 一个页面看完一个任务的全部上下文(基本+时间线+协办+评分+评论)
 *   - 不重复 /me 的操作能力(签收/退回/上报/审核 在 /me 完成,详情页只读)
 *   - 通知 / Kanban / Trace 的 Task 卡都 deeplink 到这里
 */

const STATUS_LABEL: Record<string, string> = {
  open: "未派发",
  dispatched: "待签收",
  accepted: "已签收",
  in_progress: "办理中",
  submitted: "待审核",
  done: "已完成",
  archived: "已归档",
  cancelled: "已取消",
};

const STATUS_COLOR: Record<string, string> = {
  open: "bg-zinc-700 text-zinc-300",
  dispatched: "bg-amber-500/20 text-amber-300",
  accepted: "bg-cyan-500/20 text-cyan-300",
  in_progress: "bg-sky-500/20 text-sky-300",
  submitted: "bg-violet-500/20 text-violet-300",
  done: "bg-emerald-500/20 text-emerald-300",
  archived: "bg-zinc-800 text-zinc-500",
  cancelled: "bg-zinc-800 text-zinc-500 line-through",
};

const TIMELINE_LABEL: Record<string, string> = {
  created: "创建",
  dispatched: "派发",
  accepted: "签收",
  started: "开始办理",
  submitted: "上报办结",
  done: "已办结",
  archived: "已归档",
  cancelled: "已取消",
};

const TIMELINE_COLOR: Record<string, string> = {
  created: "bg-zinc-500",
  dispatched: "bg-amber-400",
  accepted: "bg-cyan-400",
  started: "bg-sky-400",
  submitted: "bg-violet-400",
  done: "bg-emerald-400",
  archived: "bg-zinc-600",
  cancelled: "bg-zinc-600",
};

const SOURCE_LABEL: Record<string, string> = {
  meeting: "会议",
  manual: "手工",
  leader_directive: "领导指令",
  upper_doc: "上级文件",
  cron: "定期巡检",
  alert: "异常预警",
  report: "问题上报",
};

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("zh-CN");
  } catch {
    return iso;
  }
}

function StarBar({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-xs" aria-label={`${score} / 5 颗星`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= score ? "text-amber-400" : "text-zinc-700"}>
          ★
        </span>
      ))}
    </span>
  );
}

// v25.17: AI 派发助手 — 替代原来的 "AI 自动派发(4-维评分)" 区
// 自适应置信度:
//   ≥ 0.50 高置信 → 大字"建议派给 X" + 一键派发
//   0.30-0.50 中等 → "倾向 X 但不确定" + 4 维分项 + top 3
//   < 0.30 低置信 → "AI 没把握" + 解释 + 候选列表 让用户手选
function SmartDispatchSection({
  taskId,
  preview,
  previewLoading,
  loadPreview,
  autoRouting,
  onAutoRoute,
}: {
  taskId: string;
  preview: RoutePreview | null;
  previewLoading: boolean;
  loadPreview: () => Promise<void>;
  autoRouting: boolean;
  onAutoRoute: () => Promise<void>;
}) {
  // 进入页面自动跑评分
  useEffect(() => {
    if (!preview && !previewLoading) {
      void loadPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // 没数据 / 加载中
  if (!preview && previewLoading) {
    return (
      <section className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🤖</span>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-amber-200">AI 派发助手</h2>
            <div className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
              AI 正在评估这条任务适合派给谁…
            </div>
          </div>
        </div>
      </section>
    );
  }
  if (!preview) {
    return null;
  }

  const topScore = preview.candidates[0]?.composite ?? 0;
  const topCand = preview.candidates[0];
  const HIGH = 0.50;
  const LOW = 0.30;
  const level = topScore >= HIGH ? "high" : topScore >= LOW ? "mid" : "low";

  const dimLabel: Record<string, string> = {
    keyword: "关键词匹配",
    history: "历史经验",
    load: "当前负载",
    capability: "能力标签",
  };
  const dimHelp: Record<string, string> = {
    keyword: "任务内容与专家的擅长领域 是否吻合",
    history: "该专家以前处理过类似任务的次数",
    load: "该专家当前待办量(越低 / 派给他越合适)",
    capability: "专家档案里 标注的关联领域是否覆盖",
  };

  const Dim = ({ name, score }: { name: keyof typeof dimLabel; score: number }) => (
    <div className="flex items-center gap-2" title={dimHelp[name]}>
      <span className="w-20 text-[10px] text-zinc-500">{dimLabel[name]}</span>
      <div className="h-1.5 flex-1 rounded-full bg-ink-800">
        <div
          className="h-full rounded-full bg-amber-400"
          style={{ width: `${Math.min(100, score * 100)}%` }}
        />
      </div>
      <span className="w-9 font-mono text-[10px] text-amber-200">
        {score.toFixed(2)}
      </span>
    </div>
  );

  // 高置信:醒目卡片 + 一键派发
  if (level === "high" && topCand) {
    return (
      <section className="mt-6 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5"
        data-testid="task-detail-auto-route">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🤖</span>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-emerald-200">
              AI 推荐 · 高置信
            </h2>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              AI 已评估完 — 这条任务最适合下面这位.确认后一键派发,生成正式工单.
            </p>

            <div className="mt-4 rounded-lg border border-emerald-500/40 bg-ink-950/40 p-4">
              <div className="flex items-baseline gap-3">
                <span className="text-2xl">🥇</span>
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-semibold text-white">
                    {topCand.candidate_user_name || "?"}
                  </div>
                  <div className="text-xs text-zinc-500">
                    匹配的 AI 专家:{topCand.agent_name} · 该专家目前 {topCand.candidate_user_active_count} 个进行中任务
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-2xl font-semibold text-emerald-300">
                    {topScore.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-zinc-600">综合得分 / 满分 1.00</div>
                </div>
              </div>
              <div className="mt-3 space-y-1.5 text-xs">
                <Dim name="keyword" score={topCand.breakdown.keyword} />
                <Dim name="history" score={topCand.breakdown.history} />
                <Dim name="load" score={topCand.breakdown.load} />
                <Dim name="capability" score={topCand.breakdown.capability} />
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={onAutoRoute}
                disabled={autoRouting}
                data-testid="task-auto-route-btn"
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {autoRouting ? "派发中…" : `✅ 确认派发给 ${topCand.candidate_user_name}`}
              </button>
              <button
                onClick={loadPreview}
                disabled={previewLoading}
                className="rounded-lg border border-ink-700 px-3 py-2 text-xs text-zinc-400 hover:bg-ink-800"
              >
                {previewLoading ? "重算中…" : "🔄 重新评估"}
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // 中等置信:倾向 X 但不确定 + 4 维分项 + top 3
  if (level === "mid" && topCand) {
    return (
      <section className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-5"
        data-testid="task-detail-auto-route">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🤖</span>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-amber-200">
              AI 推荐 · 中等置信
            </h2>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              AI 倾向派给 <b className="text-amber-200">{topCand.candidate_user_name}</b>,但
              不太确定 — 可能这条任务跨多个领域 / 历史样本少.建议你看下评分后再拍板.
            </p>

            <ol className="mt-3 space-y-2">
              {preview.candidates.slice(0, 3).map((c, i) => (
                <li
                  key={c.agent_id}
                  className={`rounded-lg px-3 py-2 ${
                    i === 0
                      ? "border border-amber-500/40 bg-amber-500/10"
                      : "border border-ink-700 bg-ink-950"
                  }`}
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-zinc-100">
                      {i === 0 && "🥇 "}
                      {i === 1 && "🥈 "}
                      {i === 2 && "🥉 "}
                      <b>{c.candidate_user_name || "?"}</b>
                      <span className="ml-2 text-[11px] text-zinc-500">
                        ({c.agent_name})
                      </span>
                    </span>
                    <span className="font-mono text-sm text-amber-200">
                      {c.composite.toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1 text-xs">
                    <Dim name="keyword" score={c.breakdown.keyword} />
                    <Dim name="history" score={c.breakdown.history} />
                    <Dim name="load" score={c.breakdown.load} />
                    <Dim name="capability" score={c.breakdown.capability} />
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-4 flex gap-2">
              <button
                onClick={onAutoRoute}
                disabled={autoRouting}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950 hover:bg-amber-400 disabled:opacity-50"
              >
                {autoRouting ? "派发中…" : `🤖 派给 AI 首选 ${topCand.candidate_user_name}`}
              </button>
              <button
                onClick={loadPreview}
                disabled={previewLoading}
                className="rounded-lg border border-ink-700 px-3 py-2 text-xs text-zinc-400 hover:bg-ink-800"
              >
                🔄 重新评估
              </button>
              <span className="self-center text-[11px] text-zinc-500">
                或在 /me 页面 手动选 assignee
              </span>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // 低置信:AI 没把握 + 解释为什么 + 让用户手选
  return (
    <section className="mt-6 rounded-lg border border-rose-500/30 bg-rose-500/5 p-5"
      data-testid="task-detail-auto-route">
      <div className="flex items-start gap-3">
        <span className="text-2xl">🤷</span>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-rose-200">
            AI 没把握 — 请你手动选
          </h2>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            AI 综合得分 {topScore.toFixed(2)} 低于 阈值 {preview.threshold.toFixed(2)}.可能的原因:
          </p>
          <ul className="mt-1 ml-4 list-disc space-y-0.5 text-[11px] text-zinc-500">
            {topCand && topCand.breakdown.keyword < 0.2 && (
              <li>任务内容里 没出现明确的业务术语 → 任何专家的关键词都没命中</li>
            )}
            {topCand && topCand.breakdown.history < 0.2 && (
              <li>没人处理过类似任务 → 没历史样本可参考</li>
            )}
            {topCand && topCand.breakdown.capability < 0.05 && (
              <li>这条任务的领域 没匹配到任何专家档案</li>
            )}
            {!topCand && <li>当前 workspace 还没配置 active AI 专家</li>}
          </ul>

          {preview.candidates.length > 0 && (
            <>
              <p className="mt-3 text-xs text-zinc-400">
                给你 全部 候选 + 各维得分,你自己拍:
              </p>
              <ol className="mt-2 space-y-2">
                {preview.candidates.slice(0, 5).map((c) => (
                  <li
                    key={c.agent_id}
                    className="rounded-lg border border-ink-700 bg-ink-950 px-3 py-2"
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm text-zinc-100">
                        <b>{c.candidate_user_name || "?"}</b>
                        <span className="ml-2 text-[11px] text-zinc-500">
                          ({c.agent_name})
                        </span>
                      </span>
                      <span className="font-mono text-xs text-rose-200">
                        {c.composite.toFixed(2)}
                      </span>
                    </div>
                    <div className="mt-2 space-y-1 text-xs">
                      <Dim name="keyword" score={c.breakdown.keyword} />
                      <Dim name="history" score={c.breakdown.history} />
                      <Dim name="load" score={c.breakdown.load} />
                      <Dim name="capability" score={c.breakdown.capability} />
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}

          <p className="mt-3 text-[11px] text-zinc-500">
            💡 手动指派:进 <Link href="/me" className="text-accent-400 hover:text-accent-300">我的工作台</Link>
            ,找到本任务,点 「派发」 选 assignee.
          </p>
        </div>
      </div>
    </section>
  );
}


export default function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: taskId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  // v25.15: 智能返回 — 拿 ?from=meeting&mid=xxx 决定返回到哪
  const fromMeeting = useMemo(() => {
    const f = searchParams?.get("from");
    const mid = searchParams?.get("mid");
    return f === "meeting" && mid ? mid : null;
  }, [searchParams]);
  const backHref = fromMeeting ? `/meeting/${fromMeeting}` : "/me";
  const backLabel = fromMeeting ? "← 返回会议" : "← 我的";

  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.getTaskDetail(taskId);
      setDetail(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  // v24.1 #3: 4-维路由(only meaningful when status=open)
  const [preview, setPreview] = useState<RoutePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [autoRouting, setAutoRouting] = useState(false);

  const loadPreview = useCallback(async () => {
    if (previewLoading) return;
    setPreviewLoading(true);
    try {
      const p = await api.previewRoute(taskId);
      setPreview(p);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "评分失败");
    } finally {
      setPreviewLoading(false);
    }
  }, [previewLoading, taskId]);

  const onAutoRoute = useCallback(async () => {
    if (autoRouting) return;
    setAutoRouting(true);
    try {
      const r = await api.autoRouteTask(taskId);
      if (r.matched && r.winner) {
        toast.success(
          `🤖 已派发给 ${r.winner.candidate_user_name || "(未知)"} (${r.winner.agent_name})`,
          {
            detail: `composite=${r.winner.composite} (kw ${r.winner.breakdown.keyword} · history ${r.winner.breakdown.history} · load ${r.winner.breakdown.load} · capability ${r.winner.breakdown.capability})`,
          },
        );
        await load();  // 刷新 task 状态
      } else {
        toast.error(
          `未达阈值 ${r.threshold} — ${r.candidates.length} 候选,最高分 ${r.candidates[0]?.composite ?? 0}。请手动派发。`,
        );
        // 仍展开 preview 让 leader 能看
        setPreview({
          candidates: r.candidates,
          threshold: r.threshold,
          matched: false,
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "auto-route 失败");
    } finally {
      setAutoRouting(false);
    }
  }, [autoRouting, taskId, load]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <main
        className="mx-auto max-w-3xl px-4 py-12 pt-20"
        data-testid="task-detail-loading"
      >
        <div className="text-sm text-zinc-500">加载中…</div>
      </main>
    );
  }

  if (error || !detail) {
    return (
      <main
        className="mx-auto max-w-3xl px-4 py-12 pt-20"
        data-testid="task-detail-error"
      >
        <Link
          href={backHref}
          className="text-xs text-zinc-500 hover:text-zinc-200"
        >
          {backLabel}
        </Link>
        <div className="mt-4 text-sm text-rose-400">
          {error || "任务不存在"}
        </div>
      </main>
    );
  }

  const t = detail;
  const cls = t.data_classification || "general";
  const sourceLabel = SOURCE_LABEL[t.source_type] || t.source_type;
  const overdue =
    t.due_at &&
    new Date(t.due_at).getTime() < Date.now() &&
    t.status !== "done" &&
    t.status !== "archived" &&
    t.status !== "cancelled";

  return (
    <main
      className="mx-auto max-w-3xl px-4 py-12 pt-20"
      data-testid="task-detail-page"
      data-task-id={t.id}
    >
      <header>
        <div className="mb-2 flex items-center gap-2">
          <Link
            href={backHref}
            className="text-xs text-zinc-500 hover:text-zinc-200"
            data-testid="task-detail-back"
          >
            {backLabel}
          </Link>
          <span className="text-zinc-700">·</span>
          <span className="text-xs text-zinc-500">任务详情</span>
        </div>
        <h1
          className="text-xl font-semibold text-white"
          data-testid="task-detail-title"
        >
          {t.title || t.content.slice(0, 80)}
        </h1>
        {t.title && (
          <div className="mt-2 whitespace-pre-wrap text-sm text-zinc-300">
            {t.content}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            data-testid="task-detail-status"
            data-status={t.status}
            className={`rounded-full px-2 py-0.5 text-xs ${STATUS_COLOR[t.status] || STATUS_COLOR.open}`}
          >
            {STATUS_LABEL[t.status] || t.status}
          </span>
          <span
            data-testid="task-detail-classification"
            className={`rounded-full px-2 py-0.5 text-xs ${CLASSIFICATION_BADGE_CLASSES[cls] || ""}`}
          >
            {CLASSIFICATION_LABELS[cls] || cls}
          </span>
          {t.due_at && (
            <span
              data-testid="task-detail-due"
              className={`text-xs ${overdue ? "font-medium text-rose-400" : "text-zinc-500"}`}
            >
              截止 {fmtDate(t.due_at)}
              {overdue && " (已逾期)"}
            </span>
          )}
        </div>
      </header>

      {/* 元信息 */}
      <section className="mt-6 space-y-1 rounded-lg border border-ink-700 bg-ink-900 p-4 text-xs text-zinc-400">
        <div>
          <span className="text-zinc-500">来源:</span> {sourceLabel}
          {t.meeting_id && t.meeting_title && (
            <>
              {" · "}
              <Link
                href={`/meeting/${t.meeting_id}`}
                className="text-accent-300 hover:text-accent-200"
                data-testid="task-detail-meeting-link"
              >
                《{t.meeting_title}》
              </Link>
            </>
          )}
        </div>
        <div>
          <span className="text-zinc-500">主责:</span>{" "}
          {t.assignee_name || "(未指派)"}
          {t.dispatched_by_name && (
            <>
              {" · "}
              <span className="text-zinc-500">派发人:</span>{" "}
              {t.dispatched_by_name}
            </>
          )}
          {t.created_by_name &&
            t.created_by_user_id !== t.dispatched_by_user_id && (
              <>
                {" · "}
                <span className="text-zinc-500">发起人:</span>{" "}
                {t.created_by_name}
              </>
            )}
        </div>
        {t.co_assignees.length > 0 && (
          <div data-testid="task-detail-co-assignees">
            <span className="text-zinc-500">协办:</span>{" "}
            {t.co_assignees.map((cuid) => {
              const submitted = t.co_submitted_user_ids.includes(cuid);
              const name = t.co_assignee_names[cuid] || "(未知)";
              return (
                <span
                  key={cuid}
                  className={`mr-2 inline-flex items-center gap-1 ${submitted ? "text-emerald-300" : "text-zinc-300"}`}
                  data-testid="task-detail-co-assignee"
                  data-submitted={submitted ? "1" : "0"}
                >
                  {name}
                  <span
                    className={`text-[10px] ${submitted ? "text-emerald-400" : "text-zinc-500"}`}
                  >
                    {submitted ? "[已交]" : "[未交]"}
                  </span>
                </span>
              );
            })}
          </div>
        )}
      </section>

      {/* v25.15 + v25.19: 实录依据 / 会议来源 — 缩略 + 行号锚点 跳转 */}
      {(() => {
        const sref = (t.source_ref as Record<string, unknown> | null | undefined) || {};
        const evidence = typeof sref.evidence_quote === "string" ? sref.evidence_quote : null;
        const meetingId = typeof sref.meeting_id === "string" ? sref.meeting_id : null;
        // v25.19: anchor_line_ids 也是 dual-write 到 source_ref 的
        const rawAnchors = sref.evidence_anchor_line_ids;
        const anchorIds: number[] = Array.isArray(rawAnchors)
          ? rawAnchors.filter((x): x is number => typeof x === "number" && x > 0)
          : [];
        const hasAnchors = anchorIds.length > 0;
        if (!evidence && !meetingId && !hasAnchors) return null;
        // 跳转链接:?focus=<逗号分隔的 ids>,实录页会自动滚动 + 高亮
        const focusHref =
          meetingId && hasAnchors
            ? `/meeting/${meetingId}?focus=${anchorIds.join(",")}`
            : meetingId
            ? `/meeting/${meetingId}`
            : null;
        return (
          <section
            className="mt-6 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4"
            data-testid="task-detail-evidence"
          >
            <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-200">
              <span>📜</span> 这条任务从哪来
            </h2>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              {hasAnchors
                ? `AI 抽这条待办时,引用了实录中 ${anchorIds.length} 句真人对话作为依据.点下面"在实录中查看"可直接跳转 + 高亮上下文.`
                : "AI 抽取本待办时记下的会议实录原文.闭环透明 — 你可以追溯回会议讨论."}
            </p>
            {evidence && (
              <blockquote className="mt-2 rounded-md border-l-2 border-amber-400/60 bg-ink-950/50 px-3 py-2 text-sm italic text-zinc-200">
                「{evidence.length > 200 ? evidence.slice(0, 200) + "…" : evidence}」
              </blockquote>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
              {focusHref && hasAnchors && (
                <Link
                  href={focusHref}
                  className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2.5 py-1 font-medium text-amber-300 hover:bg-amber-500/25"
                  title={`在《${t.meeting_title || "会议"}》实录中定位这 ${anchorIds.length} 句对话,高亮 + 自动滚动`}
                >
                  🔗 在实录中查看上下文（{anchorIds.length} 句）→
                </Link>
              )}
              {meetingId && t.meeting_title && (
                <span>
                  来自会议:
                  <Link
                    href={`/meeting/${meetingId}`}
                    className="ml-1 text-accent-400 hover:text-accent-300"
                  >
                    《{t.meeting_title}》→
                  </Link>
                </span>
              )}
            </div>
          </section>
        );
      })()}

      {/* v25.17: AI 派发助手 — 自适应置信度,自动加载,直白文案 */}
      {t.status === "open" && (
        <SmartDispatchSection
          taskId={t.id}
          preview={preview}
          previewLoading={previewLoading}
          loadPreview={loadPreview}
          autoRouting={autoRouting}
          onAutoRoute={onAutoRoute}
        />
      )}
      {/* 兼容老 UI 占位(已移除) */}
      {false && (
        <section
          className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4"
          data-testid="task-detail-auto-route"
        ></section>
      )}

      {/* v24.2 #1: 办结沉淀徽章(若有) */}
      {(() => {
        const curated = (t.source_ref as Record<string, unknown> | null | undefined)?.curated;
        if (!curated) return null;
        const sr = t.source_ref as {
          curated_tags?: string[];
          curated_kb_id?: string | null;
          curated_at?: string;
        };
        return (
          <section
            className="mt-6 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4"
            data-testid="task-detail-curated-badge"
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl" aria-hidden>📚</span>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-emerald-200">
                  已沉淀至知识库
                </h2>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  办结后系统已自动 LLM 摘要 + 入 KB(Agent 下次回答相关问题时会引用).
                  {sr.curated_at && ` · 沉淀时间 ${fmtDateTime(sr.curated_at)}`}
                </p>
                {sr.curated_tags && sr.curated_tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {sr.curated_tags.map((tag, i) => (
                      <span
                        key={i}
                        data-testid="task-detail-curated-tag"
                        className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-200"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
                {sr.curated_kb_id && (
                  <Link
                    href={`/admin/knowledge/${sr.curated_kb_id}`}
                    className="mt-2 inline-block text-[11px] text-accent-300 hover:text-accent-200"
                  >
                    → 去知识库查看
                  </Link>
                )}
              </div>
            </div>
          </section>
        );
      })()}

      {/* v24.1 #5: 阶段汇报模板内容(若有) */}
      {(() => {
        const sp = (t.source_ref as Record<string, unknown> | null | undefined)?.submission_payload as
          | {
              completed?: string;
              problems?: string;
              next_steps?: string;
              evidence_urls?: string[];
              note?: string;
              submitted_at?: string;
              submitted_by_name?: string;
            }
          | undefined;
        if (!sp) return null;
        return (
          <section
            className="mt-6 rounded-lg border border-violet-500/30 bg-violet-500/5 p-4"
            data-testid="task-detail-submission-payload"
          >
            <header className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-violet-200">
                📋 阶段汇报
              </h2>
              <span className="text-[10px] text-zinc-500">
                {sp.submitted_by_name || ""}
                {sp.submitted_at && ` · ${fmtDateTime(sp.submitted_at)}`}
              </span>
            </header>
            <div className="space-y-3 text-xs">
              {sp.completed && (
                <div data-testid="submission-completed">
                  <div className="font-medium text-emerald-300">✅ 已完成</div>
                  <div className="mt-0.5 whitespace-pre-wrap text-zinc-300">
                    {sp.completed}
                  </div>
                </div>
              )}
              {sp.problems && (
                <div data-testid="submission-problems">
                  <div className="font-medium text-amber-300">⚠️ 问题 / 风险</div>
                  <div className="mt-0.5 whitespace-pre-wrap text-zinc-300">
                    {sp.problems}
                  </div>
                </div>
              )}
              {sp.next_steps && (
                <div data-testid="submission-next-steps">
                  <div className="font-medium text-sky-300">➡️ 下一步</div>
                  <div className="mt-0.5 whitespace-pre-wrap text-zinc-300">
                    {sp.next_steps}
                  </div>
                </div>
              )}
              {sp.evidence_urls && sp.evidence_urls.length > 0 && (
                <div data-testid="submission-evidence">
                  <div className="font-medium text-zinc-400">
                    📎 佐证材料 ({sp.evidence_urls.length})
                  </div>
                  <ul className="mt-0.5 space-y-1">
                    {sp.evidence_urls.map((url, i) => (
                      <li key={i}>
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-all text-accent-300 hover:text-accent-200"
                        >
                          {url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {sp.note && (
                <div data-testid="submission-note">
                  <div className="font-medium text-zinc-400">💬 备注</div>
                  <div className="mt-0.5 whitespace-pre-wrap text-zinc-300">
                    {sp.note}
                  </div>
                </div>
              )}
            </div>
          </section>
        );
      })()}

      {/* 时间线 */}
      <section className="mt-6" data-testid="task-detail-timeline">
        <h2 className="mb-3 text-sm font-semibold text-zinc-300">📍 时间线</h2>
        <ol className="relative space-y-3 border-l border-ink-700 pl-4">
          {t.timeline.map((e, i) => (
            <li
              key={`${e.kind}-${i}`}
              className="relative"
              data-testid="task-detail-timeline-item"
              data-kind={e.kind}
            >
              <span
                className={`absolute -left-[21px] top-1 grid h-3 w-3 place-items-center rounded-full ${TIMELINE_COLOR[e.kind] || "bg-zinc-500"}`}
              />
              <div className="text-xs text-zinc-200">
                {TIMELINE_LABEL[e.kind] || e.kind}
                {e.actor_name && (
                  <span className="text-zinc-500"> · {e.actor_name}</span>
                )}
              </div>
              <div className="mt-0.5 text-[10px] text-zinc-600">
                {fmtDateTime(e.at)}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* 协办交付 */}
      {t.co_assignees.length > 0 && (
        <section className="mt-6" data-testid="task-detail-co-progress">
          <h2 className="mb-3 text-sm font-semibold text-zinc-300">
            🤝 协办交付
          </h2>
          <div className="space-y-2">
            {t.co_progress.length === 0 ? (
              <div className="text-xs text-zinc-500">协办尚未提交</div>
            ) : (
              t.co_progress.map((cp) => (
                <div
                  key={cp.co_assignee_user_id}
                  className="rounded-lg border border-ink-700 bg-ink-900 p-3"
                  data-testid="task-detail-co-progress-item"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-200">
                      {cp.co_assignee_name || "未知"}
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      {fmtDateTime(cp.submitted_at)}
                    </span>
                  </div>
                  {cp.content && (
                    <div className="mt-2 whitespace-pre-wrap text-xs text-zinc-300">
                      {cp.content}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* 评分 */}
      {t.ratings.length > 0 && (
        <section className="mt-6" data-testid="task-detail-ratings">
          <h2 className="mb-3 text-sm font-semibold text-zinc-300">⭐ 评分</h2>
          <div className="space-y-2">
            {t.ratings.map((r) => (
              <div
                key={r.id}
                className="rounded-lg border border-ink-700 bg-ink-900 p-3"
                data-testid="task-detail-rating-item"
                data-dimension={r.dimension}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-300">
                    {r.rater_name || "?"} → {r.ratee_name || "?"}{" "}
                    <span className="text-zinc-500">
                      ({r.dimension === "quality" ? "质量" : "协作"})
                    </span>
                  </span>
                  <StarBar score={r.score} />
                </div>
                {r.comment && (
                  <div className="mt-2 text-xs text-zinc-400">
                    “{r.comment}”
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 协作评论(MeetingActionItemComment) */}
      {t.comments.length > 0 && (
        <section className="mt-6" data-testid="task-detail-comments">
          <h2 className="mb-3 text-sm font-semibold text-zinc-300">
            💬 协作评论
          </h2>
          <div className="space-y-2">
            {t.comments.map((c) => (
              <div
                key={c.id}
                className="rounded-lg border border-ink-700 bg-ink-900 p-3"
                data-testid="task-detail-comment-item"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-200">
                    {c.author_name || "(已删除用户)"}
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    {fmtDateTime(c.created_at)}
                  </span>
                </div>
                <div className="mt-1 whitespace-pre-wrap text-xs text-zinc-300">
                  {c.content}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
