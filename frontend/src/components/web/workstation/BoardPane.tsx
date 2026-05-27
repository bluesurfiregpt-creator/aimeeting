"use client";

import { useState, useMemo, useEffect, type DragEvent } from "react";
import { W_TOKENS } from "../tokens";
import { WIcon, WPill, WAIBadge, WAvatar } from "../atoms";
import { W_AGENTS, W_HUMANS } from "../data/agents";
import { W_TASKS, TASK_COLUMNS, type WTask, type WTaskState } from "../data/tasks";
import { PaneHeader } from "./PaneHeader";
import { api, type V2TaskItem, type V2TaskGroup } from "@/lib/api";

/**
 * 任务看板 pane — R5.C.
 *
 * Kanban 风格 4 列 (待办 / 进行中 / 审核 / 已完成).
 * 卡片可拖拽切换状态 (HTML5 native drag API,不引入新 lib).
 *
 * Sprint 3 Web W2: 接 /api/v2/tasks/grouped (3 status: pending/tracking/done 并行拉).
 * backend 3 status → frontend 4 col 映射:
 *   pending  → todo
 *   tracking → tracking
 *   tracking → review (拆不出, 全归 tracking)
 *   done     → done
 * 拖拽改状态目前仅 client side (后续 backend task transition API).
 */

// backend V2TaskItem → mock WTask (跟 TasksPane 同 adapter, 但 inline 简化版)
function adaptV2TaskBoard(t: V2TaskItem, fallbackState: WTaskState): WTask {
  const stateMap: Record<string, WTaskState> = {
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

export function BoardPane() {
  // local copy of tasks for drag-drop state update
  const [tasks, setTasks] = useState<WTask[]>(W_TASKS);
  const [usingFallback, setUsingFallback] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [hoverCol, setHoverCol] = useState<WTaskState | null>(null);

  // Sprint 3 Web W2: 拉 3 个 status 并行 (跟 TasksPane 一致, 复用 backend).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [pending, tracking, done] = await Promise.allSettled([
        api.getTasksGrouped("pending"),
        api.getTasksGrouped("tracking"),
        api.getTasksGrouped("done"),
      ]);
      if (cancelled) return;
      const allTasks: WTask[] = [];
      const collectGroups = (
        res: PromiseSettledResult<{ groups: V2TaskGroup[] }>,
        fallbackState: WTaskState,
      ) => {
        if (res.status !== "fulfilled") return;
        for (const grp of res.value.groups || []) {
          for (const t of grp.tasks || []) {
            allTasks.push(adaptV2TaskBoard(t, fallbackState));
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
          "[BoardPane] /api/v2/tasks/grouped 全空 (workspace 无任务), 渲染 mock",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const byCol = useMemo(() => {
    const map: Record<WTaskState, WTask[]> = {
      todo: [],
      tracking: [],
      review: [],
      done: [],
    };
    tasks.forEach((t) => map[t.state].push(t));
    return map;
  }, [tasks]);

  const onDragStart = (e: DragEvent<HTMLDivElement>, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>, state: WTaskState) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || dragId;
    if (!id) return;
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, state } : t)),
    );
    setDragId(null);
    setHoverCol(null);
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>, state: WTaskState) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (hoverCol !== state) setHoverCol(state);
  };

  const onDragLeaveCol = () => setHoverCol(null);

  // Sprint 3 Web W2: 反幻觉 pill (NORTH_STAR § 7.5)
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

  return (
    <>
      <PaneHeader
        title="任务看板"
        sub="所有任务按状态分四列 — 卡片可拖拽切换 (待办 / 进行中 / 审核 / 已完成)"
        extra={demoBadge}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 14,
          minHeight: "calc(100vh - 240px)",
        }}
      >
        {TASK_COLUMNS.map((col) => (
          <BoardColumn
            key={col.id}
            label={col.label}
            color={col.color}
            tasks={byCol[col.id]}
            hovered={hoverCol === col.id}
            onDragOver={(e) => onDragOver(e, col.id)}
            onDrop={(e) => onDrop(e, col.id)}
            onDragLeave={onDragLeaveCol}
            renderCard={(t) => (
              <TaskCard
                key={t.id}
                t={t}
                accent={col.color}
                onDragStart={(e) => onDragStart(e, t.id)}
                onDragEnd={() => {
                  setDragId(null);
                  setHoverCol(null);
                }}
                dragging={dragId === t.id}
              />
            )}
          />
        ))}
      </div>

      <div
        style={{
          marginTop: 18,
          fontSize: 12,
          color: W_TOKENS.textMuted,
          textAlign: "center",
        }}
      >
        拖拽卡片可切换状态 · mock 模式 (刷新后还原)
      </div>
    </>
  );
}

function BoardColumn({
  label,
  color,
  tasks,
  hovered,
  onDragOver,
  onDrop,
  onDragLeave,
  renderCard,
}: {
  label: string;
  color: string;
  tasks: WTask[];
  hovered: boolean;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  renderCard: (t: WTask) => React.ReactNode;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
      style={{
        background: hovered ? `${color}0A` : W_TOKENS.surface,
        borderRadius: 12,
        boxShadow: hovered
          ? `inset 0 0 0 1.5px ${color}66`
          : `inset 0 0 0 0.5px ${W_TOKENS.border}`,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        transition: "box-shadow 140ms ease, background 140ms ease",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingBottom: 4,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: color,
              boxShadow: `0 0 8px ${color}66`,
            }}
          />
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: W_TOKENS.textPrimary,
              letterSpacing: 0.2,
            }}
          >
            {label}
          </span>
          <span
            style={{
              fontSize: 11.5,
              color: W_TOKENS.textMuted,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {tasks.length}
          </span>
        </div>
        <button
          type="button"
          aria-label="add"
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: W_TOKENS.textMuted,
            padding: 4,
          }}
        >
          <WIcon name="plus" size={14} stroke={2} />
        </button>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          flex: 1,
        }}
      >
        {tasks.length === 0 ? (
          <div
            style={{
              padding: "30px 14px",
              textAlign: "center",
              fontSize: 12,
              color: W_TOKENS.textFaint,
              border: `1px dashed ${W_TOKENS.border}`,
              borderRadius: 8,
            }}
          >
            拖到这里
          </div>
        ) : (
          tasks.map((t) => renderCard(t))
        )}
      </div>
    </div>
  );
}

function TaskCard({
  t,
  accent,
  onDragStart,
  onDragEnd,
  dragging,
}: {
  t: WTask;
  accent: string;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  dragging: boolean;
}) {
  const ai = t.sourceAI ? W_AGENTS.find((x) => x.id === t.sourceAI) : null;
  const dueColor =
    t.dueTone === "danger"
      ? "#FCA5A5"
      : t.dueTone === "warn"
      ? "#FCD34D"
      : W_TOKENS.textMuted;
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={{
        padding: "11px 12px",
        borderRadius: 9,
        background: W_TOKENS.surfaceRaised,
        boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}, 0 1px 2px rgba(0,0,0,0.04)`,
        cursor: "grab",
        opacity: dragging ? 0.4 : 1,
        transform: dragging ? "scale(0.97)" : "none",
        transition: "transform 100ms ease, opacity 100ms ease",
        borderLeft: `3px solid ${accent}`,
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: W_TOKENS.textPrimary,
          lineHeight: 1.4,
          marginBottom: 8,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {t.title}
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 6,
          marginBottom: 8,
        }}
      >
        {t.priority === "high" && <WPill tone="danger">紧急</WPill>}
        {t.priority === "mid" && <WPill tone="warn">今日</WPill>}
        {ai && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 6px 2px 2px",
              borderRadius: 4,
              background: "rgba(255,255,255,0.04)",
              boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
              fontSize: 10.5,
              color: W_TOKENS.textSecondary,
            }}
          >
            <WAIBadge id={t.sourceAI!} size={14} radius={3} />
            {ai.name}
          </span>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          color: W_TOKENS.textMuted,
          lineHeight: 1,
        }}
      >
        <WIcon name="clock" size={11} color={dueColor} />
        <span style={{ color: dueColor, fontWeight: 600 }}>{t.due}</span>
        <span style={{ flex: 1 }} />
        {t.assignee && <WAvatar id={t.assignee} size={16} />}
      </div>
    </div>
  );
}
