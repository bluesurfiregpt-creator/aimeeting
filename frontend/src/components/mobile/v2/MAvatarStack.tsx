"use client";

/**
 * v1.4.0 · Saga M1 · 重叠 stack atom (v2).
 *
 * 设计源 1:1: /tmp/aimeeting-design-research/aimeeting/project/mobile-shared.jsx:293-321 (MAvatarStack).
 *
 * 把 V2Attendee[] 渲染成 -8px overlap 的 stack. 真人在前 (MAvatar 圆), AI 在后
 * (MAIBadge 方圆 渐变 glyph). 超出 max 用 "+N" 灰圆.
 *
 * 与 v1 (shared/avatars.tsx::MAvatarStack) 区别:
 *   - v2 喂 V2Attendee[] (走 schema, 不依赖 hardcoded MockHumanId / MockAiId)
 *   - 直接走 attendee.color / glyph / gradient_to — 后端可以推任意 AI 真人
 */

import type { ReactElement } from "react";

import type { V2Attendee } from "./types";
import MAvatar from "./MAvatar";
import MAIBadge from "./MAIBadge";

type Props = {
  attendees: V2Attendee[];
  /** 单个头像 size */
  size?: number;
  /** 最多显示 N 个, 超出显 +K */
  max?: number;
  /** 描边色 */
  ring?: string;
};

export default function MAvatarStack({
  attendees,
  size = 28,
  max = 5,
  ring = "#FFFFFF",
}: Props): ReactElement {
  const shown = attendees.slice(0, max);
  const extra = attendees.length - shown.length;

  return (
    <div style={{ display: "inline-flex", alignItems: "center" }}>
      {shown.map((a, i) => (
        <span
          key={`${a.type}-${a.id}-${i}`}
          style={{
            marginLeft: i === 0 ? 0 : -8,
            zIndex: max - i,
          }}
        >
          {a.type === "human" ? (
            <MAvatar
              name={a.name}
              color={a.color}
              size={size}
              ring={ring}
            />
          ) : (
            <MAIBadge
              name={a.name}
              glyph={a.glyph ?? "◆"}
              gradient_from={a.color}
              gradient_to={a.gradient_to ?? a.color}
              size={size}
              ring={ring}
            />
          )}
        </span>
      ))}
      {extra > 0 ? (
        <span
          style={{
            marginLeft: -8,
            width: size,
            height: size,
            borderRadius: "50%",
            background: "#E5E5EA",
            color: "#3C3C43",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: size * 0.38,
            fontWeight: 700,
            flexShrink: 0,
            boxShadow: ring && ring !== "transparent" ? `0 0 0 1.5px ${ring}` : "none",
          }}
        >
          +{extra}
        </span>
      ) : null}
    </div>
  );
}
