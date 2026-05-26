"use client";

import { W_TOKENS } from "../tokens";
import { WIcon, WSparkle } from "../atoms";

/**
 * 首页 Hero — 紫渐变标题 "让会议拥有 超脑与灵魂" + 飘浮星点 + eyebrow pill.
 *
 * PM chat 拍板的文案 (round-5):
 *  - 主标题: "让会议拥有超脑与灵魂" (round-5 polish, 改自 v26 旧版 "记忆与专家")
 *  - 副: 实时字幕 · 声纹识别 · AI 专家参会 · 长期记忆
 */
export function HomeHero() {
  return (
    <div
      style={{
        paddingTop: 80,
        paddingBottom: 28,
        textAlign: "center",
        position: "relative",
      }}
    >
      <WSparkle x="48%" y={30} size={14} opacity={0.9} />
      <WSparkle x="42%" y={68} size={9} opacity={0.6} />
      <WSparkle x="56%" y={64} size={11} opacity={0.7} />
      <WSparkle x="34%" y={50} size={6} opacity={0.45} />
      <WSparkle x="62%" y={36} size={6} opacity={0.45} />

      {/* eyebrow */}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          padding: "5px 12px 5px 8px",
          borderRadius: 99,
          background: "rgba(124,92,250,0.08)",
          boxShadow: "inset 0 0 0 0.5px rgba(124,92,250,0.30)",
          fontSize: 12,
          fontWeight: 600,
          color: "#C4B5FD",
          letterSpacing: 0.3,
        }}
      >
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: 5,
            background: W_TOKENS.accentGrad,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 8px rgba(124,92,250,0.50)",
          }}
        >
          <WIcon name="sparkle" size={10} color="#fff" stroke={2.4} />
        </div>
        aimeeting · v27
      </div>

      <h1
        style={{
          margin: "20px 0 0",
          fontSize: 56,
          fontWeight: 800,
          letterSpacing: -2,
          lineHeight: 1.05,
          color: W_TOKENS.textPrimary,
        }}
      >
        让会议拥有
        <br />
        <span
          style={{
            background: W_TOKENS.accentGrad,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          超脑与灵魂
        </span>
      </h1>

      <p
        style={{
          margin: "20px auto 0",
          maxWidth: 540,
          fontSize: 15,
          color: W_TOKENS.textSecondary,
          lineHeight: 1.6,
        }}
      >
        实时字幕 · 声纹识别 · AI 专家参会 · 长期记忆
      </p>
    </div>
  );
}
