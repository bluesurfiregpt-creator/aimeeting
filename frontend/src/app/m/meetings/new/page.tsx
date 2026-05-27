"use client";

/**
 * v1.4.0 · Saga P-2 (Phase 1 · W4 第二段) · M7 新建会议 — 整页推翻.
 *
 * v1.4.0 · Saga Q (Phase 1 P0 修复) · M7 整页重写为深紫科幻 Mira AI 卡.
 *   - 设计源 1:1: /tmp/aimeeting-design-research/aimeeting/project/mobile-new-meeting.jsx:332-537
 *   - hero 卡: 深紫渐变 `#1a1733 → #2a1f5a → #3b2b73` + 双层 glow (cyan + pink) + sparkle
 *   - textarea: rgba(0,0,0,0.30) + inset 0.5px white-12 + cyan caret #7DDEFF
 *   - mic 按钮: 真 SVG (MAIcon name="mic") + cyan→紫渐变 + inset 0.5px white-30
 *   - CTA "让 Mira 拟方案": 反色 白底 + 紫字 #5E5CE6 + sparkle 17px weight 700
 *   - example chip: 圆角 18 + rgba(255,255,255,0.12) + inset 0.5px white-18 + 白字 14px
 *   - path switcher: 紫渐变 selected (AI tab) + sparkle 图标 (PathSwitch 风格)
 *   - 小提示卡: 白卡 + 3 紫点 bullet list (改正 typo "MIRA 是怎么用的" → "Mira 会怎么帮你")
 *
 * 视觉契约: docs/SCHEMA-mobile-v2.md §5.3 + design-shots/new-meeting.png
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MASheet,
  MScrollPicker,
  MAIRosterGrid,
  MAIcon,
  Sparkle,
} from "@/components/mobile/v2";
import type {
  V2MiraDraftResponse,
  V2AIBadge,
} from "@/components/mobile/v2";

type DescribeView = "describe" | "preview";

// MScrollPicker 时长选项 (跟 SCHEMA §5.3 注释一致)
const DURATION_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120];

// 描述需求 tab 初始 sample prompts (会被 backend response.sample_prompts 覆盖, 但先有 fallback)
const INITIAL_SAMPLES = [
  "评估搜索改版上线的合规风险",
  "Q3 路线图取舍 · 协作功能能不能进",
  "客户 Hummingbird 上线一周的反馈",
];

export default function NewMeetingPage() {
  const router = useRouter();

  // MASheet 默认 open=true (整页是 modal). 关 = 返回上一页.
  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  // tab: ai (描述需求) / manual (自定义)
  const [path, setPath] = useState<"ai" | "manual">("ai");

  return (
    <MASheet open={true} onClose={handleClose} title="新建会议">
      {/* v1.4.0 Saga Q (Phase 1 P0 M7-08): PathSwitch 风格 — 紫渐变 selected (AI tab) + sparkle */}
      <div style={{ padding: "12px 16px 8px" }}>
        <PathSwitch value={path} onChange={setPath} />
      </div>

      {path === "ai" ? (
        <AIPathTab />
      ) : (
        <CustomTab onCreated={(id) => router.push(`/m/meetings/${id}`)} />
      )}
    </MASheet>
  );
}

// ============================================================================
// PathSwitch — 描述需求 / 自定义 切换 (设计稿 mobile-new-meeting.jsx:332-368)
// ============================================================================

function PathSwitch({
  value,
  onChange,
}: {
  value: "ai" | "manual";
  onChange: (v: "ai" | "manual") => void;
}) {
  const opts: { id: "ai" | "manual"; label: string; icon: "sparkle" | "plus" }[] = [
    { id: "ai", label: "描述需求", icon: "sparkle" },
    { id: "manual", label: "自定义", icon: "plus" },
  ];
  return (
    <div
      style={{
        background: "#E5E5EA",
        borderRadius: 12,
        padding: 4,
        display: "flex",
        gap: 3,
        position: "relative",
      }}
    >
      {opts.map((o) => {
        const on = value === o.id;
        const aiOn = on && o.id === "ai";
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            style={{
              flex: 1,
              height: 46,
              borderRadius: 9,
              border: "none",
              background: on
                ? aiOn
                  ? "linear-gradient(135deg, #5E5CE6 0%, #7A5AF0 50%, #AF52DE 100%)"
                  : "#fff"
                : "transparent",
              color: on ? (aiOn ? "#fff" : "#1C1C1E") : "#3C3C43",
              fontSize: 16,
              fontWeight: on ? 700 : 500,
              letterSpacing: 0.1,
              fontFamily: "inherit",
              cursor: "pointer",
              boxShadow: on
                ? aiOn
                  ? "0 4px 14px rgba(94,92,230,0.32)"
                  : "0 1px 2px rgba(0,0,0,0.08), 0 3px 8px rgba(0,0,0,0.04)"
                : "none",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              transition: "all 160ms ease",
            }}
          >
            <MAIcon
              name={o.icon}
              size={16}
              color={on ? (aiOn ? "#fff" : "#3C3C43") : "#8E8E93"}
              strokeWidth={2.2}
            />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// 描述需求 tab — Mira 智能配 AI 主路径
// ============================================================================

function AIPathTab() {
  const router = useRouter();
  const [view, setView] = useState<DescribeView>("describe");
  const [inputText, setInputText] = useState("");
  const [inputMode, setInputMode] = useState<"text" | "voice">("text");
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<V2MiraDraftResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 麦克风 voice mock — 切到录音中 1.5s 后填入预设转写
  const handleMic = useCallback(() => {
    if (voiceRecording) {
      // 中途取消
      setVoiceRecording(false);
      return;
    }
    setVoiceRecording(true);
    setInputMode("voice");
    window.setTimeout(() => {
      setInputText(
        "评估搜索改版上线的合规风险, 同时让客服赵姐给最近一周的客户反馈摘要",
      );
      setVoiceRecording(false);
    }, 1500);
  }, [voiceRecording]);

  // sample chip 点击 → 填入 textarea + 滚到底
  const handleSample = useCallback((s: string) => {
    setInputText(s);
    setInputMode("text");
    // 下一帧滚到底 — textarea 自动 grow 时让用户看到
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(s.length, s.length);
    }, 0);
  }, []);

  // 提交 → POST /api/v2/mira/draft-meeting → 切到 preview
  const handleSubmit = useCallback(async () => {
    if (loading) return;
    if (inputText.trim().length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v2/mira/draft-meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input_text: inputText.trim(),
          input_mode: inputMode,
        }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: V2MiraDraftResponse = await res.json();
      setDraft(data);
      setView("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [inputText, inputMode, loading]);

  if (view === "preview" && draft) {
    return (
      <PreviewView
        draft={draft}
        onBack={() => setView("describe")}
        onStart={() => {
          // Phase 1 mock — 直接跳回主页. Phase 2 应 POST /api/v2/meetings 创建后跳详情.
          router.push("/m/meetings");
        }}
      />
    );
  }

  const canSubmit = !loading && inputText.trim().length > 0;

  return (
    <div style={{ padding: "12px 16px 32px" }}>
      {/* === Mira hero 卡 — 深紫渐变 (设计稿 mobile-new-meeting.jsx:376-505) === */}
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 16,
          background:
            "linear-gradient(135deg, #1a1733 0%, #2a1f5a 45%, #3b2b73 100%)",
          boxShadow:
            "0 8px 24px rgba(94,92,230,0.30), 0 0 0 0.5px rgba(255,255,255,0.08)",
          padding: "14px 14px 16px",
        }}
      >
        {/* 双层 glow — 右上 cyan + 左下 pink */}
        <div
          style={{
            position: "absolute",
            top: -50,
            right: -40,
            width: 170,
            height: 170,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(100,210,255,0.32) 0%, rgba(0,0,0,0) 65%)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -60,
            left: -30,
            width: 150,
            height: 150,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(255,100,180,0.22) 0%, rgba(0,0,0,0) 70%)",
            pointerEvents: "none",
          }}
        />
        {/* sparkle 装饰 */}
        <Sparkle top={14} right={50} size={11} opacity={0.85} />
        <Sparkle top={42} right={26} size={6} opacity={0.55} />

        {/* hero 内容 — eyebrow + title */}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 11,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "rgba(255,255,255,0.18)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.20)",
              flexShrink: 0,
            }}
          >
            <MAIcon name="sparkle" size={18} color="#fff" strokeWidth={2.1} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "rgba(255,255,255,0.78)",
                letterSpacing: 0.4,
                textTransform: "uppercase",
              }}
            >
              Mira · 会议筹备
            </div>
            <div
              style={{
                fontSize: 19,
                fontWeight: 700,
                color: "#fff",
                marginTop: 3,
                letterSpacing: -0.2,
              }}
            >
              告诉我你想聊什么
            </div>
          </div>
        </div>

        {/* 描述 一段话 */}
        <div
          style={{
            position: "relative",
            marginTop: 13,
            fontSize: 15,
            color: "rgba(255,255,255,0.82)",
            lineHeight: 1.55,
          }}
        >
          一段话描述你的诉求 — Mira 会起草{" "}
          <b style={{ color: "#fff" }}>主题、议程、AI 专家阵容</b>,你再增删。
        </div>

        {/* textarea + 紫麦克风 — 深底框 (rgba(0,0,0,0.30)) + cyan caret #7DDEFF */}
        <div
          style={{
            position: "relative",
            marginTop: 14,
            background: "rgba(0,0,0,0.30)",
            borderRadius: 13,
            boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.12)",
            padding: 14,
            minHeight: 188,
          }}
        >
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              if (inputMode === "voice") setInputMode("text");
            }}
            placeholder={
              voiceRecording
                ? "录音中..."
                : "例: 下周搜索改版要上线,我担心摘要片段可能包含业主敏感信息,想评估一下合规风险 + 拍板上线灰度。"
            }
            disabled={voiceRecording}
            rows={4}
            style={{
              width: "100%",
              minHeight: 130,
              resize: "none",
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#fff",
              fontFamily: "inherit",
              fontSize: 17,
              lineHeight: 1.6,
              caretColor: "#7DDEFF",
              paddingRight: 56,
            }}
          />

          {/* 紫麦克风按钮 — cyan→紫渐变, 真 SVG mic icon */}
          <button
            type="button"
            onClick={handleMic}
            aria-label={voiceRecording ? "停止录音" : "开始录音"}
            style={{
              position: "absolute",
              right: 10,
              bottom: 10,
              width: 42,
              height: 42,
              borderRadius: "50%",
              background: voiceRecording
                ? "linear-gradient(135deg, #FF3B30 0%, #FF6482 100%)"
                : "linear-gradient(135deg, #7DDEFF 0%, #5E5CE6 100%)",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: voiceRecording
                ? "0 4px 14px rgba(255,59,48,0.45)"
                : "0 4px 14px rgba(94,92,230,0.45), inset 0 0 0 0.5px rgba(255,255,255,0.30)",
              cursor: "pointer",
              color: "#fff",
              transition: "transform 0.15s",
              ...(voiceRecording
                ? { animation: "miraPulse 1.1s ease-in-out infinite" }
                : {}),
            }}
          >
            {voiceRecording ? (
              <span
                style={{
                  width: 12,
                  height: 12,
                  background: "#fff",
                  borderRadius: 2,
                  display: "inline-block",
                }}
              />
            ) : (
              <MAIcon name="mic" size={20} color="#fff" strokeWidth={2.2} />
            )}
          </button>
        </div>

        {/* example chips — 圆角 18 + 白半透 + 白字 14px (深紫卡里) */}
        <div
          style={{
            position: "relative",
            marginTop: 12,
            display: "flex",
            flexWrap: "wrap",
            gap: 7,
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "rgba(255,255,255,0.62)",
              letterSpacing: 0.4,
              textTransform: "uppercase",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            试试:
          </span>
          {INITIAL_SAMPLES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => handleSample(s)}
              style={{
                fontSize: 14,
                color: "#fff",
                padding: "7px 13px",
                borderRadius: 18,
                background: "rgba(255,255,255,0.12)",
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.18)",
                whiteSpace: "nowrap",
              }}
            >
              {s}
            </button>
          ))}
        </div>

        {/* CTA "让 Mira 拟方案" — 反色: 白底 + 紫字 (深紫卡里突显) */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            position: "relative",
            marginTop: 16,
            width: "100%",
            height: 56,
            borderRadius: 14,
            background: canSubmit ? "#fff" : "rgba(255,255,255,0.16)",
            color: canSubmit ? "#5E5CE6" : "rgba(255,255,255,0.5)",
            border: "none",
            cursor: canSubmit ? "pointer" : "default",
            fontFamily: "inherit",
            fontSize: 17,
            fontWeight: 700,
            letterSpacing: 0.1,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 9,
            boxShadow: canSubmit ? "0 6px 18px rgba(0,0,0,0.20)" : "none",
            transition: "all 160ms ease",
          }}
        >
          {loading ? (
            <>
              <ThinkingDots />
              <span>Mira 在准备方案…</span>
            </>
          ) : (
            <>
              <MAIcon
                name="sparkle"
                size={17}
                color={canSubmit ? "#5E5CE6" : "rgba(255,255,255,0.5)"}
                strokeWidth={2.3}
              />
              让 Mira 拟方案
            </>
          )}
        </button>
      </div>

      {/* === 小提示卡 "Mira 会怎么帮你" — 白卡 + 3 紫点 bullet list (M7-09) === */}
      <div
        style={{
          marginTop: 14,
          padding: "14px 14px",
          borderRadius: 14,
          background: "#fff",
          border: "0.5px solid rgba(60,60,67,0.10)",
          fontSize: 14.5,
          color: "#3C3C43",
          lineHeight: 1.55,
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "#8E8E93",
            letterSpacing: 0.4,
            textTransform: "uppercase",
            marginBottom: 9,
          }}
        >
          Mira 会怎么帮你
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 9,
            marginBottom: 7,
          }}
        >
          <TipDot />
          <span>
            从你这段话提取领域关键词,推荐{" "}
            <b>3–5 位 AI 专家</b>,并写明为什么选它
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 9,
            marginBottom: 7,
          }}
        >
          <TipDot />
          <span>
            自动拆 <b>议程项 + 时长</b>,默认背景同步 → 主题讨论 → 拍板分工
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
          <TipDot />
          <span>结合你过去 100 条记忆 — 优先调取相关历史决策</span>
        </div>
      </div>

      {error ? (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            background: "rgba(255,59,48,0.08)",
            borderRadius: 10,
            color: "#FF3B30",
            fontSize: 13,
          }}
        >
          请求失败: {error}
        </div>
      ) : null}

      {/* 内嵌 keyframes — 单页 scope, 不污染 globals */}
      <style>{`
        @keyframes miraSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes miraPulse {
          0%, 100% { transform: scale(1); box-shadow: 0 2px 8px rgba(255,59,48,0.30); }
          50% { transform: scale(1.08); box-shadow: 0 4px 14px rgba(255,59,48,0.55); }
        }
        @keyframes miraDot {
          0%, 80%, 100% { transform: scale(0.7); opacity: 0.5; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// 小紫点 (跟设计稿 mobile-new-meeting.jsx:534-537 一致)
function TipDot() {
  return (
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: "#5E5CE6",
        marginTop: 8,
        flexShrink: 0,
      }}
    />
  );
}

// CTA loading 状态的 3 点 (跟设计稿 mobile-new-meeting.jsx:539-549)
function ThinkingDots() {
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#5E5CE6",
            animation: `miraDot 1.2s ease-in-out ${i * 0.16}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

// ============================================================================
// PreviewView — Mira 拟方案后展示
// ============================================================================

function PreviewView({
  draft,
  onBack,
  onStart,
}: {
  draft: V2MiraDraftResponse;
  onBack: () => void;
  onStart: () => void;
}) {
  const [totalMin, setTotalMin] = useState(draft.total_duration_min);
  const [pickedAis, setPickedAis] = useState<Set<string>>(
    new Set(draft.proposed_ais.map((a) => a.id)),
  );
  const [pickedHumans, setPickedHumans] = useState<Set<string>>(
    new Set(draft.proposed_humans.map((h) => h.id)),
  );

  const aiCandidates: V2AIBadge[] = useMemo(
    () =>
      draft.proposed_ais.map((a) => ({
        id: a.id,
        name: a.name,
        glyph: a.glyph,
        gradient_from: a.gradient_from,
        gradient_to: a.gradient_to,
      })),
    [draft.proposed_ais],
  );
  const reasons = useMemo(
    () =>
      Object.fromEntries(draft.proposed_ais.map((a) => [a.id, a.reason])),
    [draft.proposed_ais],
  );

  return (
    <div style={{ padding: "12px 16px 100px" }}>
      {/* v1.4.0 Saga Q (Phase 1 P0 A-06): 顶 Mira 已起草 pulse + 重新描述 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            fontSize: 13.5,
            color: "#3C3C43",
            fontWeight: 600,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #5E5CE6, #AF52DE)",
              boxShadow: "0 0 7px rgba(94,92,230,0.55)",
            }}
          />
          Mira 信心 {Math.round(draft.confidence * 100)}%
          {/* v1.4.0 Sprint 3 Mobile Part 4 · NORTH_STAR § 7.5 不让 mock 假装真实.
              当前 /api/v2/mira/draft-meeting 是 1.1s sleep 的 mock, 不接 LLM.
              加紫色 "演示" chip 让用户清楚 这是 V1 展示态, 不是真 NLU. */}
          <span
            data-testid="mira-mock-badge"
            title="V1 演示 · 接 LLM 后会真实生成"
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "2px 7px",
              borderRadius: 6,
              background: "rgba(94,92,230,0.12)",
              color: "#5E5CE6",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.2,
              border: "0.5px solid rgba(94,92,230,0.30)",
              marginLeft: 4,
            }}
          >
            演示
          </span>
        </span>
        <button
          type="button"
          onClick={onBack}
          style={{
            fontSize: 14,
            color: "#007AFF",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontFamily: "inherit",
            fontWeight: 600,
          }}
        >
          重新描述 ›
        </button>
      </div>
      {/* v1.4.0 Sprint 3 Mobile Part 4 · 演示说明 (NORTH_STAR § 7.5) */}
      <div
        style={{
          marginBottom: 12,
          padding: "8px 10px",
          borderRadius: 8,
          background: "rgba(94,92,230,0.06)",
          border: "0.5px solid rgba(94,92,230,0.18)",
          fontSize: 11.5,
          color: "#5E5CE6",
          lineHeight: 1.45,
        }}
      >
        V1 演示 · 接 LLM 后会真实生成方案. 当前内容来自固定模板.
      </div>

      {/* 卡 1 — 主题 */}
      <PreviewCard label="主题">
        <div
          style={{
            fontSize: 17,
            fontWeight: 600,
            color: "#1C1C1E",
            letterSpacing: -0.2,
          }}
        >
          {draft.proposed_title}
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 13,
            color: "#3C3C43",
            lineHeight: 1.45,
          }}
        >
          {draft.proposed_topic}
        </div>
      </PreviewCard>

      {/* 卡 2 — 议程 + 总时长 MScrollPicker */}
      <PreviewCard label="议程">
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {draft.proposed_agenda.map((it, idx) => (
            <li
              key={idx}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 0",
                borderBottom:
                  idx < draft.proposed_agenda.length - 1
                    ? "0.5px solid rgba(60,60,67,0.08)"
                    : "none",
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#8E8E93",
                  width: 18,
                  textAlign: "center",
                  flexShrink: 0,
                }}
              >
                {idx + 1}
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: 14,
                  color: "#1C1C1E",
                  fontWeight: 500,
                }}
              >
                {it.label}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  padding: "2px 8px",
                  borderRadius: 6,
                  background: "rgba(94,92,230,0.10)",
                  color: "#5E5CE6",
                  flexShrink: 0,
                }}
              >
                {it.led_by_ai}
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: "#8E8E93",
                  width: 38,
                  textAlign: "right",
                  flexShrink: 0,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {it.duration_min}m
              </span>
            </li>
          ))}
        </ul>

        <div
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: "0.5px solid rgba(60,60,67,0.12)",
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: "#8E8E93",
              marginBottom: 4,
              textAlign: "center",
            }}
          >
            总时长
          </div>
          <MScrollPicker
            items={DURATION_OPTIONS}
            value={
              DURATION_OPTIONS.includes(totalMin)
                ? totalMin
                : DURATION_OPTIONS.reduce((p, c) =>
                    Math.abs(c - totalMin) < Math.abs(p - totalMin) ? c : p,
                  )
            }
            onChange={setTotalMin}
            suffix="分钟"
            height={144}
          />
        </div>
      </PreviewCard>

      {/* 卡 3 — AI 阵容 */}
      <PreviewCard label={`AI 阵容 (${pickedAis.size})`}>
        <MAIRosterGrid
          candidates={aiCandidates}
          selected={pickedAis}
          onToggle={(id) =>
            setPickedAis((s) => {
              const n = new Set(s);
              if (n.has(id)) n.delete(id);
              else n.add(id);
              return n;
            })
          }
          reasons={reasons}
        />
      </PreviewCard>

      {/* 卡 4 — 参会人 */}
      <PreviewCard label={`参会人 (${pickedHumans.size})`}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {draft.proposed_humans.map((h) => {
            const picked = pickedHumans.has(h.id);
            return (
              <button
                key={h.id}
                type="button"
                onClick={() =>
                  setPickedHumans((s) => {
                    const n = new Set(s);
                    if (n.has(h.id)) n.delete(h.id);
                    else n.add(h.id);
                    return n;
                  })
                }
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 12px 6px 6px",
                  borderRadius: 999,
                  background: picked
                    ? "rgba(0,122,255,0.10)"
                    : "#FFFFFF",
                  border: picked
                    ? "0.5px solid #007AFF"
                    : "0.5px solid rgba(60,60,67,0.12)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: h.avatar_color,
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {h.surname_char}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    color: "#1C1C1E",
                    fontWeight: 500,
                  }}
                >
                  {h.name}
                </span>
                {picked ? (
                  <span
                    style={{
                      fontSize: 12,
                      color: "#007AFF",
                      fontWeight: 600,
                    }}
                  >
                    ✓
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </PreviewCard>

      {/* sticky 底栏 — "开始会议" 蓝 CTA */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          left: 0,
          right: 0,
          marginTop: 18,
          marginLeft: -16,
          marginRight: -16,
          padding: "12px 16px calc(env(safe-area-inset-bottom, 0px) + 12px)",
          background: "rgba(242,242,247,0.94)",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          borderTop: "0.5px solid rgba(60,60,67,0.12)",
        }}
      >
        <button
          type="button"
          onClick={onStart}
          disabled={pickedAis.size === 0}
          style={{
            width: "100%",
            height: 56,
            borderRadius: 12,
            border: "none",
            background: "#007AFF",
            color: "#fff",
            fontSize: 17,
            fontWeight: 600,
            opacity: pickedAis.size === 0 ? 0.4 : 1,
            cursor: pickedAis.size === 0 ? "not-allowed" : "pointer",
            boxShadow: "0 4px 14px rgba(0,122,255,0.25)",
            fontFamily: "inherit",
          }}
        >
          开始会议 · {totalMin} 分钟
        </button>
      </div>
    </div>
  );
}

function PreviewCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        marginTop: 12,
        background: "#FFFFFF",
        borderRadius: 14,
        padding: 14,
        border: "0.5px solid rgba(60,60,67,0.12)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.5,
          color: "#8E8E93",
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      {children}
    </section>
  );
}

// ============================================================================
// CustomTab — 简化版老表单 fallback
// ============================================================================

function CustomTab({ onCreated }: { onCreated: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"hybrid" | "auto">("hybrid");

  const handleCreate = useCallback(() => {
    // Phase 1 mock — 不真创建, 直接跳列表 (showcase 不破坏 typecheck)
    if (title.trim().length === 0) return;
    onCreated("mock-meeting");
  }, [title, onCreated]);

  return (
    <div style={{ padding: "12px 16px 100px" }}>
      <section
        style={{
          background: "#FFFFFF",
          borderRadius: 14,
          padding: 14,
          border: "0.5px solid rgba(60,60,67,0.12)",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#8E8E93",
            letterSpacing: 0.5,
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          会议标题
        </div>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: Q1 物业投诉评估会"
          maxLength={120}
          style={{
            width: "100%",
            height: 44,
            background: "#F2F2F7",
            border: "none",
            borderRadius: 10,
            padding: "0 12px",
            fontSize: 15,
            color: "#1C1C1E",
            outline: "none",
            fontFamily: "inherit",
          }}
        />
      </section>

      <section
        style={{
          marginTop: 12,
          background: "#FFFFFF",
          borderRadius: 14,
          padding: 14,
          border: "0.5px solid rgba(60,60,67,0.12)",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#8E8E93",
            letterSpacing: 0.5,
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          会议类型
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <ModeRow
            checked={mode === "hybrid"}
            onSelect={() => setMode("hybrid")}
            title="真人 + AI 混合"
            body="真人开会, AI 旁观或被召出来发言"
          />
          <ModeRow
            checked={mode === "auto"}
            onSelect={() => setMode("auto")}
            title="全 AI 自主讨论"
            body="真人写议程, AI 自己跑. 你只负责 review 结果"
          />
        </div>
      </section>

      <button
        type="button"
        onClick={handleCreate}
        disabled={title.trim().length === 0}
        style={{
          marginTop: 20,
          width: "100%",
          height: 52,
          borderRadius: 12,
          border: "none",
          background: "#007AFF",
          color: "#fff",
          fontSize: 16,
          fontWeight: 600,
          opacity: title.trim().length === 0 ? 0.4 : 1,
          cursor:
            title.trim().length === 0 ? "not-allowed" : "pointer",
          fontFamily: "inherit",
        }}
      >
        创建会议
      </button>
    </div>
  );
}

function ModeRow({
  checked,
  onSelect,
  title,
  body,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: 10,
        borderRadius: 10,
        background: checked ? "rgba(0,122,255,0.06)" : "transparent",
        border: checked
          ? "0.5px solid #007AFF"
          : "0.5px solid rgba(60,60,67,0.12)",
        textAlign: "left",
        cursor: "pointer",
        width: "100%",
        fontFamily: "inherit",
      }}
    >
      <span
        style={{
          marginTop: 2,
          width: 18,
          height: 18,
          borderRadius: "50%",
          border: `2px solid ${checked ? "#007AFF" : "#C7C7CC"}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {checked ? (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#007AFF",
            }}
          />
        ) : null}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{ fontSize: 14, fontWeight: 600, color: "#1C1C1E" }}
        >
          {title}
        </div>
        <div
          style={{
            marginTop: 2,
            fontSize: 12.5,
            color: "#3C3C43",
            lineHeight: 1.4,
          }}
        >
          {body}
        </div>
      </div>
    </button>
  );
}
