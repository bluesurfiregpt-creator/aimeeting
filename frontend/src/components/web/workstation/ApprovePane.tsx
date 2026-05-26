"use client";

import { useState } from "react";
import { W_TOKENS } from "../tokens";
import {
  WIcon,
  WPill,
  WAvatar,
  WAIBadge,
  WButton,
  WCard,
  WSparkle,
} from "../atoms";
import { W_AGENTS, W_HUMANS } from "../data/agents";
import { PaneHeader } from "./PaneHeader";

/**
 * 审批中心 pane — R5.C.
 *
 * 来自 round-6 设计稿 ApprovalPane (web-extras.jsx):
 *  - segmented (待审 / 已通过 / 已驳回)
 *  - 紫渐变 banner "AI 智囊 · 待审 N 条" + 全部通过 CTA
 *  - 列表 ApprovalCard:
 *    - kind pill (memory / permission / workspace) + priority pill
 *    - 来源 + 时间
 *    - 描述
 *    - 驳回 / 通过 CTA
 *
 * **后续 Saga**: 接 backend approvals API.
 */
type ApprovalKind = "memory" | "permission" | "workspace";
type ApprovalPriority = "high" | "mid" | "low";

type ApprovalItem = {
  id: string;
  kind: ApprovalKind;
  title: string;
  from: string | null;     // W_AGENTS id 或 W_HUMANS id
  source: string;
  when: string;
  priority: ApprovalPriority;
};

const APPROVAL_ITEMS: ApprovalItem[] = [
  {
    id: "ap1",
    kind: "memory",
    title: "AI 提取候选记忆 · B 组延迟 +320ms 但有用率 +11.4pp 显著",
    from: "ARIA",
    source: "Q3 路线图对齐",
    when: "10 分钟前",
    priority: "high",
  },
  {
    id: "ap2",
    kind: "memory",
    title: "AI 提取候选记忆 · 客户报销凭证语义抽取改为三槽位",
    from: "ARIA",
    source: "财务模型周会",
    when: "昨天 14:08",
    priority: "mid",
  },
  {
    id: "ap3",
    kind: "permission",
    title: "王俊 申请加入 数据安全合规 知识库的写入权限",
    from: "WJ",
    source: "权限申请",
    when: "昨天 11:20",
    priority: "mid",
  },
  {
    id: "ap4",
    kind: "workspace",
    title: "小伙子 申请跨 workspace 引用 法老张 的记忆",
    from: null,
    source: "跨域共享",
    when: "2 天前",
    priority: "low",
  },
  {
    id: "ap5",
    kind: "memory",
    title: "AI 提取候选记忆 · chip 顺序固定为 主题 → 时间 → 参与人",
    from: "SAGE",
    source: "搜索体验评审 #3",
    when: "昨天 17:20",
    priority: "mid",
  },
];

export function ApprovePane() {
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">(
    "pending",
  );
  // 已处理的 id (mock)
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [rejected, setRejected] = useState<Set<string>>(new Set());

  const visible = APPROVAL_ITEMS.filter((it) => {
    if (tab === "pending") return !approved.has(it.id) && !rejected.has(it.id);
    if (tab === "approved") return approved.has(it.id);
    return rejected.has(it.id);
  });

  const pendingCount = APPROVAL_ITEMS.filter(
    (it) => !approved.has(it.id) && !rejected.has(it.id),
  ).length;
  const memCount = APPROVAL_ITEMS.filter(
    (it) => it.kind === "memory" && !approved.has(it.id) && !rejected.has(it.id),
  ).length;

  const handleApprove = (id: string) =>
    setApproved((prev) => new Set(prev).add(id));
  const handleReject = (id: string) =>
    setRejected((prev) => new Set(prev).add(id));

  return (
    <>
      <PaneHeader
        title="审批中心"
        sub="AI 提炼的候选记忆、权限申请、跨 workspace 引用 — 都在这里集中处理"
      />

      {/* segmented */}
      <div
        style={{
          display: "inline-flex",
          gap: 4,
          padding: 4,
          marginBottom: 16,
          background: W_TOKENS.surface,
          borderRadius: 10,
          boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
        }}
      >
        {[
          { id: "pending" as const, label: "待审", count: pendingCount },
          { id: "approved" as const, label: "已通过", count: approved.size + 142 },
          { id: "rejected" as const, label: "已驳回", count: rejected.size + 8 },
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
              background:
                tab === t.id ? "rgba(124,92,250,0.16)" : "transparent",
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

      {/* glow banner (only on pending) */}
      {tab === "pending" && pendingCount > 0 && (
        <div
          style={{
            position: "relative",
            overflow: "hidden",
            borderRadius: 12,
            marginBottom: 16,
            background:
              "linear-gradient(135deg, #15102f 0%, #1c1538 50%, #251a40 100%)",
            boxShadow: "inset 0 0 0 0.5px rgba(124,92,250,0.20)",
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            gap: 11,
          }}
        >
          <WSparkle x={40} y={10} size={9} opacity={0.85} />
          <WSparkle x={84} y={30} size={5} opacity={0.55} />
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              flexShrink: 0,
              background: "rgba(255,255,255,0.10)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.20)",
            }}
          >
            <WIcon name="sparkle" size={14} color="#fff" stroke={2} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "#fff" }}>
              AI 智囊 · 待审 {pendingCount} 条 · 其中 {memCount} 条候选记忆
            </div>
            <div
              style={{
                fontSize: 11.5,
                color: "rgba(255,255,255,0.65)",
                marginTop: 2,
              }}
            >
              通过后会进入长期记忆库,所有 AI 都能在会议中引用
            </div>
          </div>
          <WButton variant="ghost" size="sm">
            全部通过
          </WButton>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {visible.map((it) => (
          <ApprovalCard
            key={it.id}
            it={it}
            mode={tab}
            onApprove={() => handleApprove(it.id)}
            onReject={() => handleReject(it.id)}
          />
        ))}
        {visible.length === 0 && (
          <WCard>
            <div
              style={{
                textAlign: "center",
                padding: "30px 16px",
                color: W_TOKENS.textMuted,
                fontSize: 14,
              }}
            >
              {tab === "pending" ? "全部审批完毕 ✓" : "暂无记录"}
            </div>
          </WCard>
        )}
      </div>
    </>
  );
}

function ApprovalCard({
  it,
  mode,
  onApprove,
  onReject,
}: {
  it: ApprovalItem;
  mode: "pending" | "approved" | "rejected";
  onApprove: () => void;
  onReject: () => void;
}) {
  const ai = it.from ? W_AGENTS.find((x) => x.id === it.from) : null;
  const human = it.from && !ai ? W_HUMANS[it.from] : null;
  const priorityMap: Record<
    ApprovalPriority,
    { tone: "danger" | "warn" | "neutral"; label: string }
  > = {
    high: { tone: "danger", label: "紧急" },
    mid: { tone: "warn", label: "今日" },
    low: { tone: "neutral", label: "本周" },
  };
  const kindMap: Record<
    ApprovalKind,
    { tone: "accent" | "warn" | "cyan"; label: string }
  > = {
    memory: { tone: "accent", label: "候选记忆" },
    permission: { tone: "warn", label: "权限申请" },
    workspace: { tone: "cyan", label: "跨域引用" },
  };
  return (
    <WCard padding={0}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 13,
          padding: "14px 18px",
          borderLeft:
            it.priority === "high" ? "2px solid #ef4444" : "2px solid transparent",
        }}
      >
        <div style={{ flexShrink: 0 }}>
          {ai ? (
            <WAIBadge id={it.from!} size={32} radius={8} />
          ) : human ? (
            <WAvatar id={it.from!} size={32} />
          ) : (
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "rgba(255,255,255,0.06)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
              }}
            >
              <WIcon name="users" size={14} color={W_TOKENS.textMuted} />
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <WPill tone={kindMap[it.kind].tone} size="sm">
              {kindMap[it.kind].label}
            </WPill>
            <WPill tone={priorityMap[it.priority].tone} size="sm">
              {priorityMap[it.priority].label}
            </WPill>
            <span style={{ fontSize: 11.5, color: W_TOKENS.textMuted }}>
              {it.source} · {it.when}
            </span>
          </div>
          <div
            style={{
              marginTop: 7,
              fontSize: 14,
              color: W_TOKENS.textPrimary,
              lineHeight: 1.4,
              textWrap: "pretty",
            }}
          >
            {it.title}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {mode === "pending" ? (
            <>
              <WButton variant="secondary" size="sm" onClick={onReject}>
                驳回
              </WButton>
              <WButton variant="primary" size="sm" icon="check" onClick={onApprove}>
                通过
              </WButton>
            </>
          ) : mode === "approved" ? (
            <WPill tone="success">已通过</WPill>
          ) : (
            <WPill tone="danger">已驳回</WPill>
          )}
        </div>
      </div>
    </WCard>
  );
}
