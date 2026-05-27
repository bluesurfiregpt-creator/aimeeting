"use client";

import { useId, type ReactElement } from "react";

/**
 * 4 件「心智模型」拟物图标 — Web W_TOKENS 暗紫 system.
 *
 * 设计稿: docs handoff bundle `Mental Model Icons.html` + `mental-icons.jsx`
 * (1:1 还原, 包括 gradient stops / polygon path / sparkle 位置).
 *
 * 4 个 icon:
 *  - WCrystalIcon  AI 专家 (紫水晶, 多刻面打磨, 内部 sparkle)
 *  - WBookshelfIcon 书架   (胡桃木 + 皮面/布面书脊, 一本斜倚)
 *  - WOrbIcon       经验   (琥珀玻璃球 + 同心环 + 金箔环)
 *  - WTableIcon     会议   (榆木圆桌 等距俯视 + 5 椅环绕 + 中央热点)
 *
 * 用 `useId()` 生成 SVG defs 局部 id, 避免多实例冲突.
 *
 * 默认 size=96, 通过 size prop 缩放. overflow=visible 让 halo 不被裁剪.
 */

export type WMentalIconProps = { size?: number };

// ────────────────────────────────────────────────────────────
// 1. CRYSTAL — AI 专家
// ────────────────────────────────────────────────────────────
export function WCrystalIcon({ size = 96 }: WMentalIconProps) {
  const rid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = `cr${rid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#A78BFA" />
          <stop offset="40%" stopColor="#7C5CFA" />
          <stop offset="100%" stopColor="#3D2A8A" />
        </linearGradient>
        <linearGradient id={`${id}-top`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F5F0FF" />
          <stop offset="100%" stopColor="#9B7BF0" />
        </linearGradient>
        <linearGradient id={`${id}-tr`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#C7B0FF" />
          <stop offset="100%" stopColor="#6943D8" />
        </linearGradient>
        <linearGradient id={`${id}-left`} x1="0" y1="0" x2="1" y2="0.6">
          <stop offset="0%" stopColor="#8E72E8" />
          <stop offset="100%" stopColor="#4A2DA0" />
        </linearGradient>
        <linearGradient id={`${id}-right`} x1="1" y1="0" x2="0" y2="0.6">
          <stop offset="0%" stopColor="#6D4FE0" />
          <stop offset="100%" stopColor="#2E1B6F" />
        </linearGradient>
        <linearGradient id={`${id}-bot`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5639C0" />
          <stop offset="100%" stopColor="#1E1248" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="0.5" cy="0.55" r="0.55">
          <stop offset="40%" stopColor="rgba(124,92,250,0.55)" />
          <stop offset="100%" stopColor="rgba(124,92,250,0)" />
        </radialGradient>
      </defs>

      {/* outer halo */}
      <ellipse cx="50" cy="55" rx="42" ry="42" fill={`url(#${id}-glow)`} />
      {/* ground shadow */}
      <ellipse cx="50" cy="90" rx="22" ry="3.5" fill="rgba(0,0,0,0.55)" />

      {/* main crystal body — diamond with girdle */}
      <polygon points="22,42 50,12 50,85" fill={`url(#${id}-left)`} />
      <polygon points="78,42 50,12 50,85" fill={`url(#${id}-right)`} />
      <polygon points="22,42 50,12 35,28" fill={`url(#${id}-top)`} opacity="0.95" />
      <polygon points="78,42 50,12 65,28" fill={`url(#${id}-tr)`} opacity="0.85" />
      <polygon points="50,12 35,28 50,42 65,28" fill={`url(#${id}-body)`} opacity="0.9" />
      <polygon points="22,42 35,55 50,85" fill={`url(#${id}-bot)`} opacity="0.55" />
      <polygon points="78,42 65,55 50,85" fill={`url(#${id}-bot)`} opacity="0.75" />
      <polygon points="35,55 65,55 50,85" fill={`url(#${id}-body)`} opacity="0.8" />

      {/* girdle highlight lines */}
      <polyline
        points="22,42 35,28 50,42 65,28 78,42"
        fill="none"
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="0.6"
      />
      <polyline
        points="22,42 35,55 50,42 65,55 78,42"
        fill="none"
        stroke="rgba(255,255,255,0.25)"
        strokeWidth="0.5"
      />
      <line x1="50" y1="42" x2="50" y2="85" stroke="rgba(255,255,255,0.18)" strokeWidth="0.5" />
      <line x1="35" y1="55" x2="50" y2="85" stroke="rgba(0,0,0,0.30)" strokeWidth="0.5" />
      <line x1="65" y1="55" x2="50" y2="85" stroke="rgba(0,0,0,0.20)" strokeWidth="0.5" />

      {/* specular highlight */}
      <polygon points="50,14 38,28 45,30" fill="rgba(255,255,255,0.85)" />
      <ellipse
        cx="40"
        cy="33"
        rx="3"
        ry="1.4"
        fill="rgba(255,255,255,0.55)"
        transform="rotate(-30 40 33)"
      />

      {/* inner sparkles */}
      <circle cx="55" cy="58" r="1.2" fill="rgba(255,255,255,0.9)" />
      <circle cx="44" cy="68" r="0.8" fill="rgba(255,255,255,0.6)" />
    </svg>
  );
}

// ────────────────────────────────────────────────────────────
// 2. BOOKSHELF — 书架
// ────────────────────────────────────────────────────────────
export function WBookshelfIcon({ size = 96 }: WMentalIconProps) {
  const rid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = `bk${rid}`;
  // 8 books, top row — leather + cloth bindings.
  const topBooks = [
    { x: 22, w: 8, h: 30, top: 32, c1: "#C53932", c2: "#7C1F1A", cap: "#E8C547" },
    { x: 30, w: 6, h: 28, top: 34, c1: "#2A5DAF", c2: "#143B7A", cap: "#C9A85B" },
    { x: 36, w: 7, h: 32, top: 30, c1: "#3F8C5C", c2: "#1E4A30", cap: "#E8C547" },
    { x: 43, w: 9, h: 26, top: 36, c1: "#4F3825", c2: "#2A1D11", cap: "#D9A642" },
    { x: 52, w: 6, h: 31, top: 31, c1: "#7B4FA3", c2: "#3F2456", cap: "#C9A85B" },
    { x: 58, w: 8, h: 29, top: 33, c1: "#C77A2E", c2: "#7A3F12", cap: "#E8C547" },
    { x: 66, w: 7, h: 32, top: 30, c1: "#1F4D5C", c2: "#0E2B36", cap: "#C9A85B" },
    { x: 73, w: 6, h: 27, top: 35, c1: "#A82E5C", c2: "#5C1232", cap: "#D9A642" },
  ];
  const bottomBooks = [
    { x: 20, w: 7, h: 18, c1: "#2E5F8A", c2: "#143B58" },
    { x: 27, w: 6, h: 17, c1: "#8C3A2E", c2: "#4A1A12" },
    { x: 33, w: 8, h: 19, c1: "#3A6E48", c2: "#1A3D24" },
    { x: 41, w: 6, h: 16, c1: "#6B3F8C", c2: "#3A1F58" },
    { x: 47, w: 7, h: 18, c1: "#A06A2E", c2: "#5A3818" },
  ];

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={`${id}-wood`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6B4528" />
          <stop offset="50%" stopColor="#4A2D17" />
          <stop offset="100%" stopColor="#2E1A0B" />
        </linearGradient>
        <linearGradient id={`${id}-woodTop`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8B5A30" />
          <stop offset="100%" stopColor="#5A3318" />
        </linearGradient>
        <linearGradient id={`${id}-shelf`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4A2D17" />
          <stop offset="100%" stopColor="#2E1A0B" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="0.5" cy="0.55" r="0.55">
          <stop offset="40%" stopColor="rgba(10,132,255,0.30)" />
          <stop offset="100%" stopColor="rgba(10,132,255,0)" />
        </radialGradient>
        {topBooks.map((b, i) => (
          <linearGradient
            key={`g${i}`}
            id={`${id}-book${i}`}
            x1="0"
            y1="0"
            x2="1"
            y2="0"
          >
            <stop offset="0%" stopColor={b.c2} />
            <stop offset="35%" stopColor={b.c1} />
            <stop offset="100%" stopColor={b.c2} />
          </linearGradient>
        ))}
      </defs>

      {/* outer halo */}
      <ellipse cx="50" cy="55" rx="42" ry="42" fill={`url(#${id}-glow)`} />
      {/* ground shadow */}
      <ellipse cx="50" cy="88" rx="32" ry="3.5" fill="rgba(0,0,0,0.55)" />

      {/* shelf back panel */}
      <rect x="16" y="20" width="68" height="65" rx="2" fill={`url(#${id}-wood)`} />
      {/* top cap with depth */}
      <polygon points="14,20 86,20 88,18 12,18" fill={`url(#${id}-woodTop)`} />
      <rect x="12" y="16" width="76" height="3" fill="#3A2210" />
      {/* sides */}
      <polygon points="14,20 16,20 16,85 14,87" fill="#1F1108" />
      <polygon points="84,20 86,20 86,87 84,85" fill="#5A3318" opacity="0.5" />
      {/* middle shelf divider */}
      <rect x="16" y="63" width="68" height="2.5" fill={`url(#${id}-shelf)`} />
      <line x1="16" y1="63" x2="84" y2="63" stroke="rgba(0,0,0,0.5)" strokeWidth="0.5" />
      {/* inner shadows */}
      <rect x="16" y="20" width="68" height="2" fill="rgba(0,0,0,0.45)" />
      <rect x="16" y="64.5" width="68" height="1.5" fill="rgba(0,0,0,0.40)" />

      {/* TOP ROW BOOKS */}
      {topBooks.map((b, i) => (
        <g key={`t${i}`}>
          <rect
            x={b.x}
            y={b.top}
            width={b.w}
            height={b.h}
            rx="0.5"
            fill={`url(#${id}-book${i})`}
          />
          <rect
            x={b.x + 0.5}
            y={b.top}
            width={b.w - 1}
            height="1.2"
            fill="rgba(255,255,255,0.18)"
          />
          <rect
            x={b.x + 0.8}
            y={b.top + b.h * 0.35}
            width={b.w - 1.6}
            height="1.5"
            fill={b.cap}
            opacity="0.85"
          />
          <rect
            x={b.x + 0.8}
            y={b.top + b.h * 0.55}
            width={b.w - 1.6}
            height="0.7"
            fill={b.cap}
            opacity="0.55"
          />
          <rect
            x={b.x + 0.5}
            y={b.top + 1.5}
            width="0.6"
            height={b.h - 3}
            fill="rgba(255,255,255,0.25)"
          />
          <rect
            x={b.x + b.w - 1.1}
            y={b.top + 1.5}
            width="0.6"
            height={b.h - 3}
            fill="rgba(0,0,0,0.35)"
          />
        </g>
      ))}

      {/* BOTTOM ROW BOOKS */}
      <g>
        {bottomBooks.map((b, i) => (
          <g key={`b${i}`}>
            <rect x={b.x} y={80 - b.h} width={b.w} height={b.h} rx="0.4" fill={b.c1} />
            <rect
              x={b.x}
              y={80 - b.h}
              width="0.5"
              height={b.h}
              fill="rgba(255,255,255,0.22)"
            />
            <rect
              x={b.x + b.w - 0.6}
              y={80 - b.h}
              width="0.6"
              height={b.h}
              fill="rgba(0,0,0,0.35)"
            />
            <rect
              x={b.x + 0.7}
              y={80 - b.h * 0.62}
              width={b.w - 1.4}
              height="1.2"
              fill="#E8C547"
              opacity="0.75"
            />
          </g>
        ))}
        {/* leaning book */}
        <g transform="rotate(14 60 80)">
          <rect x="56" y="62" width="7" height="18" rx="0.4" fill="#7B4FA3" />
          <rect x="56" y="62" width="0.5" height="18" fill="rgba(255,255,255,0.22)" />
          <rect x="62.4" y="62" width="0.6" height="18" fill="rgba(0,0,0,0.30)" />
          <rect x="56.7" y="69" width="5.6" height="1.2" fill="#C9A85B" opacity="0.85" />
        </g>
        {/* stack lying down */}
        <rect x="65" y="74" width="14" height="3" rx="0.4" fill="#3F8C5C" />
        <rect x="65" y="74" width="14" height="0.6" fill="rgba(255,255,255,0.30)" />
        <rect x="65" y="77.5" width="14" height="2.5" rx="0.4" fill="#C77A2E" />
        <rect x="65" y="77.5" width="14" height="0.5" fill="rgba(255,255,255,0.25)" />
      </g>

      {/* bottom plank */}
      <rect x="14" y="80" width="72" height="5" rx="1" fill={`url(#${id}-shelf)`} />
      <rect x="14" y="80" width="72" height="0.8" fill="rgba(255,255,255,0.10)" />
    </svg>
  );
}

// ────────────────────────────────────────────────────────────
// 3. WISDOM ORB — 经验
// ────────────────────────────────────────────────────────────
export function WOrbIcon({ size = 96 }: WMentalIconProps) {
  const rid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = `or${rid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ overflow: "visible" }}>
      <defs>
        <radialGradient id={`${id}-sphere`} cx="0.35" cy="0.30" r="0.85">
          <stop offset="0%" stopColor="#FFE9B0" />
          <stop offset="20%" stopColor="#FFB36E" />
          <stop offset="55%" stopColor="#D9508A" />
          <stop offset="100%" stopColor="#3A0E40" />
        </radialGradient>
        <radialGradient id={`${id}-core`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="rgba(255,240,180,0.95)" />
          <stop offset="40%" stopColor="rgba(255,160,90,0.55)" />
          <stop offset="100%" stopColor="rgba(255,90,140,0)" />
        </radialGradient>
        <radialGradient id={`${id}-halo`} cx="0.5" cy="0.55" r="0.55">
          <stop offset="40%" stopColor="rgba(255,140,90,0.55)" />
          <stop offset="100%" stopColor="rgba(255,90,130,0)" />
        </radialGradient>
        <linearGradient id={`${id}-ring`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(255,200,120,0)" />
          <stop offset="50%" stopColor="rgba(255,220,150,0.95)" />
          <stop offset="100%" stopColor="rgba(255,200,120,0)" />
        </linearGradient>
      </defs>

      {/* outer halo */}
      <ellipse cx="50" cy="50" rx="44" ry="44" fill={`url(#${id}-halo)`} />
      {/* ground shadow */}
      <ellipse cx="50" cy="88" rx="24" ry="3" fill="rgba(0,0,0,0.55)" />

      {/* back ring */}
      <ellipse
        cx="50"
        cy="50"
        rx="38"
        ry="9"
        fill="none"
        stroke={`url(#${id}-ring)`}
        strokeWidth="1.4"
        opacity="0.45"
        transform="rotate(-18 50 50)"
      />

      {/* main sphere */}
      <circle cx="50" cy="50" r="30" fill={`url(#${id}-sphere)`} />
      {/* inner luminous core */}
      <circle cx="50" cy="50" r="18" fill={`url(#${id}-core)`} opacity="0.9" />

      {/* concentric knowledge layers */}
      <circle
        cx="50"
        cy="50"
        r="22"
        fill="none"
        stroke="rgba(255,240,180,0.35)"
        strokeWidth="0.5"
        strokeDasharray="0.8 2"
      />
      <circle
        cx="50"
        cy="50"
        r="14"
        fill="none"
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="0.4"
      />
      <circle
        cx="50"
        cy="50"
        r="9"
        fill="none"
        stroke="rgba(255,255,255,0.30)"
        strokeWidth="0.4"
      />

      {/* front equatorial ring */}
      <path
        d="M 18 53 Q 50 62 82 47"
        fill="none"
        stroke={`url(#${id}-ring)`}
        strokeWidth="1.6"
        opacity="0.85"
        transform="rotate(-18 50 50)"
      />

      {/* specular highlight */}
      <ellipse
        cx="40"
        cy="36"
        rx="10"
        ry="6"
        fill="rgba(255,255,255,0.55)"
        transform="rotate(-30 40 36)"
      />
      <ellipse
        cx="37"
        cy="33"
        rx="4"
        ry="2.3"
        fill="rgba(255,255,255,0.85)"
        transform="rotate(-30 37 33)"
      />

      {/* rim shadow */}
      <path
        d="M 50 80 A 30 30 0 0 0 80 50"
        fill="none"
        stroke="rgba(0,0,0,0.55)"
        strokeWidth="2.5"
        opacity="0.55"
      />

      {/* orbiting sparkles */}
      <circle cx="83" cy="38" r="1.4" fill="#FFE9B0" />
      <circle cx="83" cy="38" r="3" fill="rgba(255,233,176,0.35)" />
      <circle cx="16" cy="60" r="1" fill="#FFD08A" />
    </svg>
  );
}

// ────────────────────────────────────────────────────────────
// 4. ROUND TABLE — 会议
// ────────────────────────────────────────────────────────────
export function WTableIcon({ size = 96 }: WMentalIconProps) {
  const rid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = `tb${rid}`;
  const chairs = [
    { cx: 50, cy: 22 },
    { cx: 82, cy: 38 },
    { cx: 78, cy: 70 },
    { cx: 22, cy: 70 },
    { cx: 18, cy: 38 },
  ];
  const placemats = [
    { cx: 50, cy: 46 },
    { cx: 70, cy: 50 },
    { cx: 67, cy: 60 },
    { cx: 33, cy: 60 },
    { cx: 30, cy: 50 },
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ overflow: "visible" }}>
      <defs>
        <radialGradient id={`${id}-top`} cx="0.35" cy="0.30" r="0.85">
          <stop offset="0%" stopColor="#FFD9A0" />
          <stop offset="35%" stopColor="#E8A352" />
          <stop offset="100%" stopColor="#8A4A1E" />
        </radialGradient>
        <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7A3E18" />
          <stop offset="100%" stopColor="#2E160A" />
        </linearGradient>
        <linearGradient id={`${id}-chair`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5A6B7A" />
          <stop offset="100%" stopColor="#1F2730" />
        </linearGradient>
        <linearGradient id={`${id}-chairHi`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8A9AAA" />
          <stop offset="100%" stopColor="#3A4753" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="0.5" cy="0.55" r="0.55">
          <stop offset="40%" stopColor="rgba(255,160,80,0.30)" />
          <stop offset="100%" stopColor="rgba(255,160,80,0)" />
        </radialGradient>
      </defs>

      {/* outer halo */}
      <ellipse cx="50" cy="55" rx="44" ry="44" fill={`url(#${id}-glow)`} />
      {/* ground shadow */}
      <ellipse cx="50" cy="86" rx="32" ry="4" fill="rgba(0,0,0,0.55)" />

      {/* back-row chairs (drawn before table) */}
      {chairs
        .filter((c) => c.cy < 50)
        .map((c, i) => (
          <g key={`bk${i}`}>
            <ellipse cx={c.cx} cy={c.cy} rx="10" ry="6" fill={`url(#${id}-chair)`} />
            <ellipse
              cx={c.cx}
              cy={c.cy - 1.5}
              rx="9"
              ry="4.5"
              fill={`url(#${id}-chairHi)`}
              opacity="0.85"
            />
            <rect x={c.cx - 2} y={c.cy + 4} width="4" height="6" fill="#1A2028" />
          </g>
        ))}

      {/* table side band */}
      <ellipse cx="50" cy="58" rx="36" ry="14" fill={`url(#${id}-edge)`} />
      <path
        d="M 14 56 A 36 14 0 0 0 86 56 L 86 60 A 36 14 0 0 1 14 60 Z"
        fill="#1A0C04"
        opacity="0.45"
      />
      {/* table top */}
      <ellipse cx="50" cy="54" rx="36" ry="14" fill={`url(#${id}-top)`} />
      {/* top sheen */}
      <ellipse
        cx="50"
        cy="50"
        rx="30"
        ry="10"
        fill="none"
        stroke="rgba(255,240,200,0.55)"
        strokeWidth="0.6"
      />
      <ellipse
        cx="44"
        cy="48"
        rx="12"
        ry="3.5"
        fill="rgba(255,255,255,0.40)"
        transform="rotate(-12 44 48)"
      />

      {/* placemats */}
      {placemats.map((p, i) => (
        <g key={`pl${i}`}>
          <ellipse cx={p.cx} cy={p.cy} rx="3.2" ry="1.6" fill="rgba(0,0,0,0.30)" />
          <ellipse
            cx={p.cx}
            cy={p.cy - 0.4}
            rx="2.6"
            ry="1.2"
            fill="rgba(255,250,230,0.85)"
          />
        </g>
      ))}

      {/* center plate / hot meeting node */}
      <ellipse cx="50" cy="54" rx="5" ry="2.4" fill="rgba(0,0,0,0.30)" />
      <ellipse cx="50" cy="53.5" rx="4.2" ry="1.9" fill="#FFEBC0" />
      <ellipse cx="50" cy="53.2" rx="2.2" ry="0.9" fill="#FF8A4C" />

      {/* front-row chairs (overlap table) */}
      {chairs
        .filter((c) => c.cy >= 50)
        .map((c, i) => (
          <g key={`fr${i}`}>
            <rect x={c.cx - 2} y={c.cy - 5} width="4" height="7" fill="#1A2028" />
            <ellipse cx={c.cx} cy={c.cy} rx="10" ry="6.5" fill={`url(#${id}-chair)`} />
            <ellipse
              cx={c.cx}
              cy={c.cy - 1.5}
              rx="9"
              ry="5"
              fill={`url(#${id}-chairHi)`}
              opacity="0.85"
            />
            <ellipse
              cx={c.cx - 3}
              cy={c.cy - 2}
              rx="3"
              ry="1.4"
              fill="rgba(255,255,255,0.25)"
            />
          </g>
        ))}
    </svg>
  );
}

// ────────────────────────────────────────────────────────────
// Lookup helper — maps node id → icon component
// ────────────────────────────────────────────────────────────
export type WMentalIconId = "agents" | "kb" | "memory" | "meet";

export const W_MENTAL_ICON_BY_ID: Record<
  WMentalIconId,
  (props: WMentalIconProps) => ReactElement
> = {
  agents: WCrystalIcon,
  kb: WBookshelfIcon,
  memory: WOrbIcon,
  meet: WTableIcon,
};
