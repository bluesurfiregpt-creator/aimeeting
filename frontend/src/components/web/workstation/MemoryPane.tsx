"use client";

import { useState, useMemo, useEffect } from "react";
import { W_TOKENS } from "../tokens";
import {
  WIcon,
  WPill,
  WAIBadge,
  WButton,
  WCard,
  WSparkle,
} from "../atoms";
import { W_AGENTS } from "../data/agents";
import {
  W_MEMORIES,
  MEMORY_SCOPES,
  type WMemory,
  type WMemoryScope,
} from "../data/memories";
import { PaneHeader } from "./PaneHeader";
import { api, type V2MemoryLibraryItem } from "@/lib/api";

/**
 * 长期记忆 pane — R5.C.
 *
 * 来自 round-6 设计稿 MemoryPane:
 *  - "+ 手工添加" CTA
 *  - 紫渐变 brain hero box (sparkle 装饰)
 *  - filter (scope / 归属 AI / 搜索) + 刷新
 *  - 列表 (按 ai 分组隐式呈现, 顺序按 when desc)
 *  - 每条: 文字 + scope pill + AI badge + 入库时间 + 来源 + cited + revoke CTA
 *
 * Sprint 3 Web W2: 接 /api/v2/memory/library (Wave 1 Mobile 加的). axis_tag (6 轴)
 * 跟 WMemoryScope ("项目"/"合规"/"流程"/"决策") 不完全对齐, 用 keyword 模糊映射.
 * 拉失败 → fallback mock W_MEMORIES + "演示数据" pill.
 */

// backend axis_tag 6 个 (能力/决策/风险/经验/事实/约束) → mock WMemoryScope 4 个
// 不完全 1:1 — 用 keyword 模糊映射, 偏 conservative.
function axisTagToScope(axis: string | null): WMemoryScope {
  if (!axis) return "项目";
  if (axis.includes("决策")) return "决策";
  if (axis.includes("风险") || axis.includes("约束") || axis.includes("合规"))
    return "合规";
  if (axis.includes("流程") || axis.includes("经验")) return "流程";
  return "项目";
}

// backend V2MemoryLibraryItem → mock WMemory shape (MemRow 渲染兼容)
function adaptV2MemoryLibraryItem(item: V2MemoryLibraryItem): WMemory {
  return {
    id: item.id,
    text: item.content,
    ai: item.primary_ai?.name?.toUpperCase() || "MIRA",
    scope: axisTagToScope(item.axis_tag),
    when: new Date(item.created_at).toLocaleDateString("zh-CN"),
    source: item.source_meeting_title || "手工",
    citedTimes: 0, // backend library 没 cited_times 字段 (V1.5 加)
    byAuto: !!item.source_meeting_id, // 有 source_meeting 视为 AI 自动入库
  };
}

export function MemoryPane() {
  const [scope, setScope] = useState<"all" | WMemoryScope>("all");
  const [aiFilter, setAiFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [revoked, setRevoked] = useState<Set<string>>(new Set());

  // Sprint 3 Web W2: 拉真 memory library, fallback mock W_MEMORIES.
  const [memories, setMemories] = useState<WMemory[]>(W_MEMORIES);
  const [usingFallback, setUsingFallback] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const out = await api.getMemoryLibrary();
        if (cancelled) return;
        if (!out.items.length) {
          console.warn(
            "[MemoryPane] /api/v2/memory/library 返回空, 渲染 mock",
          );
          return;
        }
        setMemories(out.items.map(adaptV2MemoryLibraryItem));
        setUsingFallback(false);
      } catch (e) {
        console.warn(
          "[MemoryPane] /api/v2/memory/library 拉取失败, 渲染 mock:",
          e,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    return memories.filter((m) => {
      if (scope !== "all" && m.scope !== scope) return false;
      if (aiFilter !== "all" && m.ai !== aiFilter) return false;
      if (q.trim()) {
        const lq = q.toLowerCase();
        return (
          m.text.toLowerCase().includes(lq) ||
          m.source.toLowerCase().includes(lq)
        );
      }
      return true;
    });
  }, [scope, aiFilter, q, memories]);

  const aiOptions = Array.from(new Set(memories.map((m) => m.ai)))
    .map((id) => W_AGENTS.find((a) => a.id === id))
    .filter((a): a is NonNullable<typeof a> => !!a);

  // 反幻觉 pill (NORTH_STAR § 7.5)
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

  const handleRevoke = (id: string) => {
    setRevoked((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  return (
    <>
      <PaneHeader
        title="长期记忆 · 经验"
        sub="长期记忆是 AI 跨会议引用的事实库 — 会后系统自动从纪要里抽取(决策/风险/待办/分歧)并入库,你也可以手工添加。"
        extra={demoBadge}
        action={
          <WButton variant="primary" size="md" icon="plus">
            手工添加
          </WButton>
        }
      />

      {/* glow info banner */}
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 14,
          marginBottom: 18,
          background:
            "linear-gradient(135deg, #1a1530 0%, #2a1f4f 60%, #3a2563 100%)",
          boxShadow:
            "0 10px 24px rgba(124,92,250,0.20), inset 0 0 0 0.5px rgba(124,92,250,0.20)",
          padding: "14px 18px",
        }}
      >
        <WSparkle x={40} y={14} size={10} opacity={0.8} />
        <WSparkle x={94} y={36} size={6} opacity={0.5} />
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: "rgba(255,255,255,0.10)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.18)",
              flexShrink: 0,
            }}
          >
            <WIcon name="brain" size={17} color="#fff" stroke={1.8} />
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "#fff",
                letterSpacing: -0.1,
              }}
            >
              长期记忆 = AI 已经 内化的 经验
            </div>
            <div
              style={{
                fontSize: 12.5,
                color: "rgba(255,255,255,0.75)",
                marginTop: 3,
                lineHeight: 1.5,
              }}
            >
              短句 事实/决策/风险, AI 每次回答时自动带在 system prompt。跟「书架」区别:书架是 RAG 召回时才翻的,长期记忆是 AI 始终记得的。
            </div>
          </div>
        </div>
      </div>

      {/* filters */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 12,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as "all" | WMemoryScope)}
          style={selectStyle}
        >
          <option value="all">所有 scope</option>
          {MEMORY_SCOPES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={aiFilter}
          onChange={(e) => setAiFilter(e.target.value)}
          style={selectStyle}
        >
          <option value="all">所有归属</option>
          {aiOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <div
          style={{
            position: "relative",
            flex: 1,
            maxWidth: 360,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 32,
            padding: "0 10px",
            borderRadius: 8,
            background: W_TOKENS.surface,
            boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
          }}
        >
          <WIcon name="search" size={13} color={W_TOKENS.textMuted} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="按文字 / 来源 过滤"
            style={{
              background: "transparent",
              border: "none",
              outline: "none",
              color: W_TOKENS.textPrimary,
              fontFamily: "inherit",
              fontSize: 13,
              flex: 1,
            }}
          />
        </div>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: W_TOKENS.textMuted }}>
          共 <strong style={{ color: W_TOKENS.textPrimary }}>{filtered.length}</strong> 条
        </span>
      </div>

      <WCard padding={0}>
        {filtered.map((m, i) => (
          <MemRow
            key={m.id}
            m={m}
            last={i === filtered.length - 1}
            revoked={revoked.has(m.id)}
            onRevoke={() => handleRevoke(m.id)}
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
            没有匹配的记忆
          </div>
        )}
      </WCard>
    </>
  );
}

function MemRow({
  m,
  last,
  revoked,
  onRevoke,
}: {
  m: WMemory;
  last: boolean;
  revoked: boolean;
  onRevoke: () => void;
}) {
  const ai = W_AGENTS.find((x) => x.id === m.ai);
  return (
    <div
      style={{
        padding: "14px 18px",
        borderBottom: last ? "none" : `0.5px solid ${W_TOKENS.border}`,
        opacity: revoked ? 0.4 : 1,
        transition: "opacity 200ms ease",
      }}
    >
      <div
        style={{
          fontSize: 13.5,
          color: W_TOKENS.textPrimary,
          lineHeight: 1.55,
          textWrap: "pretty",
          textDecoration: revoked ? "line-through" : "none",
        }}
      >
        {m.text}
      </div>
      <div
        style={{
          marginTop: 9,
          display: "flex",
          alignItems: "center",
          gap: 9,
          flexWrap: "wrap",
          fontSize: 11.5,
          color: W_TOKENS.textMuted,
        }}
      >
        <WPill tone="accent">{m.scope}</WPill>
        {ai && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <WAIBadge id={m.ai} size={14} /> {ai.name}
          </span>
        )}
        <span>·</span>
        <span>入库 {m.when}</span>
        <span>·</span>
        <span>来源 {m.source}</span>
        <span>·</span>
        <span
          style={{
            fontWeight: 600,
            color: W_TOKENS.textSecondary,
          }}
        >
          被引用 {m.citedTimes} 次
        </span>
        {m.byAuto ? (
          <WPill tone="cyan" size="sm">
            AI 自动
          </WPill>
        ) : (
          <WPill tone="warn" size="sm">
            手工
          </WPill>
        )}
        <span style={{ flex: 1 }} />
        {!revoked && (
          <button
            type="button"
            onClick={onRevoke}
            style={{
              height: 22,
              padding: "0 8px",
              borderRadius: 5,
              background: "transparent",
              boxShadow: "inset 0 0 0 0.5px rgba(239,68,68,0.30)",
              border: "none",
              color: "#FCA5A5",
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            撤回
          </button>
        )}
        {revoked && (
          <WPill tone="danger" size="sm">
            已撤回
          </WPill>
        )}
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  height: 32,
  padding: "0 10px",
  borderRadius: 8,
  background: W_TOKENS.surface,
  boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
  color: W_TOKENS.textPrimary,
  fontSize: 13,
  border: "none",
  outline: "none",
  fontFamily: "inherit",
};
