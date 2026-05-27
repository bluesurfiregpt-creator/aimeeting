"use client";

/**
 * v1.4.0 Phase A 后置 (NORTH_STAR § 6.1 + PM 拍板 2026-05-27) · MTypedInputBar
 *
 * Mobile 会议页 底部 sticky 输入栏:
 *  - 文字输入框 (替代 mic, 适用 不便说话 场景)
 *  - speaker dropdown (默认 me; leader/admin 可代任一 workspace user)
 *  - Enter 发送 → WS text_message → backend emit_manual → 真 transcript_persisted
 *    + 同 LLM judge / dissent / agenda 三路 proactive (跟 mic ASR 同一管道)
 *
 * 权限边界 (Q1 PM 拍 leader/admin 可代别人):
 *  - 当前 user 默认 = me, dropdown 列 me + (leader/admin 时) 全 workspace users
 *  - member: dropdown 只显 me (隐藏切换)
 *  - audit_log 在 backend emit_manual 自动 记 (speaker_status='manual')
 *
 * UX 规则 (Q3 PM 拍 不显代发提示):
 *  - timeline 看 起来 跟 真说话 一样, speaker_status='manual' 仅 在 后端 标记
 *  - 不区分 "X 代 Y 输入" 跟 "Y 真 说话" — 自然
 *
 * 视觉:
 *  - 浅色 iOS (MR_COLORS), 跟 StickyActionBar 配, 上下贴着
 *  - 单行 紧凑 — 输入框 占 主, dropdown 是 chip-style 小按钮
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { mApi } from "@/lib/mobile/api";
import { useMeetingWsSend } from "@/lib/mobile/meetingWsBus";
import { MR_COLORS } from "./meeting-room/styles";

const LEADER_ROLES = new Set([
  "workspace_creator",
  "leader",
  "admin",
  "owner",
]);

type WorkspaceUser = {
  id: string;
  name: string;
};

type Me = {
  user_id: string;
  name: string;
  role: string;
};

export type MTypedInputBarProps = {
  me: Me;
  /** 用户 取消焦点 / 发送 后 失焦, 让 sticky action bar 不被键盘 顶飞. */
  onBlur?: () => void;
  onError?: (msg: string) => void;
};

export default function MTypedInputBar({ me, onBlur, onError }: MTypedInputBarProps) {
  const { sendJson } = useMeetingWsSend();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [allUsers, setAllUsers] = useState<WorkspaceUser[]>([]);
  const [speakerId, setSpeakerId] = useState<string>(me.user_id);
  const [sheetOpen, setSheetOpen] = useState(false);

  const canBorrow = LEADER_ROLES.has(me.role);

  // 拉 workspace users 一次 (leader/admin 才用, member 用不到 也拉 一次 给 me 标识)
  useEffect(() => {
    let cancelled = false;
    mApi
      .listWorkspaceUsers()
      .then((rs) => {
        if (cancelled) return;
        setAllUsers(rs.map((r) => ({ id: r.id, name: r.name })));
      })
      .catch(() => {
        /* 静默 — speaker dropdown 没数据 不影响 self 发送 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // speaker 列表: member 只 me; leader/admin 全 users
  const speakerOptions = useMemo<WorkspaceUser[]>(() => {
    if (!canBorrow) {
      return [{ id: me.user_id, name: me.name }];
    }
    // me 永远 在第一个; 其他 users 按 name 字典序
    const others = allUsers
      .filter((u) => u.id !== me.user_id)
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    return [{ id: me.user_id, name: me.name }, ...others];
  }, [allUsers, canBorrow, me.user_id, me.name]);

  const currentSpeakerName = useMemo(() => {
    const s = speakerOptions.find((u) => u.id === speakerId);
    return s?.name || me.name;
  }, [speakerOptions, speakerId, me.name]);

  const handleSend = useCallback(() => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      sendJson({
        action: "text_message",
        text: t,
        speaker_user_id: speakerId || null,
      });
      setText("");
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "发送失败");
    } finally {
      // 立刻 UI unlock (WS 异步, 不等回执)
      setSending(false);
    }
  }, [text, sending, sendJson, speakerId, onError]);

  return (
    <div
      data-testid="m-typed-input-bar"
      style={{
        background: MR_COLORS.bgWhite,
        borderTop: `0.5px solid ${MR_COLORS.separatorLight}`,
        padding: "8px 12px",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      {/* speaker chip — 点击 弹 选择 sheet (canBorrow 才弹) */}
      <button
        type="button"
        onClick={() => canBorrow && setSheetOpen(true)}
        disabled={!canBorrow}
        data-testid="m-typed-speaker-chip"
        style={{
          flexShrink: 0,
          height: 30,
          padding: "0 10px",
          borderRadius: 15,
          border: `0.5px solid ${MR_COLORS.hairlineStrong}`,
          background: canBorrow ? MR_COLORS.bgInputFill : MR_COLORS.bgInputFill,
          color: MR_COLORS.textSecondary,
          fontSize: 12,
          fontWeight: 500,
          fontFamily: "inherit",
          cursor: canBorrow ? "pointer" : "default",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          maxWidth: 100,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ color: MR_COLORS.textTertiary }}>代</span>
        <span>{currentSpeakerName}</span>
        {canBorrow ? (
          <span style={{ color: MR_COLORS.textTertiary, fontSize: 10 }}>▾</span>
        ) : null}
      </button>

      {/* 输入框 */}
      <input
        data-testid="m-typed-input"
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !(e.nativeEvent as unknown as { isComposing?: boolean }).isComposing) {
            e.preventDefault();
            handleSend();
          }
        }}
        onBlur={onBlur}
        placeholder={
          canBorrow ? `${currentSpeakerName} 说……(也可代别人)` : "输入文字……"
        }
        style={{
          flex: 1,
          minWidth: 0,
          height: 36,
          padding: "0 12px",
          borderRadius: 18,
          border: `0.5px solid ${MR_COLORS.hairlineStrong}`,
          background: MR_COLORS.bgInputFill,
          fontSize: 14,
          fontFamily: "inherit",
          color: MR_COLORS.textPrimary,
          outline: "none",
        }}
      />

      {/* 发送按钮 */}
      <button
        type="button"
        onClick={handleSend}
        disabled={!text.trim() || sending}
        data-testid="m-typed-send"
        aria-label="发送"
        style={{
          flexShrink: 0,
          width: 36,
          height: 36,
          borderRadius: 18,
          border: "none",
          background: text.trim() ? "#007AFF" : MR_COLORS.bgInputFill,
          color: "#fff",
          cursor: text.trim() ? "pointer" : "default",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 16,
          fontFamily: "inherit",
        }}
      >
        ↑
      </button>

      {/* speaker 选择 sheet (canBorrow 才 弹) */}
      {sheetOpen ? (
        <SpeakerSheet
          options={speakerOptions}
          selectedId={speakerId}
          onSelect={(id) => {
            setSpeakerId(id);
            setSheetOpen(false);
          }}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </div>
  );
}

function SpeakerSheet({
  options,
  selectedId,
  onSelect,
  onClose,
}: {
  options: WorkspaceUser[];
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      data-testid="m-typed-speaker-sheet"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(0,0,0,0.30)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: MR_COLORS.bgWhite,
          borderRadius: "16px 16px 0 0",
          maxHeight: "60vh",
          overflowY: "auto",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "16px 20px 8px",
            borderBottom: `0.5px solid ${MR_COLORS.separatorLight}`,
          }}
        >
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: MR_COLORS.textPrimary,
            }}
          >
            选择 代发 身份
          </div>
          <div
            style={{
              marginTop: 4,
              fontSize: 12,
              color: MR_COLORS.textTertiary,
            }}
          >
            为某位参会人代发文字 (常用于 测试 / 不便说话 场景)
          </div>
        </div>
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {options.map((u) => {
            const isSelected = u.id === selectedId;
            return (
              <li
                key={u.id}
                onClick={() => onSelect(u.id)}
                style={{
                  padding: "12px 20px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  cursor: "pointer",
                  background: isSelected ? "rgba(0,122,255,0.06)" : "transparent",
                }}
              >
                <span
                  style={{
                    fontSize: 15,
                    color: MR_COLORS.textPrimary,
                    fontWeight: isSelected ? 600 : 400,
                  }}
                >
                  {u.name}
                </span>
                {isSelected ? (
                  <span style={{ color: "#007AFF", fontSize: 18, fontWeight: 700 }}>
                    ✓
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
