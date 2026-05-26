"use client";

/**
 * R5.D Web 会议室 transcript 区底部 input bar.
 *
 *  - sparkle 按钮: 召唤 AI (placeholder onClick)
 *  - compass 按钮: 问主持人
 *  - 输入框: @ 触发 mention popup (列 Mira + 4 AI 专家)
 *  - mic-fill 按钮: 语音输入 (UI only)
 *  - 发送按钮
 *
 * 设计源: `meeting-room-web.jsx:1127-1209`.
 */

import { useRef, useState } from "react";
import { MR_HOST, MR_AGENTS_IN_MEETING, MR_AI_IDS } from "./data";
import { MRHostAvatar, MRAIAvatar, MRIcon } from "./atoms";

export type MRInputBarProps = {
  onSummon?: () => void;
  onAskHost?: () => void;
};

export function MRInputBar({ onSummon, onAskHost }: MRInputBarProps) {
  const [text, setText] = useState("");
  const [showMention, setShowMention] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const handleChange = (v: string) => {
    setText(v);
    setShowMention(/@\S*$/.test(v));
  };

  const pickMention = (name: string) => {
    setText((prev) => prev.replace(/@\S*$/, `@${name} `));
    setShowMention(false);
    ref.current?.focus();
  };

  const send = () => {
    if (!text) return;
    // UI mock — clear and pretend it's sent
    setText("");
  };

  return (
    <div
      style={{
        borderTop: "0.5px solid #E5E5EA",
        background: "#fff",
        padding: "12px 24px",
        position: "relative",
      }}
    >
      {showMention && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 4px)",
            left: 24,
            right: 24,
            maxWidth: 360,
            background: "#fff",
            borderRadius: 12,
            boxShadow:
              "0 8px 28px rgba(0,0,0,0.15), 0 0 0 0.5px rgba(60,60,67,0.12)",
            padding: 6,
            zIndex: 5,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#8E8E93",
              padding: "6px 10px",
              letterSpacing: 0.4,
            }}
          >
            @提及
          </div>
          <div
            onClick={() => pickMention("主持人")}
            style={mentionRow}
          >
            <MRHostAvatar size={24} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                {MR_HOST.name}{" "}
                <span style={{ color: "#8E8E93", fontWeight: 400 }}>主持人</span>
              </div>
              <div style={{ fontSize: 11, color: "#8E8E93" }}>
                拆解你的问题并路由
              </div>
            </div>
          </div>
          {MR_AI_IDS.map((k) => {
            const a = MR_AGENTS_IN_MEETING[k];
            if (!a) return null;
            return (
              <div
                key={k}
                onClick={() => pickMention(a.name)}
                style={mentionRow}
              >
                <MRAIAvatar id={k} size={24} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    {a.name}{" "}
                    <span style={{ color: "#8E8E93", fontWeight: 400 }}>
                      {a.roleShort}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "#F2F2F7",
          borderRadius: 12,
          padding: "8px 12px",
        }}
      >
        <button
          type="button"
          onClick={onSummon}
          title="召唤 AI 专家"
          style={iconBtn}
        >
          <MRIcon name="sparkle" size={16} color="#5E5CE6" />
        </button>
        <button
          type="button"
          onClick={onAskHost}
          title="问主持人"
          style={iconBtn}
        >
          <MRIcon name="compass" size={16} color="#FF9F0A" />
        </button>
        <input
          ref={ref}
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="输入消息发送到会议… 用 @ 提及主持人或 AI 专家"
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            background: "transparent",
            fontFamily: "inherit",
            fontSize: 14,
            color: "#1C1C1E",
          }}
        />
        <button type="button" style={iconBtn} title="语音输入">
          <MRIcon name="mic-fill" size={16} color="#1C1C1E" />
        </button>
        <button
          type="button"
          onClick={send}
          disabled={!text}
          style={{
            height: 32,
            padding: "0 14px",
            borderRadius: 8,
            background: text ? "#007AFF" : "#E5E5EA",
            color: text ? "#fff" : "#8E8E93",
            border: "none",
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: text ? "pointer" : "not-allowed",
          }}
        >
          发送
        </button>
      </div>
    </div>
  );
}

const iconBtn = {
  width: 32,
  height: 32,
  borderRadius: 8,
  background: "transparent",
  border: "none",
  cursor: "pointer",
  display: "inline-flex" as const,
  alignItems: "center" as const,
  justifyContent: "center" as const,
};

const mentionRow = {
  display: "flex" as const,
  alignItems: "center" as const,
  gap: 9,
  padding: "6px 10px",
  borderRadius: 8,
  cursor: "pointer" as const,
};
