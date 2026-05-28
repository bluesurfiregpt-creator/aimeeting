"use client";

/**
 * /workstation/topics/[id] — v1.4.0 Phase C · 10 NEW-B 议题 时间线.
 *
 * 客户感受 痛点 5: 1 个月会议后 看 议题 历史 一眼看清.
 *
 * UI:
 *  - 顶部: 议题名 + 描述 + status pill + 关联数 + 归档按钮 (leader/admin)
 *  - 时间线: 关联 meeting 列表, 按 started_at desc, 卡片 含 标题 / 时间 / 状态
 *  - 点 meeting 卡 跳 /workstation/meeting/{id}
 *
 * 留 二期: 编辑 议题 / 改名 / 改描述 / 跨议题 merge
 */

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type TopicDetailOut } from "@/lib/api";
import { W_TOKENS } from "@/components/web/tokens";
import { WIcon } from "@/components/web/atoms";

export default function TopicDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [topic, setTopic] = useState<TopicDetailOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [me, setMe] = useState<{ role: string } | null>(null);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMe({ role: d.role }))
      .catch(() => {});
  }, []);

  const canWrite =
    me?.role === "leader" ||
    me?.role === "admin" ||
    me?.role === "workspace_creator" ||
    me?.role === "system_owner";

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getTopic(id)
      .then(setTopic)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setLoading(false));
  }, [id]);

  const handleToggleStatus = async () => {
    if (!topic || archiving) return;
    setArchiving(true);
    const newStatus =
      topic.status === "active" ? "archived" : ("active" as const);
    try {
      await api.updateTopic(id, { status: newStatus });
      setTopic({ ...topic, status: newStatus });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setArchiving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ color: W_TOKENS.textMuted, padding: 40 }}>加载中...</div>
    );
  }

  if (!topic || error) {
    return (
      <div style={{ padding: 40 }}>
        <div
          style={{
            background: "rgba(255,59,48,0.12)",
            color: "#FF6B5C",
            padding: "12px 16px",
            borderRadius: 8,
            fontSize: 14,
            marginBottom: 12,
          }}
        >
          {error || "议题不存在"}
        </div>
        <button
          type="button"
          onClick={() => router.push("/workstation/topics")}
          style={{
            height: 32,
            padding: "0 14px",
            borderRadius: 8,
            background: W_TOKENS.surfaceHover,
            color: W_TOKENS.textPrimary,
            border: "none",
            fontSize: 13,
            fontWeight: 500,
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          ← 返回 列表
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 880, margin: "0 auto" }}>
      {/* Back */}
      <Link
        href="/workstation/topics"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          color: W_TOKENS.textMuted,
          fontSize: 12,
          textDecoration: "none",
          marginBottom: 14,
        }}
      >
        <WIcon name="back" size={12} color={W_TOKENS.textMuted} />
        返回 议题 列表
      </Link>

      {/* Header */}
      <div
        style={{
          background: W_TOKENS.surface,
          borderRadius: 14,
          border: `0.5px solid ${W_TOKENS.border}`,
          padding: "18px 22px",
          marginBottom: 18,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            marginBottom: 8,
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 700,
              color: W_TOKENS.textPrimary,
              flex: 1,
              lineHeight: 1.3,
            }}
          >
            {topic.name}
          </h1>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: 4,
              letterSpacing: 0.4,
              flexShrink: 0,
              background:
                topic.status === "active"
                  ? "rgba(52,199,89,0.15)"
                  : "rgba(142,142,147,0.20)",
              color: topic.status === "active" ? "#34C759" : W_TOKENS.textMuted,
            }}
          >
            {topic.status === "active" ? "进行中" : "已归档"}
          </span>
        </div>
        {topic.description && (
          <div
            style={{
              fontSize: 13,
              color: W_TOKENS.textSecondary,
              lineHeight: 1.6,
              marginBottom: 12,
              whiteSpace: "pre-wrap",
            }}
          >
            {topic.description}
          </div>
        )}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 12,
            color: W_TOKENS.textMuted,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <WIcon name="history" size={12} color={W_TOKENS.textMuted} />
            {topic.meeting_count} 场会议
          </span>
          <span>·</span>
          <span>更新于 {fmtDate(topic.updated_at)}</span>
          {canWrite && (
            <>
              <span style={{ marginLeft: "auto" }} />
              <button
                type="button"
                onClick={handleToggleStatus}
                disabled={archiving}
                style={{
                  height: 28,
                  padding: "0 10px",
                  borderRadius: 6,
                  background: W_TOKENS.surfaceHover,
                  color: W_TOKENS.textPrimary,
                  border: `0.5px solid ${W_TOKENS.border}`,
                  fontSize: 12,
                  fontWeight: 500,
                  fontFamily: "inherit",
                  cursor: archiving ? "not-allowed" : "pointer",
                }}
              >
                {archiving
                  ? "..."
                  : topic.status === "active"
                    ? "归档"
                    : "重新激活"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 时间线 */}
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: W_TOKENS.textPrimary,
            letterSpacing: 0.3,
            marginBottom: 12,
          }}
        >
          议题线 · 按时间倒序
        </div>
        {topic.meetings.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "40px 20px",
              color: W_TOKENS.textMuted,
              background: W_TOKENS.surface,
              borderRadius: 12,
              border: `0.5px dashed ${W_TOKENS.border}`,
              fontSize: 13,
            }}
          >
            该议题 暂无 关联会议. 在 会议详情页 链接 议题 即可.
          </div>
        ) : (
          <div style={{ position: "relative", paddingLeft: 20 }}>
            {/* 时间线 vertical 线 */}
            <div
              style={{
                position: "absolute",
                left: 5,
                top: 8,
                bottom: 8,
                width: 1,
                background: W_TOKENS.border,
              }}
            />
            {topic.meetings.map((m) => (
              <Link
                key={m.id}
                href={`/workstation/meeting/${m.id}`}
                style={{
                  display: "block",
                  position: "relative",
                  marginBottom: 12,
                  padding: "12px 14px",
                  background: W_TOKENS.surface,
                  borderRadius: 10,
                  border: `0.5px solid ${W_TOKENS.border}`,
                  textDecoration: "none",
                  transition: "all 140ms ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = W_TOKENS.surfaceHover;
                  e.currentTarget.style.borderColor = W_TOKENS.borderHover;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = W_TOKENS.surface;
                  e.currentTarget.style.borderColor = W_TOKENS.border;
                }}
              >
                {/* dot */}
                <span
                  style={{
                    position: "absolute",
                    left: -19,
                    top: 18,
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    background:
                      m.status === "finished" || m.status === "processed"
                        ? "#34C759"
                        : m.status === "ongoing"
                          ? "#5E5CE6"
                          : W_TOKENS.textMuted,
                    boxShadow: `0 0 0 2px ${W_TOKENS.bg}`,
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                    marginBottom: 4,
                  }}
                >
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: W_TOKENS.textPrimary,
                      flex: 1,
                      lineHeight: 1.3,
                    }}
                  >
                    {m.title}
                  </div>
                  <StatusPill status={m.status} />
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: W_TOKENS.textMuted,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {m.started_at ? (
                    <>
                      <WIcon name="clock" size={11} color={W_TOKENS.textMuted} />
                      {fmtDate(m.started_at)}
                    </>
                  ) : (
                    "未开始"
                  )}
                  <span>·</span>
                  <span>{m.mode}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    scheduled: {
      label: "待开始",
      bg: "rgba(142,142,147,0.20)",
      fg: W_TOKENS.textMuted,
    },
    ongoing: {
      label: "进行中",
      bg: "rgba(94,92,230,0.15)",
      fg: "#7A5AF0",
    },
    finished: {
      label: "已结束",
      bg: "rgba(52,199,89,0.15)",
      fg: "#34C759",
    },
    processed: {
      label: "已处理",
      bg: "rgba(52,199,89,0.20)",
      fg: "#2BB052",
    },
  };
  const s = map[status] || {
    label: status,
    bg: "rgba(142,142,147,0.20)",
    fg: W_TOKENS.textMuted,
  };
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: "2px 6px",
        borderRadius: 4,
        background: s.bg,
        color: s.fg,
        letterSpacing: 0.4,
        flexShrink: 0,
      }}
    >
      {s.label}
    </span>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const hours = Math.floor(diff / 3600_000);
  if (hours < 1) return "刚刚";
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return d.toLocaleDateString("zh-CN");
}
