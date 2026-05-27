"use client";

/**
 * R5.D Web 会议室 transcript 区底部 input bar.
 *
 *  - sparkle 按钮: 召唤 AI (placeholder onClick)
 *  - compass 按钮: 问主持人
 *  - **speaker 选择 chip**: 默认 me, leader/admin 可代别人 (v1.4.0 Phase A 后置)
 *  - 输入框: @ 触发 mention popup (列 Mira + 4 AI 专家)
 *  - mic-fill 按钮: 语音输入 (上层 useWebMeetingStt hook 已 wire toggleMic)
 *  - 发送按钮 → 真 WS text_message (v1.4.0 Phase A 后置)
 *
 * 设计源: `meeting-room-web.jsx:1127-1209`.
 *
 * v1.4.0 Phase A 后置 (PM 拍 2026-05-27): 真接 backend text_message —
 *  - onSendText(text, speakerId) — 上层 调 sendJson({action:"text_message",...})
 *  - speakerOptions 来源 上层 listUsers + me 权限计算
 *  - canBorrow (leader/admin) 控制 是否能 选别人
 */

import { useRef, useState, useMemo } from "react";
import { MR_HOST, MR_AGENTS_IN_MEETING, MR_AI_IDS } from "./data";
import { MRHostAvatar, MRAIAvatar, MRIcon } from "./atoms";
import { MR_TOKENS } from "./tokens";

export type SpeakerOption = {
  id: string;
  name: string;
};

export type MRInputBarProps = {
  onSummon?: () => void;
  onAskHost?: () => void;
  /** v1.4.0 Phase A 后置: 真接 WS text_message. 上层 sendJson 调用 wraps 在 onSendText 里. */
  onSendText?: (text: string, speakerId: string | null) => void;
  /** 当前 用户 (默认 speaker). 缺省 = onSendText 走 null speaker_user_id (后端 [?]) */
  meSpeaker?: SpeakerOption | null;
  /** 可选 代发 列表 (含 me + 全 workspace users). leader/admin 显, member 隐. */
  speakerOptions?: SpeakerOption[];
  /** leader/admin = true. 控制 speaker chip 是否 disabled. */
  canBorrow?: boolean;
};

export function MRInputBar({
  onSummon,
  onAskHost,
  onSendText,
  meSpeaker,
  speakerOptions,
  canBorrow,
}: MRInputBarProps) {
  const [text, setText] = useState("");
  const [showMention, setShowMention] = useState(false);
  const [showSpeakerSheet, setShowSpeakerSheet] = useState(false);
  const [speakerId, setSpeakerId] = useState<string | null>(meSpeaker?.id || null);
  const ref = useRef<HTMLInputElement>(null);

  const currentSpeakerName = useMemo(() => {
    const opts = speakerOptions || (meSpeaker ? [meSpeaker] : []);
    const s = opts.find((u) => u.id === speakerId);
    return s?.name || meSpeaker?.name || "未指定";
  }, [speakerOptions, speakerId, meSpeaker]);

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
    if (!text.trim()) return;
    if (onSendText) {
      onSendText(text.trim(), speakerId);
    }
    // 无 onSendText (老 mock 行为) 也清空, 跟 Sprint 3 之前 一致.
    setText("");
  };

  return (
    <div
      style={{
        borderTop: MR_TOKENS.borderHair,
        background: MR_TOKENS.bgSurface,
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
            background: MR_TOKENS.bgSurface,
            borderRadius: 12,
            boxShadow: MR_TOKENS.shadowMenu,
            padding: 6,
            zIndex: 5,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: MR_TOKENS.fgTertiary,
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
                <span style={{ color: MR_TOKENS.fgTertiary, fontWeight: 400 }}>主持人</span>
              </div>
              <div style={{ fontSize: 11, color: MR_TOKENS.fgTertiary }}>
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
                    <span style={{ color: MR_TOKENS.fgTertiary, fontWeight: 400 }}>
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
          background: MR_TOKENS.bgChip,
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
        {/* v1.4.0 Phase A 后置: speaker chip — leader/admin 可点弹 sheet 选 代发. */}
        {meSpeaker ? (
          <button
            type="button"
            onClick={() => canBorrow && setShowSpeakerSheet(true)}
            disabled={!canBorrow}
            data-testid="mr-speaker-chip"
            title={
              canBorrow
                ? `当前 代发: ${currentSpeakerName} · 点击 切换`
                : `当前: ${currentSpeakerName} (无 代发 权限)`
            }
            style={{
              height: 28,
              padding: "0 10px",
              borderRadius: 14,
              background: canBorrow ? MR_TOKENS.bgSurface : MR_TOKENS.bgChip,
              border: "0.5px solid rgba(60,60,67,0.18)",
              color: MR_TOKENS.fgSecondary,
              fontSize: 12,
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: canBorrow ? "pointer" : "default",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              maxWidth: 130,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            <span style={{ color: MR_TOKENS.fgTertiary }}>代</span>
            <span>{currentSpeakerName}</span>
            {canBorrow ? (
              <span style={{ color: MR_TOKENS.fgTertiary, fontSize: 10 }}>▾</span>
            ) : null}
          </button>
        ) : null}
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
            color: MR_TOKENS.fgPrimary,
          }}
        />
        <button type="button" style={iconBtn} title="语音输入">
          <MRIcon name="mic-fill" size={16} color={MR_TOKENS.fgPrimary} />
        </button>
        <button
          type="button"
          onClick={send}
          disabled={!text}
          style={{
            height: 32,
            padding: "0 14px",
            borderRadius: 8,
            background: text ? "#007AFF" : MR_TOKENS.bgHoverChip,
            color: text ? "#fff" : MR_TOKENS.fgTertiary,
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

      {/* v1.4.0 Phase A 后置: speaker 选择 sheet (canBorrow 才 弹) */}
      {showSpeakerSheet && speakerOptions ? (
        <div
          data-testid="mr-speaker-sheet"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            background: "rgba(0,0,0,0.30)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => setShowSpeakerSheet(false)}
        >
          <div
            className="mr-scroll"
            style={{
              background: MR_TOKENS.bgSurface,
              borderRadius: 12,
              minWidth: 320,
              maxWidth: 420,
              maxHeight: "70vh",
              overflowY: "auto",
              boxShadow: MR_TOKENS.shadowModal,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: "16px 20px 8px",
                borderBottom: MR_TOKENS.borderHair,
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 600, color: MR_TOKENS.fgPrimary }}>
                选择 代发 身份
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: MR_TOKENS.fgTertiary }}>
                为某位参会人代发文字 — 常用于 不便说话 / AI 自动测试 场景
              </div>
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {speakerOptions.map((u) => {
                const isSelected = u.id === speakerId;
                return (
                  <li
                    key={u.id}
                    onClick={() => {
                      setSpeakerId(u.id);
                      setShowSpeakerSheet(false);
                    }}
                    style={{
                      padding: "12px 20px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      cursor: "pointer",
                      background: isSelected
                        ? "rgba(0,122,255,0.06)"
                        : "transparent",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 14,
                        color: MR_TOKENS.fgPrimary,
                        fontWeight: isSelected ? 600 : 400,
                      }}
                    >
                      {u.name}
                    </span>
                    {isSelected ? (
                      <span style={{ color: "#007AFF", fontWeight: 700 }}>
                        ✓
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}
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
