"use client";

/**
 * v1.3.0 · Saga · mobile-app-r4-A · 顶部 header · 浅色化 + 34px 大标题.
 *
 * 设计源 1:1: /tmp/claude-design-round4/aimeeting/project/mobile-shared.jsx:511-554
 * (MATopBar)
 *
 * 改动 (vs v27.0):
 *   - title 26 → 34px, fontWeight 600 → 800, letterSpacing -1, lineHeight 1.05
 *   - 新增 subtitle (12.5px #8E8E93)
 *   - 铃铛 + 齿轮 改 stroke SVG (bell / gear)
 *   - 圆角 40×40 icon button + 红色 8×8 dot 角标 (有未读时)
 *   - 铃铛 callback: 新增 onBell prop, 不传时 fallback 到 <Link href="/m/notifications">
 *     (Saga B 会把所有 page 改成传 onBell 唤起 NotificationsSheet)
 *   - 齿轮: 现状跳 /m/me, 同样 fallback 到 <Link>
 *
 * 保留:
 *   - unread 拉取逻辑 (showActions + api.me)
 *   - children slot (放 SegmentControl)
 *   - safe-area-inset-top
 *
 * Saga A 内: 4 个主 tab page (今日/会议/任务/记忆) + /m/me + /m/notifications
 * 都不传 onBell/onGear → 自动 fallback 到 Link, 视觉浅色化, 行为不变.
 */

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";

import Icon from "@/components/mobile/shared/Icon";

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  children?: ReactNode; // 通常放 SegmentControl
  showActions?: boolean; // false 时不显右上角 icons (用于详情页)
  /** Saga B 接 NotificationsSheet 时传; 不传则跳 /m/notifications. */
  onBell?: () => void;
  /** Saga B 接 ProfileSheet 时传; 不传则跳 /m/me. */
  onGear?: () => void;
};

const ICON_BTN_STYLE: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: "50%",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  position: "relative",
  flexShrink: 0,
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: "#1C1C1E",
};

export default function PageHeader({
  title,
  subtitle,
  children,
  showActions = true,
  onBell,
  onGear,
}: PageHeaderProps) {
  const [unread, setUnread] = useState<number>(0);

  useEffect(() => {
    if (!showActions) return;
    let alive = true;
    api.me().then(
      (m) => {
        if (!alive) return;
        const c = m.task_counts;
        if (c) {
          const n =
            (c.kb_sedimentation_pending ?? 0) + (c.memory_draft_pending ?? 0);
          setUnread(n);
        }
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [showActions]);

  const hasNotif = unread > 0;

  const bellNode = (
    <>
      <Icon name="bell" size={20} color="#1C1C1E" strokeWidth={1.8} />
      {hasNotif ? (
        <span
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#FF3B30",
            boxShadow: "0 0 0 2px #F2F2F7",
          }}
        />
      ) : null}
    </>
  );

  const gearNode = (
    <Icon name="gear" size={20} color="#1C1C1E" strokeWidth={1.7} />
  );

  return (
    <header
      className="px-4"
      style={{
        paddingTop: "calc(env(safe-area-inset-top, 0) + 6px)",
        paddingBottom: 12,
        background: "#F2F2F7",
      }}
      data-testid="mobile-page-header"
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <h1
            style={{
              fontSize: 34,
              fontWeight: 800,
              color: "#1C1C1E",
              letterSpacing: -1,
              lineHeight: 1.05,
              margin: 0,
            }}
          >
            {title}
          </h1>
          {subtitle ? (
            <div
              style={{
                fontSize: 12.5,
                color: "#8E8E93",
                marginTop: 4,
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              {subtitle}
            </div>
          ) : null}
        </div>
        {showActions ? (
          <div className="flex items-center" style={{ gap: 4, marginTop: 4 }}>
            {onBell ? (
              <button
                type="button"
                onClick={onBell}
                style={ICON_BTN_STYLE}
                aria-label="通知"
              >
                {bellNode}
              </button>
            ) : (
              <Link
                href="/m/notifications"
                style={ICON_BTN_STYLE}
                aria-label="通知"
              >
                {bellNode}
              </Link>
            )}
            {onGear ? (
              <button
                type="button"
                onClick={onGear}
                style={ICON_BTN_STYLE}
                aria-label="我"
              >
                {gearNode}
              </button>
            ) : (
              <Link href="/m/me" style={ICON_BTN_STYLE} aria-label="我">
                {gearNode}
              </Link>
            )}
          </div>
        ) : null}
      </div>
      {children ? <div style={{ marginTop: 16 }}>{children}</div> : null}
    </header>
  );
}
