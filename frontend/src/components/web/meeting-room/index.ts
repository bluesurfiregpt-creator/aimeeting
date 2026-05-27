/**
 * R5.D Web 会议室 — barrel.
 *
 * 唯一 entry 点对外:
 *   import { MRLiveView } from "@/components/web/meeting-room";
 *
 * 内部子组件 (atom / panel / modal) 不对外 — 通过 MRLiveView 组合好.
 *
 * **v1.4.0 § 7.1.1 例外 (PM 2026-05-28 拍板 override § 7.1)**:
 *  - 会议室双 theme (浅 default + 深 opt-in), 走 `useWebTheme` 共享 storage
 *  - MRThemeToggle 跨 boundary 引 `../useWebTheme` (W theme infra), 但 token 自己一套
 *  - 跟 workstation W_TOKENS 隔离 仍然 维持 — 不互相 import token 文件
 *
 * 数据 mock 复用了 `@/components/web/data/agents` 的 W_AGENTS / W_HUMANS
 * (16 个 AI + 9 个真人), 但只**读取**, 不污染.
 */
export { MRLiveView } from "./MRLiveView";
