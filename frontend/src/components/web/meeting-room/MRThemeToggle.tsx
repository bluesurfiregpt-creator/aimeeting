"use client";

/**
 * R5.D 会议室 顶 nav 主题切换 — segmented control [浅色] [深色].
 *
 * **NORTH_STAR § 7.1.1 例外 · 会议室双 theme** (PM 2026-05-28 拍板):
 *  - 复用 W_THEME 机制 (useWebTheme + localStorage 'w-theme')
 *  - 仅 会议室顶 nav 显示, workstation 不需要 (workstation 始终 dark)
 *  - default 浅色 (在 MR_THEME_BOOTSTRAP 控制)
 *
 * **iOS segmented control 风格**:
 *  - 浅色 mode: 灰底 bgChip + 选中态 白 thumb + 阴影
 *  - 深色 mode: 紫 tint 底 + 选中态 紫 thumb + 紫 glow
 *  - 切换有 140ms ease 过渡 (跟 MR_TOKENS 其他 chip hover 一致)
 *
 * 设计源 (浅色): iOS UISegmentedControl
 * 设计源 (深色): S3TK_UXeBzGF0V_jQr4hLg meeting-room-web.html 顶 nav 切换
 */

import { MR_TOKENS } from "./tokens";
import { useWebTheme } from "../useWebTheme";

export function MRThemeToggle() {
  const [theme, setTheme] = useWebTheme();
  const isDark = theme === "dark";

  return (
    <div
      role="group"
      aria-label="主题切换"
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 30,
        padding: 2,
        borderRadius: 8,
        background: MR_TOKENS.bgChip,
        border: MR_TOKENS.borderHair2,
        gap: 2,
      }}
    >
      <ToggleBtn
        active={!isDark}
        label="浅"
        title="切换 浅色"
        onClick={() => setTheme("light")}
        icon={
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
          </svg>
        }
      />
      <ToggleBtn
        active={isDark}
        label="深"
        title="切换 深色"
        onClick={() => setTheme("dark")}
        icon={
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        }
      />
    </div>
  );
}

function ToggleBtn({
  active,
  label,
  title,
  onClick,
  icon,
}: {
  active: boolean;
  label: string;
  title: string;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      style={{
        height: 26,
        padding: "0 10px",
        borderRadius: 6,
        background: active ? MR_TOKENS.bgSurface : "transparent",
        color: active ? MR_TOKENS.fgPrimary : MR_TOKENS.fgTertiary,
        border: "none",
        fontSize: 12,
        fontWeight: 600,
        fontFamily: "inherit",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        boxShadow: active ? MR_TOKENS.shadowSubtle : "none",
        transition: "background 140ms ease, color 140ms ease",
      }}
    >
      {icon}
      {label}
    </button>
  );
}
