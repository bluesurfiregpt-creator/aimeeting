"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · 更多 sheet.
 *
 * 设计源 1:1: meeting-room.jsx:1271-1350 (MoreSheet).
 *
 * 7 项: 屏幕共享 / 邀请 / 纪要 / 字幕设置 / 转发微信 (绿底) / 反馈 / 设置.
 * 父级回调 onAction (item key) — 暂全部 toast "暂未接入" (本 Saga 仅 UI).
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
};

export default function MoreSheet({
  open,
  onClose,
  onAction,
}: Props): ReactElement | null {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="更多"
      maxHeight="76%"
      testid="mobile-more-sheet"
    >
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
