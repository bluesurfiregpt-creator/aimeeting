import type { WIconName } from "../atoms";

/**
 * Workstation sidebar 配置 — 6 段 12 项 (跟 round-5 设计稿 web-workstation.jsx 对齐).
 *
 * PM R2 决策: App Router `/workstation/[pane]`, 不用 hash.
 * 所以每个 item 有 `slug` (URL), 而非 hash id.
 *
 * `slug: null` = 该项尚未实施 (R5.A placeholder), 链接到 placeholder pane.
 * `badge` = 红点数字 (e.g. 我的任务 3 / 审批中心 5).
 */
export type WSSidebarItem = {
  slug: string;       // /workstation/<slug>
  label: string;
  icon: WIconName;
  badge?: number;
};

export type WSSection = {
  id: string;
  label: string;
  items: WSSidebarItem[];
};

export const WS_SECTIONS: WSSection[] = [
  {
    id: "mind",
    label: "总览",
    items: [
      // round-6: 心智模型 → AI 心智一览 (融合 graph 血缘图 嵌入 mental pane)
      { slug: "",       label: "AI 心智一览", icon: "compass" }, // root → /workstation
      { slug: "board",  label: "数据看板",     icon: "target" },
    ],
  },
  {
    id: "me",
    label: "我",
    items: [
      { slug: "profile", label: "身份信息", icon: "users" },
      { slug: "tasks",   label: "我的任务", icon: "task", badge: 3 },
    ],
  },
  {
    id: "meet",
    label: "会议",
    items: [
      { slug: "new",     label: "新建会议", icon: "plus" },
      // round-6: 干掉硬编码 q3-roadmap, 改 会议历史 list pane
      { slug: "history", label: "会议历史", icon: "history" },
      // v1.4.0 Phase C · 10 NEW-B 议题主题 一级对象 (痛点 5).
      { slug: "topics",  label: "议题",     icon: "compass" },
    ],
  },
  {
    id: "team",
    label: "我的 AI 团队",
    items: [
      { slug: "browse", label: "AI 卡片浏览", icon: "sparkle" },
      { slug: "agents", label: "AI 专家管理", icon: "admin" },
      { slug: "tpl",    label: "AI 模板生成", icon: "bolt" },
    ],
  },
  {
    id: "know",
    label: "知识与经验",
    items: [
      { slug: "kb",      label: "知识库",       icon: "book" },
      { slug: "memory",  label: "长期记忆",     icon: "brain" },
      // round-6: graph (全景血缘图) 从侧栏移除 — 已融入 AI 心智一览
      // PM R6.4: URL /workstation/graph 保留, 给深链 / OnBoarding 教程 / 共享给同事用
      { slug: "approve", label: "审批中心",     icon: "check", badge: 5 },
    ],
  },
  {
    id: "admin-section",
    label: "平台",
    items: [
      { slug: "admin", label: "平台超管", icon: "gear" },
    ],
  },
];

/**
 * 已支持的 slug 列表. 用于 layout / catch-all route 校验 + 404 fallback.
 * (`""` = mental, 在 root `/workstation`)
 *
 * round-6: `graph` 已从侧栏移除, 但 URL `/workstation/graph` 保留 (PM R6.4 决策),
 * 用于深链 / OnBoarding 教程 / 共享给同事. 所以这里显式加 graph.
 */
export const WS_VALID_SLUGS = new Set<string>([
  ...WS_SECTIONS.flatMap((s) => s.items.map((i) => i.slug)),
  "graph",
]);
