"use client";

import { useState, useMemo, useEffect } from "react";
import { W_TOKENS } from "../tokens";
import { WIcon, WPill, WAvatar, WAIBadge, WButton, WCard, WModal, WSparkle } from "../atoms";
import { W_AGENTS, W_HUMANS } from "../data/agents";
import { W_TASKS, type WTask } from "../data/tasks";
import { PaneHeader } from "./PaneHeader";
import {
  api,
  type V2TasksPriorityBanner,
  type V2TaskItem,
  type V2TaskGroup,
} from "@/lib/api";

/**
 * 我的任务 pane — R5.C.
 *
 * 来自 round-6 设计稿 TasksPane:
 *  - Mira 优先级 banner (今日待办)
 *  - segmented (全部 / 我的 / AI 派的 / 已完成)
 *  - 任务列表 (单卡风格)
 *  - 点击 task → mock modal 显示详情
 *
 * Sprint 3 Web W2: 接 backend.
 *  - /api/v2/tasks/priority-banner (Mira 顶 banner)
 *  - /api/v2/tasks/grouped?status=pending|tracking|done (3 个 status 并行拉)
 *  - 拉失败 / empty workspace → fallback mock W_TASKS + "演示数据" pill
 */

// backend V2TaskItem → mock WTask shape (TaskRow 渲染兼容)
function adaptV2Task(t: V2TaskItem, fallbackState: WTask["state"]): WTask {
  // backend status (pending/tracking/done) → mock state (todo/tracking/review/done)
  const stateMap: Record<string, WTask["state"]> = {
    pending: "todo",
    tracking: "tracking",
    done: "done",
  };
  const prioMap: Record<string, WTask["priority"]> = {
    urgent: "high",
    today: "mid",
    week: "low",
    none: undefined as unknown as WTask["priority"],
  };
  const dueToneMap: Record<string, WTask["dueTone"]> = {
    urgent: "danger",
    today: "warn",
    week: "neutral",
    none: "neutral",
  };
  return {
    id: t.id,
    state: stateMap[t.status] || fallbackState,
    priority: prioMap[t.urgency],
    title: t.title,
    source: t.source_meeting || "独立任务",
    sourceAI: t.ai_source?.name?.toUpperCase(),
    due: t.due_display,
    dueTone: dueToneMap[t.urgency],
  };
}

export function TasksPane() {
  const [tab, setTab] = useState<"all" | "mine" | "ai" | "done">("all");
  const [openTask, setOpenTask] = useState<WTask | null>(null);

  // Sprint 3 Web W2: 真接 v2/tasks/grouped + priority-banner.
  const [tasks, setTasks] = useState<WTask[]>(W_TASKS);
  const [usingFallback, setUsingFallback] = useState(true);
  const [banner, setBanner] = useState<V2TasksPriorityBanner | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 4 个 endpoint 并行 (Promise.allSettled — 一个失败不阻塞其他)
      const [bannerResult, pending, tracking, done] = await Promise.allSettled([
        api.getTasksPriorityBanner(),
        api.getTasksGrouped("pending"),
        api.getTasksGrouped("tracking"),
        api.getTasksGrouped("done"),
      ]);
      if (cancelled) return;

      if (bannerResult.status === "fulfilled") {
        setBanner(bannerResult.value);
      }

      const allTasks: WTask[] = [];
      const collectGroups = (
        res: PromiseSettledResult<{ groups: V2TaskGroup[] }>,
        fallbackState: WTask["state"],
      ) => {
        if (res.status !== "fulfilled") return;
        for (const grp of res.value.groups || []) {
          for (const t of grp.tasks || []) {
            allTasks.push(adaptV2Task(t, fallbackState));
          }
        }
      };
      collectGroups(pending, "todo");
      collectGroups(tracking, "tracking");
      collectGroups(done, "done");

      if (allTasks.length > 0) {
        setTasks(allTasks);
        setUsingFallback(false);
      } else {
        console.warn(
          "[TasksPane] /api/v2/tasks/grouped 全空 (workspace 无任务), 渲染 mock",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (tab === "all") return true;
      if (tab === "done") return t.state === "done";
      // mine = 没指派 assignee 或 assignee = 当前用户
      if (tab === "mine") return !t.assignee || t.assignee === "ZK";
      // ai = AI 派给我的 (sourceAI 存在)
      if (tab === "ai") return !!t.sourceAI && t.state !== "done";
      return true;
    });
  }, [tab, tasks]);

  const todoCount = tasks.filter((t) => t.state === "todo").length;
  const aiCount = tasks.filter((t) => !!t.sourceAI && t.state !== "done").length;
  const doneCount = tasks.filter((t) => t.state === "done").length;

  const todayUrgent = tasks.find((t) => t.priority === "high");

  // Sprint 3 Web W2: 反幻觉 pill (NORTH_STAR § 7.5) — 走 fallback mock 时清楚标 demo
  const demoBadge = usingFallback ? (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        color: "#C4B5FD",
        background: "rgba(124,92,250,0.10)",
        padding: "2px 8px",
        borderRadius: 5,
        letterSpacing: 0.3,
        boxShadow: "inset 0 0 0 0.5px rgba(124,92,250,0.30)",
      }}
    >
      演示数据
    </span>
  ) : null;

  // backend banner 真接时优先用 summary_text, 否则走 mock urgent task
  const bannerHeadline = banner && banner.urgent_task_count > 0
    ? banner.summary_text
    : todayUrgent
    ? `1 项今日截止 · 需 ${todayUrgent.due.replace("今天 ", "")} 「${todayUrgent.title}」`
    : null;

  return (
    <>
      <PaneHeader
        title="我的任务"
        sub="所有 AI 提炼出的 + 主持人指派给你的 待办,按 状态 归四类。"
        extra={demoBadge}
      />

      {/* Mira priority banner */}
      {bannerHeadline && (
        <div
          style={{
            position: "relative",
            overflow: "hidden",
            borderRadius: 14,
            background:
              "linear-gradient(135deg, #2a1a40 0%, #401a30 50%, #401a25 100%)",
            boxShadow:
              "0 6px 22px rgba(180,70,110,0.20), inset 0 0 0 0.5px rgba(255,100,130,0.20)",
            padding: "14px 18px",
            display: "flex",
            alignItems: "center",
            gap: 13,
            marginBottom: 16,
          }}
        >
          <WSparkle x={48} y={14} size={9} opacity={0.7} />
          <WSparkle x={92} y={28} size={5} opacity={0.5} />
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "rgba(255,255,255,0.10)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.18)",
              flexShrink: 0,
            }}
          >
            <WIcon name="bolt" size={17} color="#fff" />
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                color: "rgba(255,255,255,0.65)",
                letterSpacing: 0.6,
                textTransform: "uppercase",
              }}
            >
              Mira · 今日优先级
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "#fff",
                marginTop: 3,
                lineHeight: 1.4,
              }}
            >
              {bannerHeadline}
            </div>
          </div>
          <WButton variant="secondary" size="sm" iconRight="arr-r">
            查看上下文
          </WButton>
        </div>
      )}

      {/* segmented */}
      <div
        style={{
          display: "inline-flex",
          gap: 4,
          padding: 4,
          background: W_TOKENS.surface,
          borderRadius: 10,
          boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
          marginBottom: 16,
        }}
      >
        {[
          { id: "all" as const, label: "全部", count: W_TASKS.length },
          { id: "mine" as const, label: "我的", count: todoCount },
          { id: "ai" as const, label: "AI 派的", count: aiCount },
          { id: "done" as const, label: "已完成", count: doneCount },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              height: 30,
              padding: "0 14px",
              borderRadius: 7,
              border: "none",
              background: tab === t.id ? "rgba(124,92,250,0.16)" : "transparent",
              boxShadow:
                tab === t.id ? "inset 0 0 0 0.5px rgba(124,92,250,0.30)" : "none",
              color: tab === t.id ? "#C4B5FD" : W_TOKENS.textSecondary,
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {t.label}
            <span
              style={{
                fontSize: 11,
                opacity: 0.7,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      <WCard padding={0}>
        {filtered.map((t, i) => (
          <TaskRow
            key={t.id}
            t={t}
            last={i === filtered.length - 1}
            onOpen={() => setOpenTask(t)}
          />
        ))}
        {filtered.length === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "40px 20px",
              color: W_TOKENS.textMuted,
              fontSize: 14,
            }}
          >
            当前类别下没有任务
          </div>
        )}
      </WCard>

      {/* mock task detail modal */}
      <WModal open={!!openTask} onClose={() => setOpenTask(null)}>
        {openTask && <TaskDetail t={openTask} onClose={() => setOpenTask(null)} />}
      </WModal>
    </>
  );
}

function TaskRow({
  t,
  last,
  onOpen,
}: {
  t: WTask;
  last: boolean;
  onOpen: () => void;
}) {
  const isDone = t.state === "done";
  const ai = t.sourceAI ? W_AGENTS.find((x) => x.id === t.sourceAI) : null;
  const prioMap: Record<string, { tone: "danger" | "warn" | "neutral"; label: string }> = {
    high: { tone: "danger", label: "紧急" },
    mid: { tone: "warn", label: "今日" },
    low: { tone: "neutral", label: "本周" },
  };
  const prio = !isDone && t.priority ? prioMap[t.priority] : null;
  const stateMap: Record<
    string,
    { tone: "accent" | "cyan" | "warn" | "success"; label: string }
  > = {
    todo: { tone: "accent", label: "待办" },
    tracking: { tone: "cyan", label: "进行中" },
    review: { tone: "warn", label: "审核中" },
    done: { tone: "success", label: "已完成" },
  };
  const st = stateMap[t.state];

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "13px 16px",
        borderBottom: last ? "none" : `0.5px solid ${W_TOKENS.border}`,
        background: "transparent",
        border: "none",
        textAlign: "left",
        cursor: "pointer",
        fontFamily: "inherit",
        width: "100%",
        transition: "background 120ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = W_TOKENS.surfaceHover;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          marginTop: 2,
          flexShrink: 0,
          ...(isDone
            ? {
                background: W_TOKENS.success,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }
            : {
                background: "transparent",
                boxShadow: `inset 0 0 0 1.5px ${W_TOKENS.borderHover}`,
              }),
        }}
      >
        {isDone && <WIcon name="check" size={11} color="#fff" stroke={3} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: isDone ? W_TOKENS.textMuted : W_TOKENS.textPrimary,
            textDecoration: isDone ? "line-through" : "none",
            lineHeight: 1.4,
          }}
        >
          {t.title}
        </div>
        <div
          style={{
            marginTop: 5,
            display: "flex",
            alignItems: "center",
            gap: 7,
            flexWrap: "wrap",
          }}
        >
          {prio && <WPill tone={prio.tone}>{prio.label}</WPill>}
          <WPill tone={st.tone}>{st.label}</WPill>
          {ai && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11.5,
                color: W_TOKENS.textMuted,
              }}
            >
              <WAIBadge id={t.sourceAI!} size={14} />
              {ai.name}
            </span>
          )}
          <span style={{ fontSize: 11.5, color: W_TOKENS.textFaint }}>·</span>
          <span style={{ fontSize: 11.5, color: W_TOKENS.textMuted }}>{t.source}</span>
          {t.assignee && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11.5,
                color: W_TOKENS.textMuted,
              }}
            >
              <WAvatar id={t.assignee} size={13} /> {W_HUMANS[t.assignee]?.name}
            </span>
          )}
        </div>
      </div>
      <span
        style={{
          fontSize: 12,
          color: isDone
            ? W_TOKENS.textFaint
            : t.dueTone === "danger"
            ? "#FCA5A5"
            : t.dueTone === "warn"
            ? "#FCD34D"
            : W_TOKENS.textMuted,
          fontWeight: 600,
          flexShrink: 0,
          marginTop: 3,
        }}
      >
        {t.due}
      </span>
    </button>
  );
}

function TaskDetail({ t, onClose }: { t: WTask; onClose: () => void }) {
  const ai = t.sourceAI ? W_AGENTS.find((x) => x.id === t.sourceAI) : null;
  const isDone = t.state === "done";
  return (
    <div style={{ padding: 24 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <WPill
          tone={
            isDone ? "success" : t.state === "tracking" ? "cyan" : "accent"
          }
        >
          {isDone
            ? "已完成"
            : t.state === "review"
            ? "审核中"
            : t.state === "tracking"
            ? "进行中"
            : "待办"}
        </WPill>
        {ai && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 12,
              color: W_TOKENS.textSecondary,
            }}
          >
            <WAIBadge id={t.sourceAI!} size={16} radius={5} />
            来自 {ai.name}
          </span>
        )}
        <span style={{ fontSize: 12, color: W_TOKENS.textFaint }}>·</span>
        <span style={{ fontSize: 12, color: W_TOKENS.textMuted }}>{t.source}</span>
      </div>
      <h2
        style={{
          margin: 0,
          fontSize: 20,
          fontWeight: 700,
          color: W_TOKENS.textPrimary,
          letterSpacing: -0.3,
          lineHeight: 1.4,
        }}
      >
        {t.title}
      </h2>
      <div
        style={{
          marginTop: 16,
          padding: "14px 16px",
          borderRadius: 11,
          background: W_TOKENS.surfaceRaised,
          boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
          fontSize: 13.5,
          lineHeight: 1.55,
          color: W_TOKENS.textSecondary,
        }}
      >
        {t.detail ||
          "AI 自动派发的任务,详细上下文在原始会议纪要中。点击 「查看上下文」 跳转。"}
      </div>

      <div
        style={{
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 10,
        }}
      >
        <DetailField label="截止" value={t.due} />
        <DetailField
          label="负责人"
          value={
            t.assignee ? W_HUMANS[t.assignee]?.name || t.assignee : "我"
          }
        />
        {ai && (
          <DetailField label="派发 AI" value={ai.name} />
        )}
        <DetailField
          label="优先级"
          value={
            t.priority === "high"
              ? "紧急"
              : t.priority === "mid"
              ? "今日"
              : t.priority === "low"
              ? "本周"
              : "—"
          }
        />
      </div>

      <div
        style={{
          marginTop: 22,
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
        }}
      >
        <WButton variant="ghost" size="md" onClick={onClose}>
          关闭
        </WButton>
        {!isDone && (
          <WButton variant="primary" size="md" icon="check">
            标记完成
          </WButton>
        )}
      </div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "9px 12px",
        borderRadius: 8,
        background: W_TOKENS.surface,
        boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          color: W_TOKENS.textMuted,
          letterSpacing: 0.5,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 13.5,
          color: W_TOKENS.textPrimary,
          fontWeight: 500,
        }}
      >
        {value}
      </div>
    </div>
  );
}
