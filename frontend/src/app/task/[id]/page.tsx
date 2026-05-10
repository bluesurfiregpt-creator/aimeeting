"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
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

export default function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: taskId } = use(params);
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
          href="/me"
          className="text-xs text-zinc-500 hover:text-zinc-200"
        >
          ← 返回我的
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
            href="/me"
            className="text-xs text-zinc-500 hover:text-zinc-200"
          >
            ← 我的
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

      {/* v24.1 #3: 自动派发(只在 open 状态显示) */}
      {t.status === "open" && (
        <section
          className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4"
          data-testid="task-detail-auto-route"
        >
          <div className="flex items-start gap-3">
            <span className="text-2xl" aria-hidden>🤖</span>
            <div className="flex-1">
              <h2 className="text-sm font-semibold text-amber-200">
                AI 自动派发(4-维评分)
              </h2>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                关键词 (40%) + 历史关联 (30%) + 负载均衡 (20%) + 能力标签 (10%) →
                composite 得分.超阈值就直接派发,否则需手动选.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={loadPreview}
                  disabled={previewLoading}
                  data-testid="task-route-preview-btn"
                  className="rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
                >
                  {previewLoading ? "评分中…" : "🔍 评分预览"}
                </button>
                <button
                  type="button"
                  onClick={onAutoRoute}
                  disabled={autoRouting}
                  data-testid="task-auto-route-btn"
                  className="rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-medium text-amber-950 hover:bg-amber-400 disabled:opacity-50"
                >
                  {autoRouting ? "派发中…" : "🤖 自动派发(leader/admin)"}
                </button>
              </div>

              {preview && (
                <div className="mt-3" data-testid="task-route-preview-panel">
                  <div className="text-[11px] text-zinc-500">
                    阈值 {preview.threshold} ·
                    {preview.matched ? (
                      <span className="text-emerald-300"> ✅ 最高分过阈,可自动派发</span>
                    ) : (
                      <span className="text-rose-400"> ❌ 最高分未过阈,建议手动</span>
                    )}
                  </div>
                  <ol className="mt-2 space-y-1.5">
                    {preview.candidates.slice(0, 5).map((c, i) => (
                      <li
                        key={c.agent_id}
                        className={`rounded-md px-2 py-1.5 ${
                          i === 0
                            ? "border border-amber-500/40 bg-amber-500/10"
                            : "border border-ink-700 bg-ink-950"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-zinc-200">
                            {i === 0 && "🥇 "}
                            {c.agent_name}
                            <span className="text-zinc-500"> → {c.candidate_user_name || "?"}</span>
                          </span>
                          <span className="font-mono text-xs text-amber-200">
                            {c.composite.toFixed(3)}
                          </span>
                        </div>
                        <div className="mt-1 grid grid-cols-4 gap-1 text-[10px] text-zinc-500">
                          <span>kw: {c.breakdown.keyword.toFixed(2)}</span>
                          <span>hist: {c.breakdown.history.toFixed(2)}</span>
                          <span>load: {c.breakdown.load.toFixed(2)}</span>
                          <span>cap: {c.breakdown.capability.toFixed(2)}</span>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </div>
        </section>
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
