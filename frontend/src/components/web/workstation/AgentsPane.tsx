"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { W_TOKENS } from "../tokens";
import {
  WIcon,
  WPill,
  WAIBadge,
  WButton,
  WCard,
  WSparkle,
} from "../atoms";
import { W_AGENTS, type WAgent } from "../data/agents";
import { PaneHeader } from "./PaneHeader";
import { api, type V2ExpertItem } from "@/lib/api";

/**
 * AI 专家管理 pane — R5.C.
 *
 * 来自 round-6 设计稿 AgentsPane:
 *  - "+ 新建 Agent" CTA → 跳 /workstation/tpl
 *  - 紫渐变 AI 一键生成 hero box (sparkle 装饰)
 *  - grid (auto-fill, minmax(320px, 1fr)) - AgentManageRow 卡
 *  - 每卡: AIBadge + 名/领域 + "启用" 状态 + 标签 + 更新/召唤次数 + 编辑/查看
 *  - 点卡 → 跳 /workstation/agent/<id>
 *
 * Sprint 3 Web W2: 接 /api/v2/today/experts (Saga T4). 后端 empty ws 自动 fallback
 * AGENT_GLYPHS 10 个 demo, frontend 再加一层 mock fallback (16 个) 备保险.
 */

// backend V2ExpertItem → mock WAgent shape (Grid 渲染兼容)
function adaptV2Expert(e: V2ExpertItem): WAgent {
  return {
    id: e.name.toUpperCase(), // mock id 是 大写 (跟 W_AGENTS ID 一致); 真接 agent 可能 uuid, 但 WAIBadge 通过 W_AGENTS 查找, 兼容
    name: e.name,
    nick: e.role_short || "",
    domain: e.role_short || "",
    tags: [],
    grad: [e.gradient_from, e.gradient_to] as [string, string],
    glyph: e.glyph,
    sum: e.task_count, // 调用次数 → 用 task_count 近似 (backend 没 sum)
    updated: e.last_active_display || "—",
    byMe: false,
    intro: "",
  };
}

export function AgentsPane() {
  const router = useRouter();

  // Sprint 3 Web W2: 拉真 backend experts list, fallback mock W_AGENTS.
  const [agents, setAgents] = useState<WAgent[]>(W_AGENTS);
  const [usingFallback, setUsingFallback] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const out = await api.getTodayExperts();
        if (cancelled) return;
        if (!out.experts.length) {
          console.warn(
            "[AgentsPane] /api/v2/today/experts 返回空, 渲染 mock",
          );
          return;
        }
        setAgents(out.experts.map(adaptV2Expert));
        setUsingFallback(false);
      } catch (e) {
        console.warn(
          "[AgentsPane] /api/v2/today/experts 拉取失败, 渲染 mock:",
          e,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
        title="AI 专家管理"
        sub="编辑、上传知识、调整人格 — 每位 AI 都是你团队的一位成员"
        extra={demoBadge}
        action={
          <WButton
            variant="primary"
            size="md"
            icon="plus"
            onClick={() => router.push("/workstation/tpl")}
          >
            新建专家
          </WButton>
        }
      />

      {/* AI generate hero */}
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 14,
          marginBottom: 18,
          background:
            "linear-gradient(135deg, #1a1530 0%, #271a3f 60%, #3b2a55 100%)",
          boxShadow:
            "0 10px 28px rgba(124,92,250,0.22), inset 0 0 0 0.5px rgba(124,92,250,0.20)",
          padding: "18px 20px",
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <WSparkle x={32} y={12} size={11} opacity={0.85} />
        <WSparkle x={84} y={42} size={6} opacity={0.55} />
        <WSparkle x="80%" y={20} size={9} opacity={0.7} />
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: "rgba(255,255,255,0.10)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.18)",
            flexShrink: 0,
          }}
        >
          <WIcon name="sparkle" size={19} color="#fff" stroke={2} />
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
            智能配置
          </div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: "#fff",
              marginTop: 2,
              letterSpacing: -0.2,
            }}
          >
            AI 一键生成 团队角色
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: "rgba(255,255,255,0.65)",
              marginTop: 3,
              lineHeight: 1.5,
            }}
          >
            描述你想解决的问题 — AI 帮你一次生成 N 个角色 (人格 / 关键词 / 种子知识 /
            种子记忆),任何行业 / 部门都能用
          </div>
        </div>
        <WButton
          variant="primary"
          size="lg"
          iconRight="arr-r"
          onClick={() => router.push("/workstation/tpl")}
        >
          开始生成
        </WButton>
      </div>

      <div
        style={{
          marginBottom: 12,
          fontSize: 12,
          color: W_TOKENS.textMuted,
        }}
      >
        Workspace 已有 ({agents.length}) · 我管理 (
        {agents.filter((a) => a.byMe).length})
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 12,
        }}
      >
        {agents.map((a) => (
          <AgentManageRow
            key={a.id}
            a={a}
            onOpen={() => router.push(`/workstation/agent/${a.id}`)}
          />
        ))}
      </div>
    </>
  );
}

function AgentManageRow({ a, onOpen }: { a: WAgent; onOpen: () => void }) {
  return (
    <WCard hover padding={14} onClick={onOpen}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <WAIBadge id={a.id} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: W_TOKENS.textPrimary,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {a.name}
            </span>
            {a.byMe && (
              <WPill tone="accent" size="sm">
                我管理
              </WPill>
            )}
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: W_TOKENS.textMuted,
              marginTop: 2,
            }}
          >
            {a.domain}
          </div>
        </div>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11.5,
            color: W_TOKENS.success,
            fontWeight: 600,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: W_TOKENS.success,
              boxShadow: "0 0 6px rgba(34,197,94,0.60)",
            }}
          />
          启用
        </div>
      </div>
      <div
        style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}
      >
        {a.tags.map((t) => (
          <WPill key={t} tone="neutral">
            {t}
          </WPill>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: 10,
          borderTop: `0.5px solid ${W_TOKENS.border}`,
          fontSize: 11.5,
          color: W_TOKENS.textMuted,
        }}
      >
        <span>
          更新 {a.updated} · {a.sum} 次召唤
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <span
            style={{
              color: "#C4B5FD",
              fontSize: 12,
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            <WIcon name="gear" size={11} color="#C4B5FD" /> 编辑
          </span>
          <span
            style={{
              color: "#C4B5FD",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            查看 →
          </span>
        </div>
      </div>
    </WCard>
  );
}
