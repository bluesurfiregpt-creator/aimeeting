"use client";

/**
 * /workstation/topics — v1.4.0 Phase C · 10 NEW-B 议题主题 list.
 *
 * NORTH_STAR § 6.3 #10 痛点 5: 议题持续 跨多场会议. 让 客户 看到 议题脉络.
 *
 * UI:
 *  - 顶部: 标题 + 新建按钮 (leader/admin)
 *  - segmented: 全部 / 进行中 / 已归档
 *  - 卡片网格: 每卡显 议题名 / 关联 N 场会议 / 最近 update
 *  - 点卡片 跳 /workstation/topics/{id} 看 时间线
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type TopicOut } from "@/lib/api";
import { W_TOKENS } from "@/components/web/tokens";
import { WIcon } from "@/components/web/atoms";

type StatusFilter = "all" | "active" | "archived";

export default function TopicsListPage() {
  const [topics, setTopics] = useState<TopicOut[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
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

  const load = () => {
    setLoading(true);
    setError(null);
    const opts =
      filter === "all" ? undefined : ({ status: filter } as const);
    api
      .listTopics(opts)
      .then(setTopics)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      {/* Hero */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: 18,
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background:
              "linear-gradient(135deg, rgba(94,92,230,0.20) 0%, rgba(175,82,222,0.18) 100%)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <WIcon name="compass" size={22} color={W_TOKENS.textPrimary} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 700,
              color: W_TOKENS.textPrimary,
            }}
          >
            议题主题
          </h1>
          <div style={{ fontSize: 13, color: W_TOKENS.textMuted, marginTop: 2 }}>
            跨多场会议 持续的 讨论主线. 点 议题 看 时间线.
          </div>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            style={{
              height: 36,
              padding: "0 14px",
              borderRadius: 8,
              background: "linear-gradient(135deg, #5E5CE6 0%, #7A5AF0 100%)",
              color: "#fff",
              border: "none",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              boxShadow: "0 4px 12px rgba(94,92,230,0.30)",
            }}
          >
            <WIcon name="plus" size={14} color="#fff" />
            新建 议题
          </button>
        )}
      </div>

      {/* Segmented filter */}
      <div
        style={{
          display: "inline-flex",
          padding: 3,
          borderRadius: 8,
          background: W_TOKENS.surface,
          border: `0.5px solid ${W_TOKENS.border}`,
          marginBottom: 16,
          gap: 2,
        }}
      >
        {([
          ["all", "全部"],
          ["active", "进行中"],
          ["archived", "已归档"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            style={{
              padding: "5px 14px",
              borderRadius: 6,
              background:
                filter === k ? W_TOKENS.surfaceHover : "transparent",
              color: filter === k ? W_TOKENS.textPrimary : W_TOKENS.textMuted,
              border: "none",
              fontSize: 12,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
              transition: "all 140ms ease",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div
          style={{
            background: "rgba(255,59,48,0.12)",
            color: "#FF6B5C",
            padding: "10px 14px",
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          加载失败: {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: W_TOKENS.textMuted, padding: "40px 0" }}>
          加载中...
        </div>
      ) : topics.length === 0 ? (
        <EmptyState canWrite={canWrite} onCreate={() => setShowCreate(true)} />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 14,
          }}
        >
          {topics.map((t) => (
            <TopicCard key={t.id} topic={t} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateTopicModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function TopicCard({ topic }: { topic: TopicOut }) {
  return (
    <Link
      href={`/workstation/topics/${topic.id}`}
      style={{
        display: "block",
        padding: "14px 16px",
        borderRadius: 12,
        background: W_TOKENS.surface,
        border: `0.5px solid ${W_TOKENS.border}`,
        textDecoration: "none",
        transition: "all 140ms ease",
        cursor: "pointer",
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
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: W_TOKENS.textPrimary,
            flex: 1,
            lineHeight: 1.4,
          }}
        >
          {topic.name}
        </div>
        {topic.status === "archived" && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 6px",
              borderRadius: 4,
              background: "rgba(142,142,147,0.20)",
              color: W_TOKENS.textMuted,
              letterSpacing: 0.4,
              flexShrink: 0,
            }}
          >
            已归档
          </span>
        )}
      </div>
      {topic.description && (
        <div
          style={{
            fontSize: 12,
            color: W_TOKENS.textMuted,
            lineHeight: 1.5,
            marginBottom: 10,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {topic.description}
        </div>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 11,
          color: W_TOKENS.textMuted,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <WIcon name="history" size={11} color={W_TOKENS.textMuted} />
          {topic.meeting_count} 场会议
        </span>
      </div>
    </Link>
  );
}

function EmptyState({
  canWrite,
  onCreate,
}: {
  canWrite: boolean;
  onCreate: () => void;
}) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "60px 20px",
        color: W_TOKENS.textMuted,
        background: W_TOKENS.surface,
        borderRadius: 12,
        border: `0.5px dashed ${W_TOKENS.border}`,
      }}
    >
      <div style={{ fontSize: 32, opacity: 0.4, marginBottom: 10 }}>📎</div>
      <div style={{ fontSize: 14, marginBottom: 4 }}>暂无议题</div>
      <div style={{ fontSize: 12, marginBottom: 16 }}>
        创建议题, 把 多场会议 串成 主线 — 1 个月后 看 整脉络.
      </div>
      {canWrite && (
        <button
          type="button"
          onClick={onCreate}
          style={{
            height: 32,
            padding: "0 14px",
            borderRadius: 8,
            background: "linear-gradient(135deg, #5E5CE6 0%, #7A5AF0 100%)",
            color: "#fff",
            border: "none",
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          新建 议题
        </button>
      )}
    </div>
  );
}

function CreateTopicModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createTopic({
        name: name.trim(),
        description: description.trim() || null,
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="新建议题"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(480px, 100%)",
          background: W_TOKENS.surface,
          borderRadius: 12,
          padding: 20,
          boxShadow: "0 24px 60px rgba(0,0,0,0.40)",
          border: `0.5px solid ${W_TOKENS.border}`,
        }}
      >
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: W_TOKENS.textPrimary,
            marginBottom: 14,
          }}
        >
          新建 议题
        </div>
        <div style={{ marginBottom: 12 }}>
          <label
            style={{
              display: "block",
              fontSize: 12,
              color: W_TOKENS.textMuted,
              marginBottom: 6,
              fontWeight: 600,
            }}
          >
            议题名称 *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如: 电梯改造决策线"
            maxLength={120}
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: 8,
              border: `0.5px solid ${W_TOKENS.border}`,
              background: W_TOKENS.bg,
              color: W_TOKENS.textPrimary,
              fontSize: 14,
              fontFamily: "inherit",
              outline: "none",
            }}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label
            style={{
              display: "block",
              fontSize: 12,
              color: W_TOKENS.textMuted,
              marginBottom: 6,
              fontWeight: 600,
            }}
          >
            描述 (可选)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="议题 上下文 / 核心分歧点 / 长期目标 ..."
            rows={3}
            maxLength={2000}
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: 8,
              border: `0.5px solid ${W_TOKENS.border}`,
              background: W_TOKENS.bg,
              color: W_TOKENS.textPrimary,
              fontSize: 13,
              fontFamily: "inherit",
              resize: "vertical",
              outline: "none",
            }}
          />
        </div>
        {error && (
          <div
            style={{
              background: "rgba(255,59,48,0.12)",
              color: "#FF6B5C",
              padding: "8px 12px",
              borderRadius: 6,
              fontSize: 12,
              marginBottom: 10,
            }}
          >
            {error}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
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
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !name.trim()}
            style={{
              height: 32,
              padding: "0 14px",
              borderRadius: 8,
              background:
                submitting || !name.trim()
                  ? W_TOKENS.surfaceHover
                  : "linear-gradient(135deg, #5E5CE6 0%, #7A5AF0 100%)",
              color:
                submitting || !name.trim() ? W_TOKENS.textMuted : "#fff",
              border: "none",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: submitting || !name.trim() ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? "创建中..." : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}
