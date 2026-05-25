"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · 召 AI sheet (浅色 iOS).
 *
 * 设计源 1:1: meeting-room.jsx:1090-1147 (SummonSheet).
 *
 * 改造: dark `bg-ink-950` 圆角 24px → 浅色 `#F2F2F7` 圆角 14px + 顶部把手
 * 36×5px. agent 行用 MRAIAvatar 渐变方形头像. props 不变 (open / agents
 * / busy / onClose / onSubmit). 默认 onClick 是直接选 + submit (单选, 跟
 * bundle 一致 — 立即派出, 不用先选后确认).
 */

import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { AgentMini } from "@/lib/mobile/types";

import { MRAIAvatar } from "./shared/avatars";
import MRIcon from "./shared/Icon";
import { MR_COLORS, MR_FONT_FAMILY } from "./meeting-room/styles";

type Props = {
  open: boolean;
  agents: AgentMini[];
  busy?: boolean;
  onClose: () => void;
  onSubmit: (agentId: string, query: string) => void;
};

export default function SummonAgentSheet({
  open,
  agents,
  busy = false,
  onClose,
  onSubmit,
}: Props): ReactElement | null {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState<string>("");

  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setQuery("");
    }
  }, [open]);

  if (!open) return null;

  const selected = agents.find((a) => a.agent_id === selectedId);
  const canSubmit = !!selectedId && !busy;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        fontFamily: MR_FONT_FAMILY,
      }}
      data-testid="mobile-summon-sheet"
    >
      {/* 遮罩 */}
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        disabled={busy}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.32)",
          border: "none",
          cursor: busy ? "default" : "pointer",
          animation: "mr-fadeIn 180ms ease",
        }}
      />
      {/* sheet 主体 */}
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          background: MR_COLORS.bgGroupedPrimary,
          borderTopLeftRadius: 14,
          borderTopRightRadius: 14,
          zIndex: 81,
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
          animation: "mr-slideUp 240ms cubic-bezier(.22,.61,.36,1)",
          maxHeight: "84%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{ display: "flex", justifyContent: "center", paddingTop: 6 }}
        >
          <div
            style={{
              width: 36,
              height: 5,
              borderRadius: 3,
              background: MR_COLORS.separator,
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px 8px",
          }}
        >
          <div style={{ width: 50 }} />
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: MR_COLORS.textPrimary,
            }}
          >
            唤醒 AI 专家
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              background: "none",
              border: "none",
              color: MR_COLORS.systemBlue,
              fontSize: 16,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: busy ? "default" : "pointer",
            }}
          >
            完成
          </button>
        </div>

        <div
          style={{ padding: "4px 16px 0", overflow: "auto", minHeight: 0 }}
        >
          {agents.length === 0 ? (
            <div
              style={{
                background: MR_COLORS.bgWhite,
                borderRadius: 12,
                padding: "24px 16px",
                textAlign: "center",
                fontSize: 14,
                color: MR_COLORS.textTertiary,
                lineHeight: 1.5,
                border: `1px dashed ${MR_COLORS.separator}`,
              }}
            >
              这个会议室还没邀请 AI 专家.
              <br />
              请桌面端先添加.
            </div>
          ) : (
            <div
              style={{
                background: MR_COLORS.bgWhite,
                borderRadius: 12,
                padding: "4px 0",
              }}
            >
              {agents.map((a, i) => {
                const display = a.nickname?.trim() || a.name;
                const isSel = a.agent_id === selectedId;
                return (
                  <button
                    type="button"
                    key={a.agent_id}
                    onClick={() => setSelectedId(a.agent_id)}
                    disabled={busy}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 14px",
                      borderTop:
                        i === 0
                          ? "none"
                          : `0.5px solid ${MR_COLORS.hairline}`,
                      cursor: busy ? "default" : "pointer",
                      background: isSel
                        ? "rgba(0,122,255,0.08)"
                        : "transparent",
                      border: "none",
                      borderRadius: 0,
                      fontFamily: "inherit",
                      textAlign: "left",
                    }}
                  >
                    <MRAIAvatar agentColor={a.color} size={36} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 600,
                          color: MR_COLORS.textPrimary,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {display}
                      </div>
                      {a.domain ? (
                        <div
                          style={{
                            fontSize: 12,
                            color: MR_COLORS.textTertiary,
                            marginTop: 1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {a.domain}
                        </div>
                      ) : null}
                    </div>
                    {isSel ? (
                      <MRIcon
                        name="check"
                        size={18}
                        color={MR_COLORS.systemBlue}
                      />
                    ) : (
                      <MRIcon
                        name="chev"
                        size={16}
                        color={MR_COLORS.textQuaternary}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {agents.length > 0 ? (
            <div
              style={{
                marginTop: 12,
                background: MR_COLORS.bgWhite,
                borderRadius: 12,
                padding: 12,
              }}
            >
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={busy}
                rows={2}
                placeholder="(可选) 给 AI 一句话提示, 不写走默认"
                style={{
                  width: "100%",
                  border: "none",
                  outline: "none",
                  resize: "none",
                  fontFamily: "inherit",
                  fontSize: 14,
                  lineHeight: 1.45,
                  color: MR_COLORS.textPrimary,
                  background: "transparent",
                  minHeight: 50,
                }}
              />
            </div>
          ) : null}

          <div
            style={{
              marginTop: 14,
              fontSize: 12,
              color: MR_COLORS.textTertiary,
              padding: "0 4px",
              lineHeight: 1.5,
            }}
          >
            提示: 也可以直接说「@Aria, …」或「@主持人, 帮我问 Lex …」, 系统会自动识别并路由.
          </div>

          <div style={{ height: 12 }} />
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "10px 16px 0",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              flex: 1,
              height: 44,
              borderRadius: 12,
              border: "none",
              background: MR_COLORS.bgWhite,
              color: MR_COLORS.systemBlue,
              fontSize: 15,
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: busy ? "default" : "pointer",
            }}
          >
            取消
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => selectedId && onSubmit(selectedId, query.trim())}
            style={{
              flex: 2,
              height: 44,
              borderRadius: 12,
              border: "none",
              background: canSubmit
                ? "linear-gradient(135deg, #AF52DE 0%, #5E5CE6 100%)"
                : MR_COLORS.separatorLight,
              color: canSubmit ? "#fff" : MR_COLORS.textTertiary,
              fontSize: 15,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: canSubmit ? "pointer" : "not-allowed",
              boxShadow: canSubmit ? "0 2px 6px rgba(94,92,230,0.25)" : "none",
            }}
          >
            {busy
              ? "派发中…"
              : selected
                ? `召唤 ${selected.nickname?.trim() || selected.name}`
                : "选一位专家"}
          </button>
        </div>
      </div>
    </div>
  );
}
