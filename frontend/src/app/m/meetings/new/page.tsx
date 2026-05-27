"use client";

/**
 * v1.4.0 · Saga P-2 (Phase 1 · W4 第二段) · M7 新建会议 — 整页推翻.
 *
 * 由 Saga D+I 老版 push 表单 → 改成 MASheet 底滑 modal + Mira "描述需求" 路径.
 *
 * 视觉契约: docs/SCHEMA-mobile-v2.md §5.3 + design-shots/new-meeting.png
 *
 * 结构:
 *   - MASheet 包裹 (顶 "取消" 关 → router.back())
 *   - 顶 MASegmented "描述需求 / 自定义"
 *
 *   - 描述需求 tab — 2 个 sub-view 切换:
 *     · describe (初始): Mira hero 卡 + 灰底大 textarea + 紫麦克风 + 3 sample chips
 *       + 紫渐变 CTA "让 Mira 拟方案" → POST /api/v2/mira/draft-meeting
 *     · preview (拟方案后): 主题/议程 (MScrollPicker 调时长) / AI 阵容 (MAIRosterGrid)
 *       / 参会人 / sticky "开始会议" 蓝 CTA
 *
 *   - 自定义 tab — 简化版老表单 (会议标题 + 类型 radio + 创建)
 *
 * 不引依赖. 麦克风 voice 走 setTimeout 1.5s mock 转写.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MASheet,
  MASegmented,
  MScrollPicker,
  MAIRosterGrid,
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
  "Q3 路线图回顾",
  "客户 Hummingbird 最近一周的反馈",
];

export default function NewMeetingPage() {
  const router = useRouter();

  // MASheet 默认 open=true (整页是 modal). 关 = 返回上一页.
  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  // tab: describe / custom
  const [tab, setTab] = useState<"describe" | "custom">("describe");

  return (
    <MASheet open={true} onClose={handleClose} title="新建会议">
      {/* segmented tab — 描述需求 / 自定义 */}
      <div style={{ padding: "12px 16px 8px" }}>
        <MASegmented
          tabs={[
            { id: "describe", label: "描述需求" },
            { id: "custom", label: "自定义" },
          ]}
          active={tab}
          onChange={(id) => setTab(id as "describe" | "custom")}
        />
      </div>

      {tab === "describe" ? (
        <DescribeTab />
      ) : (
        <CustomTab onCreated={(id) => router.push(`/m/meetings/${id}`)} />
      )}
    </MASheet>
  );
}

// ============================================================================
// 描述需求 tab — Mira 智能配 AI 主路径
// ============================================================================

function DescribeTab() {
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
        "评估搜索改版上线的合规风险, 同时让 Hummingbird 给最近一周的客户反馈摘要",
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

  return (
    <div style={{ padding: "12px 16px 32px" }}>
      {/* MIRA 会议筹备 hero 卡 */}
      <div
        style={{
          background: "#FFFFFF",
          borderRadius: 18,
          padding: 18,
          border: "0.5px solid rgba(60,60,67,0.12)",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            letterSpacing: 0.6,
            color: "#5E5CE6",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          MIRA · 会议筹备
        </div>
        <div
          style={{
            fontSize: 19,
            fontWeight: 700,
            letterSpacing: -0.3,
            color: "#1C1C1E",
            lineHeight: 1.25,
          }}
        >
          告诉我你想聊什么
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 13.5,
            color: "#3C3C43",
            lineHeight: 1.45,
            opacity: 0.85,
          }}
        >
          一段话描述你的诉求 — Mira 会起草主题、议程、AI 阵容等, 再调整。
        </div>

        {/* 灰底大 textarea + 紫麦克风 */}
        <div
          style={{
            position: "relative",
            marginTop: 14,
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
                : "例: 下周搜索改版要上线, 我想心里摸底..."
            }
            disabled={voiceRecording}
            rows={4}
            style={{
              width: "100%",
              minHeight: 110,
              background: "#F2F2F7",
              borderRadius: 12,
              border: "none",
              padding: "12px 52px 12px 14px",
              fontSize: 14,
              lineHeight: 1.5,
              color: "#1C1C1E",
              resize: "none",
              outline: "none",
              fontFamily: "inherit",
            }}
          />

          {/* 紫麦克风按钮 — 右下绝对定位 */}
          <button
            type="button"
            onClick={handleMic}
            aria-label={voiceRecording ? "停止录音" : "开始录音"}
            style={{
              position: "absolute",
              right: 8,
              bottom: 8,
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: voiceRecording
                ? "linear-gradient(135deg, #FF3B30 0%, #FF6482 100%)"
                : "linear-gradient(135deg, #5E5CE6 0%, #7A5AF0 100%)",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 8px rgba(94,92,230,0.30)",
              cursor: "pointer",
              color: "#fff",
              fontSize: 16,
              transition: "transform 0.15s",
              ...(voiceRecording
                ? { animation: "miraPulse 1.1s ease-in-out infinite" }
                : {}),
            }}
          >
            {voiceRecording ? "■" : "⌬"}
          </button>
        </div>

        {/* 3 sample chips */}
        <div
          style={{
            marginTop: 12,
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: 11.5,
              color: "#8E8E93",
              marginRight: 2,
              alignSelf: "center",
            }}
          >
            试:
          </span>
          {INITIAL_SAMPLES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => handleSample(s)}
              style={{
                fontSize: 11.5,
                padding: "5px 10px",
                borderRadius: 10,
                background: "rgba(60,60,67,0.06)",
                border: "none",
                color: "#3C3C43",
                cursor: "pointer",
                lineHeight: 1.2,
                fontFamily: "inherit",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* "让 Mira 拟方案" 紫渐变大 CTA */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={loading || inputText.trim().length === 0}
        style={{
          marginTop: 16,
          width: "100%",
          height: 56,
          borderRadius: 14,
          border: "none",
          background:
            "linear-gradient(135deg, #5E5CE6 0%, #7A5AF0 45%, #AF52DE 100%)",
          color: "#fff",
          fontSize: 16,
          fontWeight: 600,
          letterSpacing: 0.2,
          opacity:
            loading || inputText.trim().length === 0 ? 0.5 : 1,
          cursor:
            loading || inputText.trim().length === 0
              ? "not-allowed"
              : "pointer",
          boxShadow: "0 6px 18px rgba(94,92,230,0.32)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          position: "relative",
          overflow: "hidden",
          fontFamily: "inherit",
        }}
      >
        {loading ? (
          <>
            <span
              style={{
                display: "inline-block",
                width: 16,
                height: 16,
                borderRadius: "50%",
                border: "2px solid rgba(255,255,255,0.35)",
                borderTopColor: "#fff",
                animation: "miraSpin 0.7s linear infinite",
              }}
            />
            Mira 思考中…
          </>
        ) : (
          <>
            让 Mira 拟方案
            <span style={{ fontSize: 18, lineHeight: 1 }}>✦</span>
          </>
        )}
        {/* 微闪烁星点 */}
        {!loading ? (
          <>
            <Sparkle top={10} right={36} size={9} opacity={0.65} />
            <Sparkle top={32} right={18} size={5} opacity={0.45} />
          </>
        ) : null}
      </button>

      {/* footer 提示 */}
      <div
        style={{
          marginTop: 22,
          paddingTop: 14,
          borderTop: "0.5px solid rgba(60,60,67,0.12)",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.5,
            color: "#5E5CE6",
            marginBottom: 4,
          }}
        >
          MIRA 是怎么做用的
        </div>
        <div
          style={{
            fontSize: 12.5,
            color: "#8E8E93",
            lineHeight: 1.5,
          }}
        >
          从你这段话提取核心关键词, 推荐 3~5 名 AI 专家 + 议程, 再让你审定
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
      `}</style>
    </div>
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
      {/* 顶 confidence + 重写 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: 12,
            color: "#8E8E93",
          }}
        >
          Mira 信心 {Math.round(draft.confidence * 100)}%
        </span>
        <button
          type="button"
          onClick={onBack}
          style={{
            fontSize: 13,
            color: "#007AFF",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          重新描述
        </button>
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
