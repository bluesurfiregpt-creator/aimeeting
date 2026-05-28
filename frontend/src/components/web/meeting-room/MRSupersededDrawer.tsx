"use client";

/**
 * R5.D Web 会议室 — Superseded 历史 chain drawer (NEW-A 完整版, Phase C · 11).
 *
 * 点 transcript 里 「已被覆盖」chip → 弹 drawer 显示 supersession 链.
 *  - 旧 message (本卡) 的 text + 时间
 *  - 覆盖关系: "→ 被 #B 覆盖" (新 message preview + 时间)
 *  - 链式 (A→B→C) 时 递归 显示 全 chain
 *  - leader / admin: "撤销 覆盖" 按钮 (call /restore endpoint)
 *  - member: 仅 view, 无 撤销
 *
 * 跟 简版 区别 (NORTH_STAR § 6.3 #11 vs #9):
 *  - 简版: 仅 灰化 + chip, 不能 看 详情 / 撤销
 *  - 完整版: chip 可点, drawer 看 全 chain + 撤销
 *
 * Idempotent — 撤销 失败 silent 上层 toast, 关 drawer.
 */

import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { api, type WebTranscriptStreamLine } from "@/lib/api";
import { MR_TOKENS } from "./tokens";

export type MRSupersededDrawerProps = {
  /** 当前 被 覆盖 的 message line */
  line: WebTranscriptStreamLine;
  /** 整 transcript lines list — 用来 找 链 上 其他 message */
  allLines: WebTranscriptStreamLine[];
  /** 会议 id (api 调用 用) */
  meetingId: string;
  /** 当前 用户 role — 决定 是否 显示 撤销按钮 */
  myRole?: string | null;
  /** 关 drawer */
  onClose: () => void;
  /** 撤销 成功 后 callback (上层 重新拉 transcript) */
  onRestored?: () => void;
};

export function MRSupersededDrawer({
  line,
  allLines,
  meetingId,
  myRole,
  onClose,
  onRestored,
}: MRSupersededDrawerProps): ReactElement {
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // walk 链: line 被 supersededBy 覆盖, supersededBy 又 可能 被 进一步 覆盖
  // 返 chain = [当前 line, supersededBy, supersededBy.supersededBy, ...]
  const chain: WebTranscriptStreamLine[] = [line];
  let cur: WebTranscriptStreamLine | undefined = line;
  while (
    cur?.superseded_by_message_id &&
    cur.kind === "agent"
  ) {
    const next = allLines.find(
      (l) => l.kind === "agent" && l.id === cur!.superseded_by_message_id,
    );
    if (!next) break;
    if (chain.some((c) => c.id === next.id)) break; // cycle 防御
    chain.push(next);
    cur = next;
  }

  const canRestore =
    myRole === "leader" ||
    myRole === "admin" ||
    myRole === "workspace_creator" ||
    myRole === "system_owner";

  const handleRestore = async () => {
    if (restoring) return;
    setRestoring(true);
    setError(null);
    try {
      await api.restoreSupersededMessage(meetingId, line.id);
      onRestored?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRestoring(false);
    }
  };

  // Esc 关
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="冲突立场 历史链"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        animation: "mrFadeIn 180ms ease-out",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(640px, 100%)",
          maxHeight: "85vh",
          background: MR_TOKENS.bgSurface,
          borderRadius: 16,
          boxShadow: MR_TOKENS.shadowModal,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 22px 14px",
            borderBottom: MR_TOKENS.borderHair,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "rgba(60,60,67,0.10)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke={MR_TOKENS.fgSecondary}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 12a9 9 0 1018 0 9 9 0 10-18 0" />
              <path d="M3 12h6m6 0h6" />
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: MR_TOKENS.fgPrimary,
                lineHeight: 1.3,
              }}
            >
              立场冲突 历史链
            </div>
            <div
              style={{
                fontSize: 12,
                color: MR_TOKENS.fgTertiary,
                marginTop: 2,
              }}
            >
              共 {chain.length} 个版本 · 系统 自动检测 后续 发言 推翻 前面 立场
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            style={{
              width: 32,
              height: 32,
              padding: 0,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              borderRadius: 6,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: MR_TOKENS.fgTertiary,
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {/* Chain */}
        <div
          className="mr-scroll"
          style={{
            padding: "16px 22px",
            overflowY: "auto",
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {chain.map((c, i) => {
            const isOriginal = i === 0;
            const isLatest = i === chain.length - 1;
            const name = c.agent_nickname?.trim() || c.agent_name || "AI";
            return (
              <div key={c.id}>
                {/* 链 箭头 */}
                {i > 0 && (
                  <div
                    style={{
                      textAlign: "center",
                      color: MR_TOKENS.fgQuaternary,
                      fontSize: 12,
                      margin: "4px 0 8px",
                    }}
                  >
                    ↓ 被 推翻
                  </div>
                )}
                <div
                  style={{
                    background: isOriginal
                      ? "rgba(60,60,67,0.05)"
                      : isLatest
                        ? "rgba(94,92,230,0.06)"
                        : MR_TOKENS.bgSubtle,
                    border: isLatest
                      ? "0.5px solid rgba(94,92,230,0.30)"
                      : MR_TOKENS.borderHair,
                    borderRadius: 10,
                    padding: "12px 14px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 6,
                      marginBottom: 6,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: 0.4,
                        textTransform: "uppercase",
                        color: isOriginal
                          ? MR_TOKENS.fgTertiary
                          : isLatest
                            ? "#5E5CE6"
                            : MR_TOKENS.fgSecondary,
                      }}
                    >
                      {isOriginal
                        ? "原始"
                        : isLatest
                          ? "当前 立场"
                          : `中间 版本 ${i}`}
                    </span>
                    <span style={{ color: MR_TOKENS.fgQuaternary, fontSize: 11 }}>
                      ·
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: MR_TOKENS.fgPrimary,
                      }}
                    >
                      {name}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: MR_TOKENS.fgQuaternary,
                        marginLeft: "auto",
                      }}
                    >
                      #{c.id}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      lineHeight: 1.55,
                      color: MR_TOKENS.fgPrimary,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      // 原始 + 中间 灰化, 当前 立场 清晰
                      opacity: isLatest ? 1 : 0.7,
                    }}
                  >
                    {c.text}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 22px 16px",
            borderTop: MR_TOKENS.borderHair,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div style={{ flex: 1, fontSize: 12, color: MR_TOKENS.fgTertiary }}>
            {canRestore
              ? "判断 LLM 误标? 可 撤销 该 覆盖 把 本立场 改 回 active."
              : "leader / admin 才 可 撤销 覆盖 标"}
            {error && (
              <span style={{ color: "#FF3B30", marginLeft: 8 }}>
                · 撤销 失败: {error}
              </span>
            )}
          </div>
          {canRestore && (
            <button
              type="button"
              onClick={handleRestore}
              disabled={restoring}
              style={{
                height: 32,
                padding: "0 14px",
                borderRadius: 8,
                background: restoring ? MR_TOKENS.bgChip : "#FF3B30",
                color: restoring ? MR_TOKENS.fgTertiary : "#fff",
                border: "none",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "inherit",
                cursor: restoring ? "not-allowed" : "pointer",
              }}
            >
              {restoring ? "撤销中..." : "撤销 覆盖"}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            style={{
              height: 32,
              padding: "0 14px",
              borderRadius: 8,
              background: MR_TOKENS.bgChip,
              color: MR_TOKENS.fgPrimary,
              border: "none",
              fontSize: 13,
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
