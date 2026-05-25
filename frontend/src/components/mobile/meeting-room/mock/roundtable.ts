/**
 * v1.2.0 · Saga · meeting-room-v2 · AI 圆桌 mock 数据.
 *
 * PM 决策 (TD2): 永久 1 张固定 round, page mount 时 insert 到 transcript 末尾.
 * 不走 WS event, 不进 backend schema. 仅 UI demo.
 *
 * 6 个 AI 命名空间 (TD9) 跟真实 backend agent 分开:
 *   ARIA / STRATOS / LEX / SAGE / TALLY / SCOUT
 *
 * 结构跟 bundle (meeting-room-shared.jsx index 14) 1:1.
 */

import type { MockAiId, MockHumanId } from "../avatars";

export type RoundStance = "support" | "caution" | "block";

export type RoundExpertContribution = {
  who: MockAiId;
  stance: RoundStance;
  done: boolean;
  headline: string;
  summary: string;
  data?: { label: string; v: string }[];
  note?: string;
};

export type RoundMiraSummary = {
  verdict: string;
  conflict: boolean;
  points: { stance: RoundStance; tag: string; text: string }[];
  recommendation: string;
};

export type MockRoundMessage = {
  /** 唯一 key, 用于 React render */
  key: string;
  /** "23:14" 风格 — 仅展示 */
  t: string;
  /** 顶部 quote 显示 — 主持人/PM 发起的 question */
  topic: string;
  /** 发起人 (mock human key) */
  trigger: { kind: "summon"; by: MockHumanId };
  /** 是否所有专家答完 */
  done: boolean;
  /** 专家答复列表 */
  experts: RoundExpertContribution[];
  /** Mira 综合 (done=true 时显) */
  miraSummary: RoundMiraSummary;
  /** 用于跟真实 timeline 合并的时间锚点 (minute);
   *  page 把这条插到 lines 末尾 (TD2 — 永久 1 张, 不需要复杂排位). */
  at_minute_anchor: number;
};

export const MOCK_ROUND_MESSAGES: MockRoundMessage[] = [
  {
    key: "mock-round-1",
    t: "23:14",
    topic: "把 B 组灰度到 20%, 可推进吗?",
    trigger: { kind: "summon", by: "ZK" },
    done: true,
    experts: [
      {
        who: "ARIA",
        stance: "support",
        done: true,
        headline: "数据支持 · 延迟在 SLA 内",
        summary:
          "B 组在 95% 置信下显著, P95 延迟 1.18s 仍在 1.5s SLA 内, 有 9pp 余量; 同时已具备自动降级开关.",
        data: [
          { label: "有用率", v: "+11.4pp" },
          { label: "P95", v: "1.18s" },
          { label: "SLA 余量", v: "9pp" },
        ],
        note: "若 P95 触发 1.5s 阈值, 自动回 A 组, 预案已就绪.",
      },
      {
        who: "LEX",
        stance: "caution",
        done: true,
        headline: "法务可推进 · 需同步隐私更新",
        summary:
          "灰度到 20% 触发隐私政策第 4.2 条更新 (约 2 人日), 建议与下周隐私 review 打包发布, 避免用户多次接收变更通知.",
        data: [
          { label: "工作量", v: "2 人日" },
          { label: "截止", v: "6/3" },
          { label: "风险", v: "中" },
        ],
        note: "单独发布更新可能引发额外问询; 打包风险更可控.",
      },
      {
        who: "SAGE",
        stance: "support",
        done: true,
        headline: "UX 利好 · 用户对延迟容忍 > 预期",
        summary:
          "12 位访谈对象中, 9 位对 1.5s 内延迟基本无感, 11 位明显感受到摘要质量提升; NPS 较 A 组 +18.",
        data: [
          { label: "无感知延迟", v: "9/12" },
          { label: "感知改善", v: "11/12" },
          { label: "NPS Δ", v: "+18" },
        ],
        note: "正向感知量级大于负向延迟感知, 放心切.",
      },
    ],
    miraSummary: {
      verdict: "可推进 · 注意法务节奏",
      conflict: false,
      points: [
        { stance: "support", tag: "数据", text: "置信内显著, SLA 内, 有自动降级预案" },
        { stance: "caution", tag: "法务", text: "隐私 4.2 条需更新, 建议与隐私 review 打包" },
        { stance: "support", tag: "UX", text: "用户对延迟容忍度高于设计预期" },
      ],
      recommendation:
        "本周内 20% 灰度, 与下周隐私 review 同步发布. Lex 起草隐私更新, Aria 监控降级开关.",
    },
    at_minute_anchor: 9999, // 总是落在末尾
  },
];
