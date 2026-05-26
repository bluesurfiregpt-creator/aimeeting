import { TplGeneratorPane } from "@/components/web/workstation/TplGeneratorPane";

/**
 * R5.B: AI 模板生成器 — 描述 → 拆解动画 → 提案 → 创建.
 *
 * 4 步流程:
 *  1. 用户输入 (textarea 或 3 个 preset)
 *  2. LLM 拆解 (5 个动画步骤, mock 2.2s)
 *  3. 提案 (3-4 位 AI 专家卡, 可展开 / 排除)
 *  4. 创建 (sticky bottom bar 显示入选数 + CTA)
 *
 * R5.B mock: setTimeout + preset 模糊匹配. 后端 LLM call 在 Saga E.B 接通.
 */
export default function TplPane() {
  return <TplGeneratorPane />;
}
