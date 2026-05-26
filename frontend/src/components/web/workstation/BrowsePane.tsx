"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { W_TOKENS } from "../tokens";
import { WIcon, WAIBadge, WCard } from "../atoms";
import {
  W_AGENTS,
  W_CATEGORIES,
  filterAgents,
  type WAgent,
} from "../data/agents";
import { PaneHeader } from "./PaneHeader";

/**
 * AI 卡片浏览 pane — R5.C.
 *
 * 来自 round-6 设计稿 BrowsePane, R5.C 加 filter + 订阅 CTA.
 *
 * 区分跟 AgentsPane: browse 是公共市场 (全部 AI 可订阅),
 * agents 是 workspace 内已订阅/已管理的 AI.
 *
 * 排序: 全部 / 热度 (sum desc) / 最新 (updated) / 已订阅 (byMe).
 *
 * 点卡 → 跳 /workstation/agent/<id>.
 * 订阅 CTA → mock client state.
 */
export function BrowsePane() {
  const router = useRouter();
  const [cat, setCat] = useState<string>("all");
  const [sortMode, setSortMode] = useState<"all" | "hot" | "new" | "subscribed">(
    "all",
  );
  const [subscribed, setSubscribed] = useState<Set<string>>(
    new Set(W_AGENTS.filter((a) => a.byMe).map((a) => a.id)),
  );

  const filtered = useMemo(() => {
    let list = filterAgents(W_AGENTS, cat);
    if (sortMode === "hot") list = [...list].sort((a, b) => b.sum - a.sum);
    if (sortMode === "new") {
      // updated 排序: 今天/昨天 优先
      const score = (u: string) => {
        if (u === "今天") return 1000;
        if (u === "昨天") return 999;
        // "5/24" → 数值大优先
        const m = u.match(/(\d+)\/(\d+)/);
        if (m) return Number(m[1]) * 31 + Number(m[2]);
        return 0;
      };
      list = [...list].sort((a, b) => score(b.updated) - score(a.updated));
    }
    if (sortMode === "subscribed") list = list.filter((a) => subscribed.has(a.id));
    return list;
  }, [cat, sortMode, subscribed]);

  const toggleSub = (id: string) => {
    setSubscribed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <PaneHeader
        title="AI 卡片浏览"
        sub="按角色发现 AI 专家 — 想看 AI 怎么思考问题,点开任一卡片即可。订阅后会出现在「AI 专家管理」"
      />

      {/* sort tabs */}
      <div
        style={{
          display: "inline-flex",
          gap: 4,
          padding: 4,
          background: W_TOKENS.surface,
          borderRadius: 10,
          boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
          marginBottom: 14,
        }}
      >
        {[
          { id: "all" as const, label: "全部", count: W_AGENTS.length },
          { id: "hot" as const, label: "热度", count: W_AGENTS.length },
          { id: "new" as const, label: "最新", count: W_AGENTS.length },
          {
            id: "subscribed" as const,
            label: "已订阅",
            count: subscribed.size,
          },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSortMode(t.id)}
            style={{
              height: 30,
              padding: "0 14px",
              borderRadius: 7,
              border: "none",
              background:
                sortMode === t.id ? "rgba(124,92,250,0.16)" : "transparent",
              boxShadow:
                sortMode === t.id
                  ? "inset 0 0 0 0.5px rgba(124,92,250,0.30)"
                  : "none",
              color: sortMode === t.id ? "#C4B5FD" : W_TOKENS.textSecondary,
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

      {/* category chips */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          marginBottom: 16,
        }}
      >
        {W_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCat(c.id)}
            style={{
              height: 28,
              padding: "0 11px",
              borderRadius: 7,
              border: "none",
              background:
                cat === c.id ? "rgba(124,92,250,0.16)" : W_TOKENS.surface,
              boxShadow:
                cat === c.id
                  ? "inset 0 0 0 0.5px rgba(124,92,250,0.30)"
                  : `inset 0 0 0 0.5px ${W_TOKENS.border}`,
              color: cat === c.id ? "#C4B5FD" : W_TOKENS.textSecondary,
              fontSize: 12.5,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 12,
        }}
      >
        {filtered.map((a) => (
          <BrowseCard
            key={a.id}
            a={a}
            subscribed={subscribed.has(a.id)}
            onOpen={() => router.push(`/workstation/agent/${a.id}`)}
            onToggleSub={() => toggleSub(a.id)}
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <div
          style={{
            padding: "60px 24px",
            textAlign: "center",
            color: W_TOKENS.textMuted,
            fontSize: 14,
          }}
        >
          <WIcon name="search" size={32} color={W_TOKENS.textFaint} stroke={1.4} />
          <div style={{ marginTop: 12 }}>没有匹配的 AI 专家</div>
        </div>
      )}
    </>
  );
}

function BrowseCard({
  a,
  subscribed,
  onOpen,
  onToggleSub,
}: {
  a: WAgent;
  subscribed: boolean;
  onOpen: () => void;
  onToggleSub: () => void;
}) {
  return (
    <WCard hover padding={16} onClick={onOpen}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 11,
          marginBottom: 10,
        }}
      >
        <WAIBadge id={a.id} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: W_TOKENS.textPrimary,
            }}
          >
            {a.name}
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: W_TOKENS.textMuted,
              marginTop: 1,
            }}
          >
            {a.domain}
          </div>
        </div>
      </div>
      <div
        style={{
          fontSize: 12.5,
          color: W_TOKENS.textSecondary,
          lineHeight: 1.55,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          textWrap: "pretty",
          marginBottom: 12,
        }}
      >
        {a.intro}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          paddingTop: 10,
          borderTop: `0.5px solid ${W_TOKENS.border}`,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: W_TOKENS.textMuted,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {a.sum} 次召唤 · 更新 {a.updated}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSub();
          }}
          style={{
            height: 26,
            padding: "0 10px",
            borderRadius: 6,
            border: "none",
            background: subscribed
              ? "rgba(34,197,94,0.14)"
              : W_TOKENS.accentGrad,
            color: subscribed ? "#86EFAC" : "#fff",
            fontSize: 11.5,
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            boxShadow: subscribed
              ? "inset 0 0 0 0.5px rgba(34,197,94,0.30)"
              : "0 2px 8px rgba(124,92,250,0.30)",
          }}
        >
          {subscribed ? (
            <>
              <WIcon name="check" size={11} stroke={2.4} color="#86EFAC" />
              已订阅
            </>
          ) : (
            <>
              <WIcon name="plus" size={11} stroke={2.4} color="#fff" />
              订阅
            </>
          )}
        </button>
      </div>
    </WCard>
  );
}
