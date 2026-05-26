"use client";

/**
 * v27.0-mobile P10 · /m/notifications · 通知页.
 *
 * 入口: PageHeader 右上 🔔 icon (之前 404).
 *
 * 内容:
 *   - 按时间倒序的通知列表 (拉 /api/me/notifications?limit=50)
 *   - 每条: severity 色块 + kind 中文标签 + payload 摘要 + 时间
 *   - 未读 vs 已读 视觉区分 (未读底色稍浅 + 左侧紫点)
 *   - 顶部 "全部已读" 按钮 → POST /api/me/notifications/read-all
 *
 * notification.kind 桌面端有十几种 (task_assigned / task_due_soon / @mention
 * / action_comment / 等), mvp 用通用 fallback 中文化, 未识别 kind 直接
 * 显原始 kind 不报错.
 *
 * v1.4.0 Saga D · 浅色化 (跟 /m today 一致).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Toast from "@/components/mobile/Toast";
import { MR_COLORS } from "@/components/mobile/meeting-room/styles";

type Notification = {
  id: string;
  kind: string;
  severity: "normal" | "yellow" | "red" | "purple" | string;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

type ListOut = {
  items: Notification[];
  unread_count: number;
  max_unread_severity: string;
};

// kind → 中文 + emoji. 未列出的 kind 显原始 string.
const KIND_LABEL: Record<string, { emoji: string; label: string }> = {
  task_assigned: { emoji: "📌", label: "任务派给你了" },
  task_dispatched: { emoji: "📌", label: "任务已派发给你" },
  task_due_soon: { emoji: "⏰", label: "任务快截止" },
  task_overdue: { emoji: "🚨", label: "任务超期" },
  task_submitted: { emoji: "📝", label: "任务已提交" },
  task_approved: { emoji: "✓", label: "任务被通过" },
  task_rejected: { emoji: "✗", label: "任务被驳回" },
  action_comment: { emoji: "💬", label: "任务有新评论" },
  meeting_invited: { emoji: "📅", label: "邀请你参加会议" },
  meeting_started: { emoji: "▶", label: "会议已开始" },
  meeting_finished: { emoji: "⏹", label: "会议已结束" },
  memory_draft_for_review: { emoji: "🔍", label: "AI 草稿等你审" },
  mention: { emoji: "@", label: "有人 @ 你" },
};

const SEVERITY_DOT: Record<string, string> = {
  normal: MR_COLORS.textTertiary,
  yellow: MR_COLORS.systemAmber,
  red: MR_COLORS.systemRed,
  purple: MR_COLORS.systemPurple,
};

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days} 天前`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function extractTitle(payload: Record<string, unknown> | null): string {
  if (!payload) return "";
  // payload 不同 kind 不同 schema, 尝试通用字段
  const candidates = [
    "task_title",
    "meeting_title",
    "title",
    "content",
    "summary",
  ];
  for (const k of candidates) {
    const v = payload[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "";
}

export default function MobileNotificationsPage() {
  const [data, setData] = useState<ListOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);
  const [toast, setToast] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/me/notifications?limit=50", {
        credentials: "include",
        headers: { accept: "application/json" },
      });
      if (!r.ok) throw new Error(`${r.status}`);
      const d = (await r.json()) as ListOut;
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleMarkAllRead = useCallback(async () => {
    if (marking || !data || data.unread_count === 0) return;
    setMarking(true);
    try {
      const r = await fetch("/api/me/notifications/read-all", {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok && r.status !== 204) throw new Error(`${r.status}`);
      await load();
      setToast({ kind: "success", text: "已全部标为已读" });
    } catch (e) {
      setToast({
        kind: "error",
        text: `操作失败: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setMarking(false);
    }
  }, [marking, data, load]);

  const handleMarkOneRead = useCallback(
    async (notifId: string) => {
      try {
        await fetch(`/api/me/notifications/${notifId}/read`, {
          method: "POST",
          credentials: "include",
        });
        await load();
      } catch {
        // 静默 — 不打扰用户
      }
    },
    [load],
  );

  return (
    <div style={{ background: MR_COLORS.bgGroupedPrimary, minHeight: "100%" }}>
      {/* TopBar */}
      <div
        className="sticky top-0 z-30 flex items-center gap-3 px-4 pb-3 backdrop-blur"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)",
          background: "rgba(242,242,247,0.92)",
          borderBottom: `0.5px solid ${MR_COLORS.hairline}`,
        }}
      >
        <Link
          href="/m"
          className="-ml-2 flex h-10 w-10 items-center justify-center"
          style={{ color: MR_COLORS.systemBlue }}
          aria-label="返回"
        >
          <span className="text-2xl leading-none">←</span>
        </Link>
        <h1
          className="flex-1 truncate text-[18px] font-semibold"
          style={{ color: MR_COLORS.textPrimary }}
        >
          通知
          {data && data.unread_count > 0 ? (
            <span
              className="ml-2 text-[14px] font-normal"
              style={{ color: MR_COLORS.textTertiary }}
            >
              · {data.unread_count} 未读
            </span>
          ) : null}
        </h1>
        {data && data.unread_count > 0 ? (
          <button
            type="button"
            onClick={handleMarkAllRead}
            disabled={marking}
            className="text-[14px] font-medium disabled:opacity-50"
            style={{ color: MR_COLORS.systemBlue }}
          >
            {marking ? "..." : "全部已读"}
          </button>
        ) : null}
      </div>

      <main className="p-4 pb-6">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-xl"
                style={{ background: "rgba(60,60,67,0.06)" }}
              />
            ))}
          </div>
        ) : error ? (
          <div
            className="rounded-xl px-4 py-6 text-center text-[14px]"
            style={{
              border: `0.5px solid ${MR_COLORS.urgentBorder}`,
              background: MR_COLORS.urgentBg,
              color: MR_COLORS.systemRed,
            }}
          >
            未能加载通知: {error}
          </div>
        ) : !data || data.items.length === 0 ? (
          <div
            className="mt-4 rounded-2xl px-6 py-12 text-center"
            style={{ border: `1px dashed ${MR_COLORS.hairlineStrong}` }}
          >
            <div className="text-3xl">🔔</div>
            <p
              className="mt-4 text-[16px]"
              style={{ color: MR_COLORS.textPrimary }}
            >
              没有通知
            </p>
            <p
              className="mt-2 text-[14px]"
              style={{ color: MR_COLORS.textTertiary }}
            >
              任务变化 / 会议邀请 / @你 都会出现在这
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {data.items.map((n) => {
              const unread = !n.read_at;
              const dotColor = SEVERITY_DOT[n.severity] || SEVERITY_DOT.normal;
              const kindMeta = KIND_LABEL[n.kind] || {
                emoji: "•",
                label: n.kind,
              };
              const title = extractTitle(n.payload);
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => unread && handleMarkOneRead(n.id)}
                    className="flex w-full items-start gap-3 rounded-xl p-4 text-left transition active:scale-[0.99]"
                    style={{
                      background: MR_COLORS.bgWhite,
                      border: `0.5px solid ${MR_COLORS.hairline}`,
                      opacity: unread ? 1 : 0.62,
                    }}
                    data-testid="mobile-notification-row"
                  >
                    <span
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[16px]"
                      style={{
                        background: unread
                          ? "rgba(94,92,230,0.10)"
                          : MR_COLORS.bgInputFill,
                      }}
                    >
                      {kindMeta.emoji}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span
                          className="truncate text-[15px] font-medium"
                          style={{
                            color: unread
                              ? MR_COLORS.textPrimary
                              : MR_COLORS.textSecondary,
                          }}
                        >
                          {kindMeta.label}
                        </span>
                        {unread ? (
                          <span
                            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ background: dotColor }}
                            aria-label="未读"
                          />
                        ) : null}
                      </div>
                      {title ? (
                        <p
                          className="mt-1 truncate text-[14px]"
                          style={{
                            color: unread
                              ? MR_COLORS.textSecondary
                              : MR_COLORS.textTertiary,
                          }}
                        >
                          {title}
                        </p>
                      ) : null}
                      <p
                        className="mt-1 text-[13px]"
                        style={{ color: MR_COLORS.textTertiary }}
                      >
                        {timeAgo(n.created_at)}
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      {toast ? (
        <Toast kind={toast.kind} text={toast.text} onClose={() => setToast(null)} />
      ) : null}
    </div>
  );
}
