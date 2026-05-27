"use client";

import { useState } from "react";
import { W_TOKENS } from "../tokens";
import {
  WIcon,
  WPill,
  WButton,
  WCard,
} from "../atoms";
import { W_USER } from "../data/agents";
import { PaneHeader } from "./PaneHeader";

/**
 * 平台超管 pane — R5.C.
 *
 * 来自 round-6 设计稿 AdminPane:
 *  - 红警告 banner "平台超管模式 · 操作 audit 留痕"
 *  - tabs: 工作空间 / 用户 / 系统 / 配额
 *  - 默认 tab = workspaces, 显示 8 个 mock 租户 table
 *  - 其他 tab 显示 placeholder
 *
 * **权限**: 设计上 system_owner 才能看 (env PLATFORM_ADMIN_EMAILS). R5.C 不做权限拦截.
 */

type WS_ITEM = {
  name: string;
  slug: string;
  status: string;
  user: number;
  agent: number;
  meeting: number;
  last: string;
  created: string;
};

const WS_WORKSPACES: WS_ITEM[] = [
  { name: "小伙子 的工作空间", slug: "ws-2", status: "active", user: 1, agent: 1, meeting: 0, last: "—", created: "2026/5/22" },
  { name: "测试用户 的工作空间", slug: "ws", status: "active", user: 2, agent: 1, meeting: 3, last: "2026/5/18 15:02", created: "2026/5/15" },
  { name: "v26.6 测试经理 的工作空间", slug: "v26-6", status: "active", user: 1, agent: 1, meeting: 0, last: "—", created: "2026/5/14" },
  { name: "v26.6 Manager 的工作空间", slug: "v26-6-manager", status: "active", user: 1, agent: 1, meeting: 0, last: "—", created: "2026/5/14" },
  { name: "Kimi v26.5 ABAC 综合测试单位", slug: "kimi-v26-5-abac-2", status: "active", user: 4, agent: 3, meeting: 0, last: "2026/5/14 01:45", created: "2026/5/13" },
  { name: "Kimi 客户经理 的工作空间", slug: "kimi", status: "active", user: 1, agent: 1, meeting: 0, last: "—", created: "2026/5/13" },
  { name: "Test Manager 的工作空间", slug: "test-manager", status: "active", user: 1, agent: 1, meeting: 0, last: "—", created: "2026/5/13" },
  { name: "Bluesurfire 的工作空间", slug: "default", status: "active", user: 1, agent: 16, meeting: 24, last: "今天 14:08", created: "2026/4/01" },
];

type AdminTab = "workspaces" | "users" | "system" | "quota";

export function AdminPane() {
  const [tab, setTab] = useState<AdminTab>("workspaces");

  return (
    <>
      {/* warning banner */}
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 14,
          marginBottom: 22,
          background:
            "linear-gradient(135deg, #401a25 0%, #4a1f30 60%, #3a1525 100%)",
          boxShadow:
            "0 6px 22px rgba(220,40,80,0.18), inset 0 0 0 0.5px rgba(255,100,130,0.30)",
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          gap: 13,
        }}
      >
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
            平台超管模式 · Platform Admin
          </div>
          <div
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              color: "#fff",
              marginTop: 3,
              lineHeight: 1.5,
            }}
          >
            你正在跨 workspace 视角 · 所有操作 audit 留痕 · email: {W_USER.email}
          </div>
        </div>
        <WButton variant="ghost" size="sm" iconRight="arr-r">
          退回自己 workspace
        </WButton>
      </div>

      <PaneHeader
        eyebrow="v27 Platform Admin"
        title="平台超管"
        sub={`跨 workspace 管理 · 用户 · 模型配额 · 系统配置`}
      />

      {/* tabs */}
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
          { id: "workspaces" as const, label: "工作空间", count: WS_WORKSPACES.length },
          { id: "users" as const, label: "用户", count: 14 },
          { id: "system" as const, label: "系统配置", count: null },
          { id: "quota" as const, label: "模型配额", count: null },
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
            {t.count !== null && (
              <span
                style={{
                  fontSize: 11,
                  opacity: 0.7,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "workspaces" && <WorkspacesTable />}
      {tab === "users" && <UsersPlaceholder />}
      {tab === "system" && <SystemPlaceholder />}
      {tab === "quota" && <QuotaPlaceholder />}
    </>
  );
}

function WorkspacesTable() {
  return (
    <WCard padding={0}>
      <div className="w-scroll" style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr
              style={{
                borderBottom: `0.5px solid ${W_TOKENS.border}`,
                background: "rgba(255,255,255,0.02)",
              }}
            >
              <th style={thStyle}>名称 / SLUG</th>
              <th style={thStyle}>状态</th>
              <th style={{ ...thStyle, textAlign: "right" }}>USER</th>
              <th style={{ ...thStyle, textAlign: "right" }}>AGENT</th>
              <th style={{ ...thStyle, textAlign: "right" }}>MEETING</th>
              <th style={thStyle}>最后活跃</th>
              <th style={thStyle}>创建</th>
              <th style={{ ...thStyle, textAlign: "right" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {WS_WORKSPACES.map((w, i) => (
              <tr
                key={w.slug}
                style={{
                  borderBottom:
                    i === WS_WORKSPACES.length - 1
                      ? "none"
                      : `0.5px solid ${W_TOKENS.border}`,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.02)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <td style={tdStyle}>
                  <div
                    style={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: W_TOKENS.textPrimary,
                    }}
                  >
                    {w.name}
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: W_TOKENS.textMuted,
                      marginTop: 2,
                      fontFamily: "monospace",
                    }}
                  >
                    {w.slug}
                  </div>
                </td>
                <td style={tdStyle}>
                  <WPill tone="success">{w.status}</WPill>
                </td>
                <td
                  style={{
                    ...tdStyle,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {w.user}
                </td>
                <td
                  style={{
                    ...tdStyle,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {w.agent}
                </td>
                <td
                  style={{
                    ...tdStyle,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {w.meeting}
                </td>
                <td
                  style={{
                    ...tdStyle,
                    fontSize: 12.5,
                    color: W_TOKENS.textMuted,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {w.last}
                </td>
                <td
                  style={{
                    ...tdStyle,
                    fontSize: 12.5,
                    color: W_TOKENS.textMuted,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {w.created}
                </td>
                <td style={{ ...tdStyle, textAlign: "right" }}>
                  <WButton variant="ghost" size="sm" iconRight="arr-r">
                    进入
                  </WButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </WCard>
  );
}

function UsersPlaceholder() {
  return (
    <WCard padding={20}>
      <PlaceholderBody
        title="用户管理"
        sub="跨 workspace 的真人账号清单 — 邮箱、声纹、角色、加入时间"
        icon="users"
      />
    </WCard>
  );
}

function SystemPlaceholder() {
  return (
    <WCard padding={20}>
      <PlaceholderBody
        title="系统配置"
        sub="LLM provider 切换 / 默认模型 / Webhook / 邮件模板"
        icon="gear"
      />
    </WCard>
  );
}

function QuotaPlaceholder() {
  return (
    <WCard padding={20}>
      <PlaceholderBody
        title="模型配额 · 计费"
        sub="按 workspace 维度的 token / 会议时长 / API 调用配额"
        icon="target"
      />
    </WCard>
  );
}

function PlaceholderBody({
  title,
  sub,
  icon,
}: {
  title: string;
  sub: string;
  icon: "users" | "gear" | "target";
}) {
  return (
    <div style={{ textAlign: "center", padding: "40px 24px" }}>
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          margin: "0 auto 14px",
          background: "rgba(124,92,250,0.10)",
          boxShadow: "inset 0 0 0 0.5px rgba(124,92,250,0.30)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <WIcon name={icon} size={22} color="#C4B5FD" stroke={1.6} />
      </div>
      <div
        style={{ fontSize: 14, fontWeight: 700, color: W_TOKENS.textPrimary }}
      >
        {title}
      </div>
      <div
        style={{ marginTop: 6, fontSize: 12.5, color: W_TOKENS.textMuted }}
      >
        {sub}
      </div>
      <div
        style={{
          marginTop: 14,
          fontSize: 11,
          color: W_TOKENS.textFaint,
        }}
      >
        下一轮迭代 · 已在路线图中
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "12px 16px",
  fontSize: 11,
  fontWeight: 700,
  color: W_TOKENS.textMuted,
  letterSpacing: 0.5,
  textTransform: "uppercase",
};
const tdStyle: React.CSSProperties = {
  padding: "14px 16px",
  fontSize: 13.5,
  color: W_TOKENS.textPrimary,
};
