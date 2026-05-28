"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
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
 *  - 默认 tab = workspaces, 显示 真 workspace 列表 (post-Sprint-S4 真接)
 *  - 其他 tab 显示 placeholder
 *
 * **权限**: 设计上 system_owner 才能看 (env PLATFORM_ADMIN_EMAILS). API 返 403 时
 * 显 "你 不是 平台超管" placeholder, 不挂.
 *
 * v1.4.0 Sprint S4 真接 (PM 反馈 mock):
 *  - WS_WORKSPACES 8 行 hardcoded → api.superListWorkspaces() 真接
 *  - me 顶 banner email 从 W_USER → /api/auth/me 真接
 */

type WSItem = {
  id: string;
  name: string;
  slug: string;
  status: string;
  user_count: number;
  agent_count: number;
  meeting_count: number;
  last_active_at: string | null;
  created_at: string;
};

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const now = new Date();
    const diff = (now.getTime() - d.getTime()) / 1000 / 3600;  // 小时
    if (diff < 1) return "刚刚";
    if (diff < 24) return `${Math.floor(diff)} 小时前`;
    if (diff < 24 * 7) return `${Math.floor(diff / 24)} 天前`;
    return d.toLocaleDateString("zh-CN");
  } catch {
    return iso;
  }
}

type AdminTab = "workspaces" | "users" | "system" | "quota";

export function AdminPane() {
  const [tab, setTab] = useState<AdminTab>("workspaces");

  // v1.4.0 Sprint S4 真接
  const [workspaces, setWorkspaces] = useState<WSItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [meEmail, setMeEmail] = useState<string>(W_USER.email);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      api.superListWorkspaces(false),
      fetch("/api/auth/me", { credentials: "include" }).then((r) =>
        r.ok ? r.json() : null,
      ),
    ]).then(([wsR, meR]) => {
      if (cancelled) return;
      if (wsR.status === "fulfilled" && Array.isArray(wsR.value)) {
        setWorkspaces(
          wsR.value.map((w) => ({
            id: w.id,
            name: w.name,
            slug: w.slug,
            status: w.status,
            user_count: w.user_count,
            agent_count: w.agent_count,
            meeting_count: w.meeting_count,
            last_active_at: w.last_active_at,
            created_at: w.created_at,
          })),
        );
      } else if (wsR.status === "rejected") {
        // 403 = 不是 平台超管, 其他 = 真错误
        const reason = wsR.reason;
        if (reason instanceof ApiError && reason.status === 403) {
          setForbidden(true);
        } else {
          const msg = reason instanceof Error ? reason.message : String(reason);
          setError(msg);
        }
      }
      if (meR.status === "fulfilled" && meR.value?.email) {
        setMeEmail(meR.value.email);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
            你正在跨 workspace 视角 · 所有操作 audit 留痕 · email: {meEmail}
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
          {
            id: "workspaces" as const,
            label: "工作空间",
            count: workspaces?.length ?? null,
          },
          { id: "users" as const, label: "用户", count: null },
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

      {tab === "workspaces" && (
        <WorkspacesTable
          workspaces={workspaces}
          loading={loading}
          error={error}
          forbidden={forbidden}
        />
      )}
      {tab === "users" && <UsersPlaceholder />}
      {tab === "system" && <SystemPlaceholder />}
      {tab === "quota" && <QuotaPlaceholder />}
    </>
  );
}

function WorkspacesTable({
  workspaces,
  loading,
  error,
  forbidden,
}: {
  workspaces: WSItem[] | null;
  loading: boolean;
  error: string | null;
  forbidden: boolean;
}) {
  // 状态 1: 403 = 不是 平台超管, 显友好 placeholder
  if (forbidden) {
    return (
      <WCard padding={20}>
        <div
          style={{ textAlign: "center", padding: "40px 24px" }}
          data-testid="admin-forbidden"
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              margin: "0 auto 14px",
              background: "rgba(220,40,80,0.10)",
              boxShadow: "inset 0 0 0 0.5px rgba(220,40,80,0.30)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <WIcon name="bolt" size={22} color="#FCA5A5" stroke={1.6} />
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: W_TOKENS.textPrimary,
            }}
          >
            你不是 平台超管
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 12.5,
              color: W_TOKENS.textMuted,
              lineHeight: 1.6,
            }}
          >
            该入口仅 system_owner 可见。请 PM 把你的邮箱加入
            <code
              style={{
                fontFamily: "monospace",
                fontSize: 11.5,
                padding: "0 6px",
                margin: "0 4px",
                background: "rgba(255,255,255,0.06)",
                borderRadius: 4,
              }}
            >
              PLATFORM_ADMIN_EMAILS
            </code>
            白名单。
          </div>
        </div>
      </WCard>
    );
  }

  // 状态 2: loading skeleton
  if (loading) {
    return (
      <WCard padding={20}>
        <div
          style={{
            textAlign: "center",
            padding: "40px 24px",
            color: W_TOKENS.textMuted,
            fontSize: 13,
          }}
          data-testid="admin-loading"
        >
          加载工作空间列表…
        </div>
      </WCard>
    );
  }

  // 状态 3: 真错误 (5xx / network), 不是 403
  if (error) {
    return (
      <WCard padding={20}>
        <div
          style={{ textAlign: "center", padding: "40px 24px" }}
          data-testid="admin-error"
        >
          <div
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              color: "#FCA5A5",
            }}
          >
            加载失败
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 12.5,
              color: W_TOKENS.textMuted,
              fontFamily: "monospace",
            }}
          >
            {error}
          </div>
        </div>
      </WCard>
    );
  }

  // 状态 4: 真接成功, 空 list 也展示空态
  const rows = workspaces || [];
  if (rows.length === 0) {
    return (
      <WCard padding={20}>
        <div
          style={{
            textAlign: "center",
            padding: "40px 24px",
            color: W_TOKENS.textMuted,
            fontSize: 13,
          }}
          data-testid="admin-empty"
        >
          暂无 workspace
        </div>
      </WCard>
    );
  }

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
          <tbody data-testid="admin-workspaces-tbody">
            {rows.map((w, i) => (
              <tr
                key={w.id}
                style={{
                  borderBottom:
                    i === rows.length - 1
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
                  <WPill tone={w.status === "active" ? "success" : "neutral"}>
                    {w.status}
                  </WPill>
                </td>
                <td
                  style={{
                    ...tdStyle,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {w.user_count}
                </td>
                <td
                  style={{
                    ...tdStyle,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {w.agent_count}
                </td>
                <td
                  style={{
                    ...tdStyle,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {w.meeting_count}
                </td>
                <td
                  style={{
                    ...tdStyle,
                    fontSize: 12.5,
                    color: W_TOKENS.textMuted,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {fmtDateTime(w.last_active_at)}
                </td>
                <td
                  style={{
                    ...tdStyle,
                    fontSize: 12.5,
                    color: W_TOKENS.textMuted,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {fmtDateTime(w.created_at)}
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
