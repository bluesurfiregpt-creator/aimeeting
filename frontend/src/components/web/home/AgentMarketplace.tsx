"use client";

import { useMemo, useState } from "react";
import { W_TOKENS } from "../tokens";
import {
  W_AGENTS,
  W_CATEGORIES,
  filterAgents,
  type WAgent,
} from "../data/agents";
import { WAIBadge, WCard, WIcon, WPill } from "../atoms";

type SortKind = "hot" | "new";

/**
 * AI 专家市场 — 9 类目快切 + 最热/最新 + 实时搜索 + 16 张卡片 grid.
 *
 * R5.A scope: 用 W_AGENTS hardcode (PM R7).
 * 后续 Saga 接 workspace_agents 动态数据.
 *
 * 点卡 → `onOpenAgent(id)` 由父级控制 (打开 AgentQuickModal).
 */
export function AgentMarketplace({
  onOpenAgent,
}: {
  onOpenAgent: (id: string) => void;
}) {
  const [cat, setCat] = useState<string>("all");
  const [sort, setSort] = useState<SortKind>("hot");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    let arr = W_AGENTS.slice();
    if (q.trim()) {
      const lower = q.toLowerCase();
      arr = arr.filter(
        (a) =>
          a.name.toLowerCase().includes(lower) ||
          a.nick.toLowerCase().includes(lower) ||
          a.domain.toLowerCase().includes(lower) ||
          a.tags.some((t) => t.toLowerCase().includes(lower)),
      );
    }
    arr = filterAgents(arr, cat);
    arr.sort((a, b) => {
      if (sort === "hot") return b.sum - a.sum;
      // "new" — 按 updated string 排序, "今天" > "昨天" > "5/xx"
      const score = (s: string) => {
        if (s === "今天") return 9999;
        if (s === "昨天") return 9998;
        const m = s.match(/^(\d+)\/(\d+)$/);
        if (m) return parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
        return 0;
      };
      return score(b.updated) - score(a.updated);
    });
    return arr;
  }, [cat, sort, q]);

  return (
    <div style={{ marginTop: 18 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 13, color: W_TOKENS.textMuted }}>
          从 32 位领域专家中挑选 · 或在上方对话框告诉 Mira 你的目标
        </span>
        <div style={{ display: "inline-flex", gap: 8 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              background: W_TOKENS.surface,
              borderRadius: 8,
              boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
              padding: 3,
            }}
          >
            {(["hot", "new"] as SortKind[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSort(s)}
                style={{
                  height: 26,
                  padding: "0 10px",
                  borderRadius: 6,
                  border: "none",
                  background: sort === s ? "rgba(255,255,255,0.08)" : "transparent",
                  color: sort === s ? W_TOKENS.textPrimary : W_TOKENS.textMuted,
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                {s === "hot" ? "最热" : "最新"}
              </button>
            ))}
          </div>
          <div
            style={{
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
              placeholder="搜索 姓名 / 外号 / 领域"
              style={{
                background: "transparent",
                border: "none",
                outline: "none",
                color: W_TOKENS.textPrimary,
                fontFamily: "inherit",
                fontSize: 13,
                width: 200,
              }}
            />
          </div>
        </div>
      </div>

      {/* category chips */}
      <div style={{ display: "flex", gap: 7, marginBottom: 18, flexWrap: "wrap" }}>
        {W_CATEGORIES.map((c) => {
          const on = cat === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setCat(c.id)}
              style={{
                padding: "5px 12px",
                borderRadius: 7,
                border: "none",
                background: on ? "rgba(124,92,250,0.16)" : "rgba(255,255,255,0.04)",
                boxShadow: on
                  ? "inset 0 0 0 0.5px rgba(124,92,250,0.40)"
                  : `inset 0 0 0 0.5px ${W_TOKENS.border}`,
                color: on ? "#C4B5FD" : W_TOKENS.textSecondary,
                fontSize: 12.5,
                fontWeight: 600,
                fontFamily: "inherit",
                cursor: "pointer",
                transition: "all 140ms ease",
              }}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 14,
        }}
      >
        {filtered.map((a) => (
          <AgentCard key={a.id} a={a} onClick={() => onOpenAgent(a.id)} />
        ))}
      </div>
      {filtered.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "60px 24px",
            color: W_TOKENS.textMuted,
            fontSize: 14,
          }}
        >
          <WIcon name="search" size={32} color={W_TOKENS.textFaint} stroke={1.4} />
          <div style={{ marginTop: 12 }}>没有匹配的专家 · 调整一下筛选或搜索</div>
        </div>
      )}
    </div>
  );
}

function AgentCard({ a, onClick }: { a: WAgent; onClick: () => void }) {
  return (
    <WCard hover padding={0} onClick={onClick}>
      <div style={{ padding: "16px 16px 14px", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <WAIBadge id={a.id} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <h3
                style={{
                  margin: 0,
                  fontSize: 15,
                  fontWeight: 700,
                  color: W_TOKENS.textPrimary,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  letterSpacing: -0.2,
                }}
              >
                {a.name}
              </h3>
              {a.nick && a.nick !== a.name && (
                <span style={{ fontSize: 11.5, color: W_TOKENS.textMuted }}>· {a.nick}</span>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: W_TOKENS.textMuted, marginTop: 2 }}>
              {a.domain}
            </div>
          </div>
          {a.byMe && <WPill tone="accent">我管理</WPill>}
        </div>

        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
          {a.tags.slice(0, 4).map((t) => (
            <WPill key={t} tone="neutral">
              {t}
            </WPill>
          ))}
        </div>

        <div
          style={{
            fontSize: 12.5,
            lineHeight: 1.6,
            color: W_TOKENS.textSecondary,
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            minHeight: 60,
          }}
        >
          {a.intro}
        </div>
      </div>

      <div
        style={{
          padding: "10px 14px",
          borderTop: `0.5px solid ${W_TOKENS.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 11.5,
          color: W_TOKENS.textMuted,
        }}
      >
        <div style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
            <WIcon name="users" size={12} color={W_TOKENS.textMuted} />
            {a.sum} 次召唤
          </span>
          <span>· {a.updated}</span>
        </div>
        <button
          type="button"
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "#C4B5FD",
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "inherit",
            padding: 0,
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
          }}
        >
          邀请到会议
          <WIcon name="arr-r" size={11} color="#C4B5FD" stroke={2.2} />
        </button>
      </div>
    </WCard>
  );
}
