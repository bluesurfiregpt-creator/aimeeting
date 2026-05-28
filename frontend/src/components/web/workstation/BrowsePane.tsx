"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { W_TOKENS } from "../tokens";
import { WIcon, WAIBadge, WCard } from "../atoms";
import {
  W_AGENTS,
  W_CATEGORIES,
  filterAgents,
  type WAgent,
} from "../data/agents";
import { api, type Agent } from "@/lib/api";
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
 *
 * v1.4.0 Sprint S5 真接 (PM 反馈 mockup):
 *  - W_AGENTS 16 个 hardcoded → api.listAgents() 真接 (当前 ws 内 backend agent)
 *  - 名字 匹配 mock W_AGENTS → 复用 mock glyph + grad (保 视觉 一致)
 *  - 名字 不在 mock → fallback inline avatar (首字母 + 默认 紫)
 *  - 订阅 CTA 仍 mock (后端 无 subscribe endpoint, 加 pill 标 演示)
 *  - API 失败 → 加 fallback pill + 显 W_AGENTS mock (反幻觉 § 7.5)
 */

/** v1.4.0 Sprint S5: backend Agent → 前端展示 (复用 W_AGENTS 视觉, fallback 默认 渲染) */
type DisplayAgent = WAgent & {
  /** v1.4.0: 此条 是否 在 W_AGENTS 内 (true → 用 WAIBadge; false → inline fallback avatar). */
  mockMatched: boolean;
  /** v1.4.0: 后端 agent.id (UUID). mockMatched=true 时 WAgent.id 是 mock id (eg "ARIA"). */
  backendId?: string;
};

function fmtUpdated(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    const now = new Date();
    const diffH = (now.getTime() - d.getTime()) / 1000 / 3600;
    if (diffH < 24) return "今天";
    if (diffH < 48) return "昨天";
    if (diffH < 24 * 7) return `${Math.floor(diffH / 24)} 天前`;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return "—";
  }
}

function backendToDisplay(be: Agent): DisplayAgent {
  // 优先 按 name 匹配 mock — 视觉 一致
  const mock = W_AGENTS.find((m) => m.name === be.name);
  if (mock) {
    return {
      ...mock,
      // 真 stats 覆盖 mock
      sum: be.invoke_count ?? mock.sum,
      updated: fmtUpdated(be.created_at),
      intro: be.persona || mock.intro,
      // 当前 ws 内 都 算 "已订阅"
      byMe: true,
      mockMatched: true,
      backendId: be.id,
    };
  }
  // 没 mock match — 用 backend 字段 凑 DisplayAgent
  const color = (be.color || "#7C5CFA").trim();
  const glyph = (be.nickname?.[0] || be.name[0] || "◎").slice(0, 1);
  return {
    id: be.id,
    name: be.name,
    nick: be.nickname || "AI 专家",
    domain: be.domain || "通用",
    tags: be.keywords ?? [],
    grad: [color, color] as [string, string],
    glyph,
    sum: be.invoke_count ?? 0,
    updated: fmtUpdated(be.created_at),
    byMe: true,
    intro: be.persona || "(无简介)",
    mockMatched: false,
    backendId: be.id,
  };
}

export function BrowsePane() {
  const router = useRouter();
  const [cat, setCat] = useState<string>("all");
  const [sortMode, setSortMode] = useState<"all" | "hot" | "new" | "subscribed">(
    "all",
  );
  // v1.4.0 Sprint S5 真接
  const [displayList, setDisplayList] = useState<DisplayAgent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiErr, setApiErr] = useState<string | null>(null);
  // subscribed 仍 client-only (后端 无 subscribe endpoint)
  const [subscribed, setSubscribed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    api
      .listAgents()
      .then((agents) => {
        if (cancelled) return;
        const display = agents.map(backendToDisplay);
        setDisplayList(display);
        // 默认 当前 ws 内 全部 algn 已订阅
        setSubscribed(new Set(display.map((d) => d.id)));
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setApiErr(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // v1.4.0 反幻觉 § 7.5 — API 失败 fallback to mock + 显 pill
  const sourceList: DisplayAgent[] = useMemo(() => {
    if (displayList) return displayList;
    if (loading) return [];
    // err fallback: 用 W_AGENTS mock 拼 DisplayAgent
    return W_AGENTS.map((m) => ({ ...m, mockMatched: true }));
  }, [displayList, loading]);

  const filtered = useMemo(() => {
    // filterAgents typed as WAgent[] — DisplayAgent extends WAgent, cast back
    let list = filterAgents(sourceList, cat) as DisplayAgent[];
    if (sortMode === "hot") list = [...list].sort((a, b) => b.sum - a.sum);
    if (sortMode === "new") {
      // updated 排序: 今天 / 昨天 优先, 然后 看 数字
      const score = (u: string) => {
        if (u === "今天") return 1000;
        if (u === "昨天") return 999;
        const dayMatch = u.match(/(\d+) 天前/);
        if (dayMatch) return 990 - Number(dayMatch[1]);
        const m = u.match(/(\d+)\/(\d+)/);
        if (m) return Number(m[1]) * 31 + Number(m[2]);
        return 0;
      };
      list = [...list].sort((a, b) => score(b.updated) - score(a.updated));
    }
    if (sortMode === "subscribed") list = list.filter((a) => subscribed.has(a.id));
    return list;
  }, [sourceList, cat, sortMode, subscribed]);

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
        sub="按角色发现 AI 专家 — 想看 AI 怎么思考问题, 点开任一卡片即可。订阅后会出现在「AI 专家管理」"
      />

      {/* v1.4.0 Sprint S5: API 失败 fallback 提示 */}
      {apiErr && (
        <div
          data-testid="browse-fallback-pill"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 12,
            fontSize: 11,
            fontWeight: 600,
            color: "#FF3B30",
            background: "rgba(255,59,48,0.10)",
            padding: "4px 10px",
            borderRadius: 6,
          }}
        >
          API 失败 · 演示数据 ({apiErr})
        </div>
      )}

      {/* v1.4.0 Sprint S5: 订阅 状态 mock 提示 */}
      <div
        data-testid="browse-subscribe-mock-pill"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 14,
          fontSize: 10.5,
          fontWeight: 600,
          color: "#FF9F0A",
          background: "rgba(255,159,10,0.12)",
          padding: "3px 9px",
          borderRadius: 5,
        }}
      >
        订阅 / 取消订阅 仅 本地 mock · 后端 subscribe endpoint 待 ship
      </div>

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
          marginLeft: 8,
        }}
      >
        {[
          { id: "all" as const, label: "全部", count: sourceList.length },
          { id: "hot" as const, label: "热度", count: sourceList.length },
          { id: "new" as const, label: "最新", count: sourceList.length },
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

      {loading && (
        <div
          data-testid="browse-loading"
          style={{
            padding: "60px 24px",
            textAlign: "center",
            color: W_TOKENS.textMuted,
            fontSize: 14,
          }}
        >
          加载中…
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div
          data-testid="browse-grid"
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
              onOpen={() => {
                // 跳 mock match 用 mock id (跟现有 /workstation/agent/<W_AGENT_ID> 路径 一致)
                // 不 match 用 backend UUID — 现有 page.tsx 会 notFound, V1.5 加 真 UUID 路由
                router.push(`/workstation/agent/${a.id}`);
              }}
              onToggleSub={() => toggleSub(a.id)}
            />
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div
          data-testid="browse-empty"
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
  a: DisplayAgent;
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
        {a.mockMatched ? (
          <WAIBadge id={a.id} size={36} />
        ) : (
          /* v1.4.0 Sprint S5: backend agent 没在 W_AGENTS 时 inline 渲 fallback avatar */
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: `linear-gradient(135deg, ${a.grad[0]} 0%, ${a.grad[1]} 100%)`,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 18,
              fontWeight: 700,
              flexShrink: 0,
              boxShadow: `0 4px 14px ${a.grad[1]}30, 0 0 0 0.5px rgba(255,255,255,0.10)`,
            }}
          >
            {a.glyph}
          </div>
        )}
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
