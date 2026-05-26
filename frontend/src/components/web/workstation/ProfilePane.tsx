"use client";

import { useState } from "react";
import { W_TOKENS } from "../tokens";
import {
  WPill,
  WAvatar,
  WButton,
  WCard,
} from "../atoms";
import { W_HUMANS, W_USER } from "../data/agents";
import { PaneHeader } from "./PaneHeader";

/**
 * 身份信息 pane — R5.C.
 *
 * 来自 round-6 设计稿 ProfilePane:
 *  - 左卡: 大圆头像 (initials) + 名 + email + 角色 pill
 *    rows: 工作空间 / 角色 / 所属部门
 *  - 右卡: 声纹库 (录入声纹 list + CTA 录入新声纹)
 *  - R5.C 加: 偏好设置 (notification / theme / language)
 *  - 角色显示用 v1.3.1 名: workspace_creator/leader/admin/agent_owner/member
 */

const ROLE_LABEL: Record<string, string> = {
  workspace_creator: "工作空间创建者",
  leader: "领导",
  admin: "管理员",
  agent_owner: "AI 负责人",
  member: "成员",
  system_owner: "平台超管",
};

export function ProfilePane() {
  const [notif, setNotif] = useState({
    meeting: true,
    task: true,
    approval: true,
    digest: false,
  });

  const roleLabel = ROLE_LABEL[W_USER.role] || W_USER.role;

  return (
    <>
      <PaneHeader
        title="身份信息"
        sub="你的工作空间、所在部门与领域 — AI 在会议中会基于这些上下文回答"
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
          gap: 14,
        }}
      >
        {/* identity card */}
        <WCard>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 13,
              marginBottom: 14,
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: "50%",
                background: W_TOKENS.accentGrad,
                color: "#fff",
                fontSize: 22,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 6px 16px rgba(124,92,250,0.30)",
                flexShrink: 0,
              }}
            >
              {W_USER.initials}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 700,
                  color: W_TOKENS.textPrimary,
                }}
              >
                {W_USER.name}
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: W_TOKENS.textMuted,
                  marginTop: 2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {W_USER.email}
              </div>
            </div>
            <WPill tone="accent">{roleLabel}</WPill>
          </div>
          <ProfileRow label="工作空间" value={W_USER.workspace} />
          <ProfileRow
            label="角色"
            value={`${roleLabel} (${W_USER.role})`}
            sub="v1.3.1 角色对齐 (workspace_creator/leader/admin/agent_owner/member)"
          />
          <ProfileRow
            label="所属部门"
            value="数据 · 报表 · KPI · 国家/省/市级政策研究"
            valueMulti
            last
          />
        </WCard>

        {/* 声纹库 */}
        <WCard>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: W_TOKENS.textPrimary,
              marginBottom: 12,
            }}
          >
            声纹库
          </div>
          <div
            style={{
              fontSize: 13,
              color: W_TOKENS.textSecondary,
              lineHeight: 1.6,
              marginBottom: 12,
            }}
          >
            录入声纹后,AI 在会议中能识别发言人。每个声纹 15 秒,上次更新 5 天前。
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 14,
            }}
          >
            {["ZK", "LM", "WJ", "CY", "SL", "HR"].map((id) => (
              <div
                key={id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "5px 10px 5px 5px",
                  borderRadius: 22,
                  background: "rgba(255,255,255,0.04)",
                  boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
                }}
              >
                <WAvatar id={id} size={20} />
                <span
                  style={{ fontSize: 12, color: W_TOKENS.textPrimary }}
                >
                  {W_HUMANS[id]?.name}
                </span>
              </div>
            ))}
          </div>
          <WButton variant="secondary" size="sm" icon="mic" full>
            录入新声纹
          </WButton>
        </WCard>

        {/* 通知偏好 */}
        <WCard>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: W_TOKENS.textPrimary,
              marginBottom: 12,
            }}
          >
            通知偏好
          </div>
          <ToggleRow
            label="新会议邀请"
            sub="收到邀请时邮件 + 站内"
            on={notif.meeting}
            onToggle={() => setNotif((p) => ({ ...p, meeting: !p.meeting }))}
          />
          <ToggleRow
            label="任务到期提醒"
            sub="截止前 1 天提醒"
            on={notif.task}
            onToggle={() => setNotif((p) => ({ ...p, task: !p.task }))}
          />
          <ToggleRow
            label="审批通知"
            sub="有待审批项时通知"
            on={notif.approval}
            onToggle={() => setNotif((p) => ({ ...p, approval: !p.approval }))}
          />
          <ToggleRow
            label="每周摘要"
            sub="每周一上午发送上周工作摘要"
            on={notif.digest}
            onToggle={() => setNotif((p) => ({ ...p, digest: !p.digest }))}
            last
          />
        </WCard>
      </div>
    </>
  );
}

function ProfileRow({
  label,
  value,
  sub,
  last,
  valueMulti,
}: {
  label: string;
  value: string;
  sub?: string;
  last?: boolean;
  valueMulti?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: valueMulti ? "flex-start" : "center",
        gap: 12,
        padding: "11px 0",
        borderBottom: last ? "none" : `0.5px solid ${W_TOKENS.border}`,
      }}
    >
      <span
        style={{
          flex: "0 0 88px",
          fontSize: 12.5,
          color: W_TOKENS.textMuted,
        }}
      >
        {label}
      </span>
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 13.5,
            color: W_TOKENS.textPrimary,
            lineHeight: 1.5,
          }}
        >
          {value}
        </div>
        {sub && (
          <div
            style={{
              fontSize: 11,
              color: W_TOKENS.textFaint,
              marginTop: 3,
              fontFamily: "monospace",
            }}
          >
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  sub,
  on,
  onToggle,
  last,
}: {
  label: string;
  sub: string;
  on: boolean;
  onToggle: () => void;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "11px 0",
        borderBottom: last ? "none" : `0.5px solid ${W_TOKENS.border}`,
      }}
    >
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 13.5,
            color: W_TOKENS.textPrimary,
            fontWeight: 500,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: W_TOKENS.textMuted,
            marginTop: 3,
            lineHeight: 1.5,
          }}
        >
          {sub}
        </div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={on}
        style={{
          width: 38,
          height: 22,
          borderRadius: 11,
          border: "none",
          padding: 2,
          cursor: "pointer",
          background: on ? W_TOKENS.accent : W_TOKENS.surfaceHover,
          boxShadow: on
            ? "0 0 0 0.5px rgba(124,92,250,0.40), 0 2px 6px rgba(124,92,250,0.25)"
            : `inset 0 0 0 0.5px ${W_TOKENS.border}`,
          transition: "background 140ms ease",
          position: "relative",
        }}
      >
        <span
          style={{
            display: "block",
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: "#fff",
            transform: on ? "translateX(16px)" : "translateX(0)",
            transition: "transform 160ms cubic-bezier(.4,0,.2,1)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.20)",
          }}
        />
      </button>
    </div>
  );
}
