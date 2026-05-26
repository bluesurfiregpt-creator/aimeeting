"use client";

import { useEffect, useRef, useState } from "react";
import { W_TOKENS } from "../tokens";
import {
  W_AGENTS,
  W_DISCOVERY_EXAMPLES,
  type DiscoveryExample,
} from "../data/agents";
import { WAIBadge, WButton, WIcon, WPill } from "../atoms";

type Stage = "idle" | "thinking" | "result";

/**
 * 对话式发现 — 输入框 + 3 个示例 chip + 1.4s 拆解动画 + 召唤结果.
 *
 * 三阶段:
 *  - idle:     大输入 + 示例 chip + "召唤专家" CTA
 *  - thinking: 三步打勾动画 (~1.32s)
 *  - result:   显示召唤的 AI + 建议议程 + "立即开始" CTA
 *
 * 提交逻辑 (R5.A 仅 mock):
 *  - 用 keyword 匹配挑 3 个 preset 之一
 *  - 后续 Saga 接 `POST /api/agents/template-generate`
 *
 * "立即开始这场会议" / "空白会议" → 跳 /meeting (R5.D 接 Web 会议室真实路由)
 */
export function DiscoveryBox() {
  const [stage, setStage] = useState<Stage>("idle");
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<DiscoveryExample | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const trigger = (example: DiscoveryExample) => {
    setPrompt(example.prompt);
    setStage("thinking");
    setResult(null);
    setTimeout(() => {
      setResult(example);
      setStage("result");
    }, 1400);
  };

  const submit = () => {
    if (!prompt.trim()) return;
    // 关键词 → preset 匹配 (R5.A mock, 后续接 LLM)
    const lower = prompt.toLowerCase();
    let pick = W_DISCOVERY_EXAMPLES[0];
    if (lower.includes("投诉") || lower.includes("客户") || lower.includes("满意")) {
      pick = W_DISCOVERY_EXAMPLES[1];
    } else if (lower.includes("数据") || lower.includes("合规") || lower.includes("法")) {
      pick = W_DISCOVERY_EXAMPLES[2];
    }
    trigger({ ...pick, prompt });
  };

  const reset = () => {
    setStage("idle");
    setPrompt("");
    setResult(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", position: "relative" }}>
      {/* glow halo */}
      <div
        style={{
          position: "absolute",
          inset: -30,
          background:
            "radial-gradient(ellipse 70% 90% at 50% 50%, rgba(124,92,250,0.20) 0%, rgba(0,0,0,0) 70%)",
          pointerEvents: "none",
          filter: "blur(10px)",
        }}
      />

      <div
        style={{
          position: "relative",
          background: W_TOKENS.surface,
          borderRadius: 18,
          boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.borderHover}, 0 20px 60px rgba(0,0,0,0.40)`,
          overflow: "hidden",
        }}
      >
        {/* purple top edge */}
        <div
          style={{
            height: 2,
            background: W_TOKENS.accentGrad,
            opacity: 0.85,
          }}
        />

        {/* prompt header */}
        <div style={{ padding: "18px 22px 0", display: "flex", alignItems: "center", gap: 10 }}>
          <WAIBadge id="MIRA" size={28} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: W_TOKENS.textPrimary }}>
              告诉我你要解决什么 · Mira 帮你召唤合适的专家
            </div>
            <div style={{ fontSize: 11.5, color: W_TOKENS.textMuted, marginTop: 1 }}>
              智能议程 + 专家阵容 · 平均 1.4s 出方案
            </div>
          </div>
          {stage === "result" && (
            <WButton variant="ghost" size="sm" onClick={reset}>
              重新开始
            </WButton>
          )}
        </div>

        {/* input area */}
        <div style={{ padding: "14px 22px 0" }}>
          <div
            style={{
              background: W_TOKENS.bg,
              borderRadius: 12,
              boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
              transition: "box-shadow 200ms ease",
            }}
          >
            <textarea
              ref={inputRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
              placeholder="例如:我们要评估业主敏感数据存储改造方案,需要法务、数据、客户体验多方意见…"
              style={{
                width: "100%",
                minHeight: 88,
                resize: "none",
                padding: "14px 16px",
                border: "none",
                background: "transparent",
                color: W_TOKENS.textPrimary,
                fontSize: 15,
                lineHeight: 1.55,
                fontFamily: "inherit",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <div
              style={{
                padding: "4px 8px 8px 14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ fontSize: 11, color: W_TOKENS.textFaint }}>⌘ Enter 提交</div>
              <div style={{ display: "flex", gap: 6 }}>
                <WButton
                  variant="ghost"
                  size="sm"
                  icon="plus"
                  onClick={() => {
                    if (typeof window !== "undefined") window.location.href = "/meeting";
                  }}
                >
                  空白会议
                </WButton>
                <WButton variant="primary" size="sm" iconRight="arr-r" onClick={submit}>
                  召唤专家
                </WButton>
              </div>
            </div>
          </div>

          {/* example chips */}
          {stage === "idle" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
              <span
                style={{
                  fontSize: 11.5,
                  color: W_TOKENS.textMuted,
                  padding: "6px 4px 6px 0",
                }}
              >
                灵感:
              </span>
              {W_DISCOVERY_EXAMPLES.map((ex) => (
                <button
                  key={ex.id}
                  type="button"
                  onClick={() => trigger(ex)}
                  style={{
                    padding: "6px 11px",
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.04)",
                    boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
                    color: W_TOKENS.textSecondary,
                    fontSize: 12.5,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    border: "none",
                    transition: "background 140ms ease, color 140ms ease",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(124,92,250,0.10)";
                    e.currentTarget.style.color = "#C4B5FD";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                    e.currentTarget.style.color = W_TOKENS.textSecondary;
                  }}
                >
                  <WIcon name="sparkle" size={11} stroke={2} />
                  {ex.prompt.length > 22 ? ex.prompt.slice(0, 22) + "…" : ex.prompt}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* result area */}
        <div style={{ padding: "18px 22px 22px" }}>
          {stage === "thinking" && <ThinkingState />}
          {stage === "result" && result && <ResultState ex={result} />}
        </div>
      </div>
    </div>
  );
}

function ThinkingState() {
  const STEPS = ["理解你的问题", "在 32 位 AI 专家中挑选合适人选", "为你拟定议程与时间分配"];
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setStep((s) => Math.min(STEPS.length - 1, s + 1));
    }, 440);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={{ borderTop: `0.5px solid ${W_TOKENS.border}`, paddingTop: 16, marginTop: 4 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
          fontSize: 12.5,
          color: "#C4B5FD",
          fontWeight: 600,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#C4B5FD",
            animation: "wPulse 1.2s ease-in-out infinite",
          }}
        />
        Mira 正在召唤…
      </div>
      {STEPS.map((s, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "6px 0",
            fontSize: 13.5,
            color: i <= step ? W_TOKENS.textPrimary : W_TOKENS.textFaint,
            transition: "color 200ms ease",
          }}
        >
          {i < step ? (
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: W_TOKENS.success,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <WIcon name="check" size={10} color="#fff" stroke={3} />
            </span>
          ) : i === step ? (
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: "rgba(124,92,250,0.20)",
                boxShadow: "inset 0 0 0 1.5px #C4B5FD",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#C4B5FD",
                  animation: "wPulse 0.9s ease-in-out infinite",
                }}
              />
            </span>
          ) : (
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                boxShadow: `inset 0 0 0 1px ${W_TOKENS.border}`,
              }}
            />
          )}
          {s}
        </div>
      ))}
    </div>
  );
}

function ResultState({ ex }: { ex: DiscoveryExample }) {
  return (
    <div
      style={{
        borderTop: `0.5px solid ${W_TOKENS.border}`,
        paddingTop: 16,
        marginTop: 4,
        animation: "wFadeIn 280ms ease forwards",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <WPill tone="accent" icon="sparkle">
          已为你召唤 · {ex.agents.length} 位专家
        </WPill>
        <span style={{ fontSize: 12, color: W_TOKENS.textMuted }}>{ex.rationale}</span>
      </div>

      {/* Agents row */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {ex.agents.map((id) => {
          const a = W_AGENTS.find((x) => x.id === id);
          if (!a) return null;
          return (
            <div
              key={id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 9,
                padding: "7px 12px 7px 7px",
                borderRadius: 10,
                background: "rgba(255,255,255,0.04)",
                boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
              }}
            >
              <WAIBadge id={id} size={28} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: W_TOKENS.textPrimary }}>
                  {a.name}
                </div>
                <div style={{ fontSize: 11, color: W_TOKENS.textMuted, marginTop: 1 }}>
                  {a.domain}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Agenda */}
      <div
        style={{
          background: "rgba(124,92,250,0.05)",
          borderRadius: 11,
          boxShadow: "inset 0 0 0 0.5px rgba(124,92,250,0.20)",
          padding: "12px 14px",
          marginBottom: 14,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#C4B5FD",
            letterSpacing: 0.5,
            marginBottom: 8,
          }}
        >
          建议议程
        </div>
        {ex.agenda.map((a, i) => (
          <div
            key={i}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0" }}
          >
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: "rgba(124,92,250,0.18)",
                color: "#C4B5FD",
                fontSize: 11,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {i + 1}
            </span>
            <span style={{ flex: 1, fontSize: 13.5, color: W_TOKENS.textPrimary }}>{a.title}</span>
            <span
              style={{
                fontSize: 11.5,
                color: W_TOKENS.textMuted,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {a.minutes} 分钟
            </span>
          </div>
        ))}
      </div>

      {/* CTAs */}
      <div style={{ display: "flex", gap: 8 }}>
        <WButton
          variant="primary"
          size="lg"
          iconRight="arr-r"
          full
          onClick={() => {
            if (typeof window !== "undefined") window.location.href = "/meeting";
          }}
        >
          立即开始这场会议
        </WButton>
        <WButton variant="ghost" size="lg" icon="gear">
          调整一下
        </WButton>
      </div>
    </div>
  );
}
