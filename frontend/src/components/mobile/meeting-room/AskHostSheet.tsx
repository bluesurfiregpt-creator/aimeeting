"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · 问主持人 Mira sheet.
 *
 * 设计源 1:1: meeting-room.jsx:1150-1269 (AskHostSheet).
 */

import { useState } from "react";
import type { ReactElement } from "react";

import { MRHostAvatar } from "../shared/avatars";
import MRIcon, { type MRIconName } from "../shared/Icon";
import Sheet from "./Sheet";
import { MR_COLORS } from "./styles";

const HOST_QUICK: { kind: string; label: string; icon: MRIconName }[] = [
  { kind: "agenda", label: "本议程还剩多久?", icon: "clock" },
  { kind: "agenda", label: "帮我延长当前议程 5 分钟", icon: "clock" },
  { kind: "route", label: "帮我转给法务专家 Lex", icon: "route" },
  { kind: "route", label: "帮我转给数据分析 Aria", icon: "route" },
  { kind: "park", label: "把刚才那段记入 parking lot", icon: "compass" },
  { kind: "note", label: "把这一段标记为关键决策", icon: "note" },
];

type Props = {
  open: boolean;
  onClose: () => void;
  /** 接 page.tsx 调 WS invoke_agent (传 moderator agent_id + query). 父级负责传 moderator. */
  onSendToHost: (query: string) => void;
};

export default function AskHostSheet({
  open,
  onClose,
  onSendToHost,
}: Props): ReactElement | null {
  const [text, setText] = useState("");
  const submit = (query: string) => {
    onSendToHost(query);
    setText("");
    onClose();
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        <span
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <MRHostAvatar size={20} />
          问主持人 Mira
        </span>
      }
      maxHeight="84%"
      testid="mobile-ask-host-sheet"
    >
      <div
        style={{
          background:
            "linear-gradient(135deg, rgba(255,179,64,0.10), rgba(255,159,10,0.14))",
          border: `0.5px solid ${MR_COLORS.hostBorder}`,
          borderRadius: 12,
          padding: "10px 12px",
          fontSize: 13,
          lineHeight: 1.5,
          color: MR_COLORS.textSecondary,
        }}
      >
        告诉我要管议程、维持讨论焦点, 还是把问题转给某位 AI 专家 — 我可以拆解后路由.
      </div>

      <div
        style={{
          marginTop: 14,
          fontSize: 11,
          fontWeight: 600,
          color: MR_COLORS.textTertiary,
          letterSpacing: 0.3,
        }}
      >
        常用请求
      </div>
      <div
        style={{
          marginTop: 8,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
        }}
      >
        {HOST_QUICK.map((q, i) => (
          <button
            type="button"
            key={i}
            onClick={() => submit(q.label)}
            style={{
              background: MR_COLORS.bgWhite,
              border: `0.5px solid ${MR_COLORS.hairline}`,
              borderRadius: 10,
              padding: "10px 11px",
              display: "flex",
              alignItems: "flex-start",
              gap: 7,
              textAlign: "left",
              cursor: "pointer",
              fontFamily: "inherit",
              color: MR_COLORS.textPrimary,
              fontSize: 13,
              lineHeight: 1.35,
            }}
          >
            <MRIcon name={q.icon} size={14} color={MR_COLORS.systemOrange} />
            <span>{q.label}</span>
          </button>
        ))}
      </div>

      <div
        style={{
          marginTop: 16,
          fontSize: 11,
          fontWeight: 600,
          color: MR_COLORS.textTertiary,
          letterSpacing: 0.3,
        }}
      >
        或直接输入
      </div>
      <div
        style={{
          marginTop: 8,
          background: MR_COLORS.bgWhite,
          borderRadius: 12,
          padding: 12,
          border: `0.5px solid ${MR_COLORS.hairline}`,
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="例如: 帮我问 Aria, B 组延迟在弱网下表现如何?"
          rows={3}
          style={{
            width: "100%",
            border: "none",
            outline: "none",
            resize: "none",
            fontFamily: "inherit",
            fontSize: 14,
            lineHeight: 1.45,
            color: MR_COLORS.textPrimary,
            minHeight: 60,
            background: "transparent",
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 4,
          }}
        >
          <button
            type="button"
            disabled
            title="按住说话 (尚未接入)"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              background: MR_COLORS.bgGroupedPrimary,
              border: "none",
              borderRadius: 14,
              padding: "5px 10px",
              fontSize: 12,
              fontWeight: 500,
              color: MR_COLORS.textPrimary,
              cursor: "default",
              fontFamily: "inherit",
              opacity: 0.6,
            }}
          >
            <MRIcon
              name="mic-fill"
              size={13}
              color={MR_COLORS.systemOrange}
            />
            按住说话
          </button>
          <button
            type="button"
            disabled={!text.trim()}
            onClick={() => submit(text.trim())}
            data-testid="mobile-ask-host-send"
            style={{
              background: text.trim()
                ? MR_COLORS.systemOrange
                : MR_COLORS.separatorLight,
              color: text.trim() ? "#fff" : MR_COLORS.textTertiary,
              border: "none",
              borderRadius: 14,
              height: 30,
              padding: "0 14px",
              fontSize: 13,
              fontWeight: 600,
              cursor: text.trim() ? "pointer" : "not-allowed",
              fontFamily: "inherit",
            }}
          >
            发送
          </button>
        </div>
      </div>
    </Sheet>
  );
}
