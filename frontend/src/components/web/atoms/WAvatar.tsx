"use client";

import { W_HUMANS } from "../data/agents";

/**
 * 真人圆头像 + initials. 用于会议参与者 / 我自己.
 */
export function WAvatar({
  id,
  size = 32,
  ring,
}: {
  id: string;
  size?: number;
  ring?: string;
}) {
  const h = W_HUMANS[id];
  if (!h) return null;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: h.color,
        color: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.42,
        fontWeight: 600,
        flexShrink: 0,
        boxShadow: ring ? `0 0 0 2px ${ring}` : "none",
      }}
    >
      {h.initials}
    </div>
  );
}
