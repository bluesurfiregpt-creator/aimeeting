"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · round-2 · 更多 sheet (加 hand/cc toggle 区).
 *
 * 设计源 1:1: round-2 bundle
 *   `/tmp/claude-design-round2/aimeeting/project/meeting-room.jsx:1383-1505`
 *   (MoreSheet — 顶部新增 "会中快捷" 分区, 含 举手 / 实时字幕 两个 iOS-style toggle).
 *
 * round-2 把 dock 二行 → 一行后, 举手 / 字幕 从 dock 移到这里 (使用频率低 + 双手
 * 操作场景不多). dock 上 "更多" 按钮上挂的橙色小点提示用户 当前举手中.
 *
 * 7 项主菜单不变: 屏幕共享 / 邀请 / 纪要 / 字幕设置 / 转发微信 (绿底) / 反馈 / 设置.
 */

import type { ReactElement } from "react";

import MRIcon, { type MRIconName } from "./MRIcon";
import Sheet from "./Sheet";
import { MR_COLORS } from "./styles";

const MORE_ITEMS: {
  key: string;
  icon: MRIconName;
  label: string;
  sub: string;
  badge?: string;
  primary?: boolean;
}[] = [
  { key: "share", icon: "share", label: "屏幕共享", sub: "把当前屏幕分享给参会成员" },
  { key: "invite", icon: "invite", label: "邀请参会人", sub: "微信好友 / 链接 / 二维码" },
  {
    key: "note",
    icon: "note",
    label: "会议纪要",
    sub: "查看自动生成的实时纪要",
    badge: "AI",
  },
  { key: "cc", icon: "cc", label: "字幕设置", sub: "语言、字号、声纹标识" },
  {
    key: "wechat",
    icon: "wechat",
    label: "转发到微信",
    sub: "把当前片段发给同事",
    primary: true,
  },
  {
    key: "feedback",
    icon: "feedback",
    label: "问题反馈",
    sub: "主持人或专家答错了?",
  },
  { key: "gear", icon: "gear", label: "设置", sub: "通知、设备、隐私" },
];

type Props = {
  open: boolean;
  onClose: () => void;
  onAction: (key: string) => void;
  // round-2: dock 退役 hand/cc 后, toggles 在这里 — 父组件管状态.
  hand?: boolean;
  setHand?: (v: boolean) => void;
  cc?: boolean;
  setCC?: (v: boolean) => void;
};

export default function MoreSheet({
  open,
  onClose,
  onAction,
  hand = false,
  setHand,
  cc = true,
  setCC,
}: Props): ReactElement | null {
  const TOGGLES: {
    key: "hand" | "cc";
    icon: MRIconName;
    label: string;
    sub: string;
    on: boolean;
    onToggle: () => void;
    activeBg: string;
  }[] = [
    {
      key: "hand",
      icon: "hand",
      label: "举手",
      sub: hand ? "已举手 · 主持人看到了" : "提醒主持人轮到你发言",
      on: hand,
      onToggle: () => setHand?.(!hand),
      activeBg: MR_COLORS.systemOrange,
    },
    {
      key: "cc",
      icon: "cc",
      label: "实时字幕",
      sub: cc ? "已开 · 跟读不走神" : "已关闭",
      on: cc,
      onToggle: () => setCC?.(!cc),
      activeBg: MR_COLORS.systemBlue,
    },
  ];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="更多"
      maxHeight="78%"
      testid="mobile-more-sheet"
    >
      {/* round-2: 会中快捷 (hand + cc) */}
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: MR_COLORS.textTertiary,
          letterSpacing: 0.4,
          padding: "4px 4px 6px",
        }}
      >
        会中快捷
      </div>
      <div
        style={{
          background: MR_COLORS.bgWhite,
          borderRadius: 12,
          overflow: "hidden",
          marginBottom: 14,
        }}
      >
        {TOGGLES.map((t, i) => (
          <button
            type="button"
            key={t.key}
            onClick={t.onToggle}
            data-testid={`mobile-more-toggle-${t.key}`}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "11px 14px",
              borderTop:
                i === 0 ? "none" : `0.5px solid ${MR_COLORS.hairline}`,
              cursor: "pointer",
              background: "transparent",
              border: "none",
              fontFamily: "inherit",
              textAlign: "left",
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: t.on ? t.activeBg : MR_COLORS.bgGroupedPrimary,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <MRIcon
                name={t.icon}
                size={17}
                color={t.on ? "#fff" : MR_COLORS.textPrimary}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 500,
                  color: MR_COLORS.textPrimary,
                }}
              >
                {t.label}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: MR_COLORS.textTertiary,
                  marginTop: 1,
                }}
              >
                {t.sub}
              </div>
            </div>
            {/* iOS toggle */}
            <div
              style={{
                width: 42,
                height: 26,
                borderRadius: 13,
                flexShrink: 0,
                background: t.on ? t.activeBg : MR_COLORS.separatorLight,
                transition: "background 180ms ease",
                position: "relative",
              }}
              aria-hidden="true"
            >
              <div
                style={{
                  position: "absolute",
                  top: 2,
                  left: t.on ? 18 : 2,
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: "#fff",
                  boxShadow:
                    "0 1.5px 4px rgba(0,0,0,0.18), 0 0 0 0.5px rgba(0,0,0,0.04)",
                  transition: "left 180ms cubic-bezier(.32,.72,.35,1)",
                }}
              />
            </div>
          </button>
        ))}
      </div>

      {/* full menu */}
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: MR_COLORS.textTertiary,
          letterSpacing: 0.4,
          padding: "4px 4px 6px",
        }}
      >
        更多操作
      </div>
      <div
        style={{
          background: MR_COLORS.bgWhite,
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        {MORE_ITEMS.map((m, i) => (
          <button
            type="button"
            key={m.key}
            onClick={() => {
              onAction(m.key);
              onClose();
            }}
            data-testid={`mobile-more-item-${m.key}`}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              borderTop:
                i === 0 ? "none" : `0.5px solid ${MR_COLORS.hairline}`,
              cursor: "pointer",
              background: "transparent",
              border: "none",
              fontFamily: "inherit",
              textAlign: "left",
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: m.primary
                  ? MR_COLORS.wechatGreen
                  : MR_COLORS.bgGroupedPrimary,
                color: m.primary ? "#fff" : MR_COLORS.textPrimary,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <MRIcon
                name={m.icon}
                size={17}
                color={m.primary ? "#fff" : MR_COLORS.textPrimary}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 500,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: MR_COLORS.textPrimary,
                }}
              >
                {m.label}
                {m.badge ? (
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: 0.4,
                      color: "#fff",
                      background:
                        "linear-gradient(135deg, #AF52DE, #5E5CE6)",
                      padding: "1px 5px",
                      borderRadius: 4,
                    }}
                  >
                    {m.badge}
                  </span>
                ) : null}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: MR_COLORS.textTertiary,
                  marginTop: 1,
                }}
              >
                {m.sub}
              </div>
            </div>
            <MRIcon
              name="chev"
              size={16}
              color={MR_COLORS.textQuaternary}
            />
          </button>
        ))}
      </div>
    </Sheet>
  );
}
