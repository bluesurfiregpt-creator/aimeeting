/**
 * R5.D Web 会议室 — barrel.
 *
 * 唯一 entry 点对外:
 *   import { MRLiveView } from "@/components/web/meeting-room";
 *
 * 内部子组件 (atom / panel / modal) 不对外 — 通过 MRLiveView 组合好.
 *
 * 跟 W_TOKENS 严格隔离: 本目录所有文件**不 import** `@/components/web/tokens`,
 * 也**不 import** `@/components/web/atoms` (浅色 iOS 风 ≠ 暗紫 W_TOKENS).
 *
 * 数据 mock 复用了 `@/components/web/data/agents` 的 W_AGENTS / W_HUMANS
 * (16 个 AI + 9 个真人), 但只**读取**, 不污染.
 */
export { MRLiveView } from "./MRLiveView";
