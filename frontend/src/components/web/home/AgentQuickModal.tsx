"use client";

import { useRouter } from "next/navigation";
import { W_TOKENS } from "../tokens";
import { W_AGENTS } from "../data/agents";
import { WAIBadge, WButton, WModal, WPill } from "../atoms";

/**
 * 首页 AI 卡片点击 → 弹出快速预览 (不跳转).
 *
 * 设计稿原版有 BrainProfile mini-axes — 那是 R5.B AgentDetail 的范畴, R5.A 不做.
 * 这里只展示: header + intro + 2 个简单 stat (召唤次数 / 上次更新).
 *
 * 两个 CTA:
 *  - "查看完整脑图" → /workstation/agent/<id> (R5.B 实施, R5.A 是 placeholder)
 *  - "邀请到会议"  → /meeting
 */
export function AgentQuickModal({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  if (!id) return null;
  const agent = W_AGENTS.find((x) => x.id === id);
  if (!agent) return null;

  const goFull = () => {
    onClose();
    router.push(`/workstation/agent/${id}`);
  };
  const invite = () => {
    onClose();
    router.push("/meeting");
  };

  // R5.A stats — R5.B AgentDetail 时换成 profile 全量数据
  const stats = [
    { label: "召唤", value: agent.sum, color: "#C4B5FD" },
    { label: "更新", value: agent.updated, color: W_TOKENS.cyan },
  ];

  return (
    <WModal open={true} onClose={onClose} maxWidth={620}>
      {/* gradient header */}
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "22px 24px",
          background: `linear-gradient(135deg, ${agent.grad[0]}25 0%, ${agent.grad[1]}30 100%)`,
          borderRadius: "18px 18px 0 0",
          borderBottom: `0.5px solid ${W_TOKENS.border}`,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -50,
            right: -40,
            width: 200,
            height: 200,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${agent.grad[1]}40 0%, rgba(0,0,0,0) 65%)`,
            pointerEvents: "none",
          }}
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            width: 30,
            height: 30,
            borderRadius: 8,
            border: "none",
            background: "rgba(0,0,0,0.25)",
            color: "#fff",
            cursor: "pointer",
            fontFamily: "inherit",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
            lineHeight: 1,
          }}
        >
          ×
        </button>

        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 14 }}>
          <WAIBadge id={id} size={60} radius={15} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: 22,
                  fontWeight: 800,
                  color: W_TOKENS.textPrimary,
                  letterSpacing: -0.5,
                }}
              >
                {agent.name}
              </h2>
              {agent.nick && agent.nick !== agent.name && (
                <span style={{ fontSize: 13, color: W_TOKENS.textMuted }}>· {agent.nick}</span>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: W_TOKENS.textSecondary, marginTop: 4 }}>
              {agent.domain}
            </div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}>
              {agent.tags.map((t) => (
                <WPill key={t} tone="neutral">
                  {t}
                </WPill>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* body */}
      <div style={{ padding: "18px 24px" }}>
        <div
          style={{
            fontSize: 13.5,
            color: W_TOKENS.textPrimary,
            lineHeight: 1.6,
          }}
        >
          {agent.intro}
        </div>

        <div
          style={{
            marginTop: 16,
            display: "grid",
            gridTemplateColumns: `repeat(${stats.length}, 1fr)`,
            gap: 8,
          }}
        >
          {stats.map((s, i) => (
            <div
              key={i}
              style={{
                background: "rgba(0,0,0,0.20)",
                borderRadius: 9,
                padding: "10px 12px",
                boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.06)",
              }}
            >
              <div style={{ fontSize: 10.5, color: W_TOKENS.textMuted, letterSpacing: 0.3 }}>
                {s.label}
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 18,
                  fontWeight: 800,
                  color: s.color,
                  letterSpacing: -0.4,
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1,
                }}
              >
                {s.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          padding: "14px 24px 20px",
          borderTop: `0.5px solid ${W_TOKENS.border}`,
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <WButton variant="ghost" size="md" iconRight="arr-r" onClick={goFull}>
          查看完整脑图
        </WButton>
        <span style={{ flex: 1 }} />
        <WButton variant="primary" size="md" icon="sparkle" iconRight="arr-r" onClick={invite}>
          邀请到会议
        </WButton>
      </div>
    </WModal>
  );
}
