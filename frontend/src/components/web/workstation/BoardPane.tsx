"use client";

import { useState, useMemo, type DragEvent } from "react";
import { W_TOKENS } from "../tokens";
import { WIcon, WPill, WAIBadge, WAvatar } from "../atoms";
import { W_AGENTS, W_HUMANS } from "../data/agents";
import { W_TASKS, TASK_COLUMNS, type WTask, type WTaskState } from "../data/tasks";
import { PaneHeader } from "./PaneHeader";

/**
 * 任务看板 pane — R5.C.
 *
 * Kanban 风格 4 列 (待办 / 进行中 / 审核 / 已完成).
 * 卡片可拖拽切换状态 (HTML5 native drag API,不引入新 lib).
 *
 * **R5.C scope**: mock 数据, 拖拽只改 client state.
 * **后续 Saga**: 接 backend task transition API.
 */
export function BoardPane() {
  // local copy of tasks for drag-drop state update
  const [tasks, setTasks] = useState<WTask[]>(W_TASKS);
  const [dragId, setDragId] = useState<string | null>(null);
  const [hoverCol, setHoverCol] = useState<WTaskState | null>(null);

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

  return (
    <>
      <PaneHeader
        title="任务看板"
        sub="所有任务按状态分四列 — 卡片可拖拽切换 (待办 / 进行中 / 审核 / 已完成)"
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
