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
 * 对话式发现 — round-6 重写.
 *
 * R6 关键变化 (跟 R5.A 对比):
 *  - 引入 `isLight` MutationObserver tracker — light/dark 双套独立配色 (而非强行复用 dark token)
 *  - 容器: 双套独立 bg (light: #ffffff→#faf7ff, dark: #1a1438→#0f0d24)
 *  - 容器: 加 24×24 紫色细网格 + radial mask
 *  - 顶部 accent 描边: 2 → 3px + 16px 紫光 glow
 *  - Mira 头像: 28 → 44px + 橙色光环 + "主持人"紫 chip
 *  - 标题字号 13 → 18px/800, 副标题 11.5 → 15px/500 + 绿色脉冲 dot
 *  - 输入框: 15 → 17px, padding 14 → 18px, focus 紫光晕 4px
 *  - ⌘ Enter 真 kbd 元素 (灰底白字 + inset shadow)
 *  - 灵感场景 chip: 9×14, 13.5px, hover 紫光投影, 加 sparkle, UPPERCASE 标题
 *
 * 提交逻辑 (mock):
 *  - keyword 匹配挑 3 preset 之一; 后续 Saga 接 `POST /api/agents/template-generate`
 *
 * "立即开始这场会议" / "空白会议" → 跳 /meeting.
 */
export function DiscoveryBox() {
  const [stage, setStage] = useState<Stage>("idle");
  const [prompt, setPrompt] = useState("");
  // Track theme so we can use a light-mode-native palette instead of forcing dark
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  useEffect(() => {
    const read = (): "light" | "dark" => {
      const v = document.documentElement.getAttribute("data-theme");
      return v === "light" ? "light" : "dark";
    };
    setTheme(read());
    const obs = new MutationObserver(() => setTheme(read()));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => obs.disconnect();
  }, []);
  const isLight = theme === "light";
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
      {/* glow halo — much stronger */}
      <div
        style={{
          position: "absolute",
          inset: -60,
          background: isLight
            ? "radial-gradient(ellipse 70% 100% at 50% 50%, rgba(124,92,250,0.18) 0%, rgba(124,92,250,0.05) 38%, rgba(0,0,0,0) 70%)"
            : "radial-gradient(ellipse 70% 100% at 50% 50%, rgba(124,92,250,0.45) 0%, rgba(124,92,250,0.14) 38%, rgba(0,0,0,0) 70%)",
          pointerEvents: "none",
          filter: "blur(16px)",
        }}
      />

      <div
        style={{
          position: "relative",
          background: isLight
            ? "linear-gradient(180deg, #ffffff 0%, #faf7ff 100%)"
            : "linear-gradient(180deg, #1a1438 0%, #0f0d24 100%)",
          borderRadius: 20,
          boxShadow: isLight
            ? "inset 0 0 0 1px rgba(124,92,250,0.18), 0 24px 56px rgba(124,92,250,0.18), 0 4px 16px rgba(124,92,250,0.10)"
            : "inset 0 0 0 1px rgba(196,181,253,0.28), 0 28px 70px rgba(124,92,250,0.30), 0 4px 20px rgba(0,0,0,0.55)",
          overflow: "hidden",
        }}
      >
        {/* subtle scan-line / grid pattern overlay for tech feel */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: isLight
              ? "linear-gradient(rgba(124,92,250,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(124,92,250,0.05) 1px, transparent 1px)"
              : "linear-gradient(rgba(196,181,253,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(196,181,253,0.04) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
            maskImage:
              "radial-gradient(ellipse 80% 60% at 50% 50%, #000 0%, transparent 80%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 80% 60% at 50% 50%, #000 0%, transparent 80%)",
            pointerEvents: "none",
            opacity: isLight ? 0.9 : 0.6,
          }}
        />

        {/* purple top edge — bolder (3px + glow) */}
        <div
          style={{
            height: 3,
            background: W_TOKENS.accentGrad,
            boxShadow: "0 0 16px rgba(124,92,250,0.60)",
            position: "relative",
            zIndex: 1,
          }}
        />

        {/* prompt header */}
        <div
          style={{
            position: "relative",
            zIndex: 1,
            padding: "22px 26px 0",
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <div style={{ position: "relative", flexShrink: 0 }}>
            <WAIBadge id="MIRA" size={44} radius={12} />
            {/* glowing ring around badge */}
            <span
              style={{
                position: "absolute",
                inset: -3,
                borderRadius: 14,
                boxShadow:
                  "0 0 0 1px rgba(255,179,64,0.40), 0 0 18px rgba(255,179,64,0.30)",
                pointerEvents: "none",
              }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <span
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: isLight ? "#1c1c1e" : "#ffffff",
                  letterSpacing: -0.3,
                }}
              >
                Mira
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: isLight ? "#5E5CE6" : "#C4B5FD",
                  background: isLight ? "rgba(124,92,250,0.10)" : "rgba(124,92,250,0.18)",
                  padding: "2px 8px",
                  borderRadius: 5,
                  letterSpacing: 0.4,
                  boxShadow: isLight
                    ? "inset 0 0 0 0.5px rgba(124,92,250,0.30)"
                    : "inset 0 0 0 0.5px rgba(124,92,250,0.40)",
                }}
              >
                主持人
              </span>
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 500,
                color: isLight ? "rgba(28,28,30,0.88)" : "rgba(255,255,255,0.85)",
                marginTop: 4,
                lineHeight: 1.45,
              }}
            >
              告诉我你要解决什么 · 我帮你召唤合适的专家
            </div>
            <div
              style={{
                fontSize: 12.5,
                color: isLight ? "rgba(60,60,67,0.65)" : "rgba(255,255,255,0.50)",
                marginTop: 4,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#86EFAC",
                  boxShadow: "0 0 6px rgba(134,239,172,0.70)",
                  animation: "wPulse 1.5s ease-in-out infinite",
                }}
              />
              智能议程 + 专家阵容 · 平均 1.4 秒出方案
            </div>
          </div>
          {stage === "result" && (
            <WButton variant="ghost" size="md" onClick={reset}>
              重新开始
            </WButton>
          )}
        </div>

        {/* input area */}
        <div style={{ position: "relative", zIndex: 1, padding: "20px 26px 0" }}>
          <div
            style={{
              background: isLight ? "rgba(124,92,250,0.04)" : "rgba(255,255,255,0.04)",
              borderRadius: 14,
              boxShadow: isLight
                ? "inset 0 0 0 1px rgba(124,92,250,0.18)"
                : "inset 0 0 0 1px rgba(255,255,255,0.10)",
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
              onFocus={(e) => {
                const parent = e.currentTarget.parentElement;
                if (parent) {
                  parent.style.boxShadow = isLight
                    ? "inset 0 0 0 1px rgba(94,92,230,0.50), 0 0 0 4px rgba(124,92,250,0.10)"
                    : "inset 0 0 0 1px rgba(196,181,253,0.55), 0 0 0 4px rgba(124,92,250,0.12)";
                }
              }}
              onBlur={(e) => {
                const parent = e.currentTarget.parentElement;
                if (parent) {
                  parent.style.boxShadow = isLight
                    ? "inset 0 0 0 1px rgba(124,92,250,0.18)"
                    : "inset 0 0 0 1px rgba(255,255,255,0.10)";
                }
              }}
              style={{
                width: "100%",
                minHeight: 100,
                resize: "none",
                padding: "18px 20px 16px",
                border: "none",
                background: "transparent",
                color: isLight ? "#1c1c1e" : "#ffffff",
                fontSize: 17,
                lineHeight: 1.55,
                fontWeight: 400,
                fontFamily: "inherit",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <div
              style={{
                padding: "6px 12px 12px 18px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  color: isLight ? "rgba(60,60,67,0.65)" : "rgba(255,255,255,0.55)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <kbd
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 2,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: isLight ? "rgba(124,92,250,0.10)" : "rgba(255,255,255,0.10)",
                    boxShadow: "inset 0 -1px 0 rgba(0,0,0,0.20)",
                    fontFamily: 'ui-monospace, "SF Mono", monospace',
                    fontSize: 10.5,
                    color: isLight ? "#5E5CE6" : "#fff",
                    fontWeight: 600,
                  }}
                >
                  ⌘ Enter
                </kbd>
                提交
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <WButton
                  variant="ghost"
                  size="md"
                  icon="plus"
                  onClick={() => {
                    if (typeof window !== "undefined") window.location.href = "/meeting";
                  }}
                >
                  空白会议
                </WButton>
                <WButton variant="primary" size="md" iconRight="arr-r" onClick={submit}>
                  召唤专家
                </WButton>
              </div>
            </div>
          </div>

          {/* example chips */}
          {stage === "idle" && (
            <div style={{ marginTop: 20 }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  fontWeight: 700,
                  color: isLight ? "rgba(60,60,67,0.65)" : "rgba(255,255,255,0.60)",
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                  marginBottom: 10,
                }}
              >
                <WIcon name="sparkle" size={11} color={isLight ? "#5E5CE6" : "#C4B5FD"} stroke={2.2} />
                灵感场景 · 点击直接试试
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {W_DISCOVERY_EXAMPLES.map((ex) => (
                  <button
                    key={ex.id}
                    type="button"
                    onClick={() => trigger(ex)}
                    style={{
                      padding: "9px 14px",
                      borderRadius: 10,
                      background: isLight ? "rgba(124,92,250,0.07)" : "rgba(196,181,253,0.08)",
                      boxShadow: isLight
                        ? "inset 0 0 0 1px rgba(124,92,250,0.22)"
                        : "inset 0 0 0 1px rgba(196,181,253,0.22)",
                      color: isLight ? "#1c1c1e" : "rgba(255,255,255,0.92)",
                      fontSize: 13.5,
                      fontWeight: 500,
                      fontFamily: "inherit",
                      cursor: "pointer",
                      border: "none",
                      transition: "all 160ms ease",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = isLight
                        ? "rgba(124,92,250,0.15)"
                        : "rgba(196,181,253,0.18)";
                      e.currentTarget.style.boxShadow = isLight
                        ? "inset 0 0 0 1px rgba(124,92,250,0.45), 0 4px 14px rgba(124,92,250,0.18)"
                        : "inset 0 0 0 1px rgba(196,181,253,0.50), 0 4px 14px rgba(124,92,250,0.20)";
                      e.currentTarget.style.transform = "translateY(-1px)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = isLight
                        ? "rgba(124,92,250,0.07)"
                        : "rgba(196,181,253,0.08)";
                      e.currentTarget.style.boxShadow = isLight
                        ? "inset 0 0 0 1px rgba(124,92,250,0.22)"
                        : "inset 0 0 0 1px rgba(196,181,253,0.22)";
                      e.currentTarget.style.transform = "none";
                    }}
                  >
                    <WIcon name="sparkle" size={12} color={isLight ? "#7C5CFA" : "#C4B5FD"} stroke={2.2} />
                    {ex.prompt.length > 28 ? ex.prompt.slice(0, 28) + "…" : ex.prompt}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* result area */}
        <div style={{ position: "relative", zIndex: 1, padding: "20px 26px 24px" }}>
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
