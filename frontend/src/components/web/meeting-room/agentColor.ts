/**
 * R5.D Web 会议室 — backend `agent_color` (语义色名) → 渐变 hex 对.
 *
 * 抄 mobile `frontend/src/components/mobile/shared/avatars.tsx` COLOR_TO_GRADIENT
 * (Saga E.E pattern), 不 import — PM DESIGN_SYSTEM § 0.3.3 Web/Mobile 不共用 atom,
 * 此映射表也单独维护 (允许双端调色微调).
 *
 * iOS 浅色 渐变 — 跟 MRAIAvatar 风格一致, 避免暗紫 W_TOKENS 漂移 (会议室永远 light).
 */

export const COLOR_TO_GRADIENT: Record<string, [string, string]> = {
  violet: ["#AF52DE", "#5E5CE6"],
  emerald: ["#34C759", "#30B0C7"],
  amber: ["#FFB340", "#FF9F0A"],
  sky: ["#0A84FF", "#5E5CE6"],
  rose: ["#FF2D55", "#AF52DE"],
  teal: ["#30B0C7", "#5E5CE6"],
  blue: ["#0A84FF", "#5E5CE6"],
  indigo: ["#5856D6", "#5E5CE6"],
};

const FALLBACK_GRADIENT: [string, string] = ["#5E5CE6", "#AF52DE"];

export function gradientForAgentColor(
  color: string | null | undefined,
): [string, string] {
  if (!color) return FALLBACK_GRADIENT;
  return COLOR_TO_GRADIENT[color] || FALLBACK_GRADIENT;
}
