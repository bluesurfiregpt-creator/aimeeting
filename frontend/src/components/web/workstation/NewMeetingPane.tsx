"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { W_TOKENS } from "../tokens";
import {
  WIcon,
  WPill,
  WAvatar,
  WAIBadge,
  WButton,
  WCard,
  WSparkle,
} from "../atoms";
import { W_AGENTS, W_HUMANS } from "../data/agents";
import { PaneHeader } from "./PaneHeader";
import { api } from "@/lib/api";

/**
 * 新建会议 pane — R5.C.
 *
 * 来自 round-6 设计稿 NewMeetingPane:
 *  - 左 5fr: form (主题 / 模式 / 议程 / 参会人 / AI 阵容)
 *  - 右 3fr: sticky "Mira 会前检查" 卡 (sparkle 装饰)
 *  - 提交 → 跳 /workstation/meeting/new-<timestamp>
 */
export function NewMeetingPane() {
  const router = useRouter();
  const [mode, setMode] = useState<"mix" | "autonomous">("mix");
  const [title, setTitle] = useState("");
  const [agenda, setAgenda] = useState<{ id: number; title: string; minutes: number }[]>([
    { id: 1, title: "", minutes: 10 },
  ]);
  const [picked, setPicked] = useState<Set<string>>(new Set(["ZK", "LM", "WJ"]));
  const [pickedAI, setPickedAI] = useState<Set<string>>(new Set(["MIRA"]));
  const [query, setQuery] = useState("");

  const addAgenda = () =>
    setAgenda((prev) => [...prev, { id: Date.now(), title: "", minutes: 10 }]);
  const removeAgenda = (id: number) =>
    setAgenda((prev) => prev.filter((a) => a.id !== id));
  const updateAgenda = (id: number, key: "title" | "minutes", val: string | number) =>
    setAgenda((prev) =>
      prev.map((a) => (a.id === id ? { ...a, [key]: val } : a)),
    );

  const togglePicked = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const togglePickedAI = (id: string) => {
    setPickedAI((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredAIs = W_AGENTS.filter((a) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      a.name.toLowerCase().includes(q) ||
      a.nick?.toLowerCase().includes(q) ||
      a.tags.some((t) => t.toLowerCase().includes(q))
    );
  });
  const totalMinutes = agenda.reduce((s, a) => s + (Number(a.minutes) || 0), 0);

  // Sprint 3 Web W2: 接老 /api/meetings POST. attendee/agent id mock 跟 backend
  // 真 user/agent uuid 不一致, 真接时 fallback 创建空 meeting (backend 会用 caller
  // 自己当 attendee). title 留空时 给默认 "新建会议".
  // mode: mix → hybrid (mock 跟 backend enum 不完全 1:1, hybrid = mix human + AI).
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  const handleStart = async () => {
    if (creating) return;
    setCreating(true);
    setCreateErr(null);
    try {
      const backendMode: "human" | "hybrid" | "auto" =
        mode === "autonomous" ? "auto" : "hybrid";
      const backendTitle = title.trim() || "新建会议";
      // mock id (ZK/LM/WJ/MIRA 等) 不是真 uuid — 传空数组让 backend 用 caller 兜底.
      // 真接 attendee picker 需 ws user 列表 (V1.5 推迟).
      const created = await api.createMeeting(
        backendTitle,
        [], // attendeeUserIds — empty: backend 自动用 caller
        agenda.filter((a) => a.title.trim()).length > 0
          ? agenda
              .filter((a) => a.title.trim())
              .map((a) => ({
                title: a.title.trim(),
                time_budget_min: Number(a.minutes) || 10,
              }))
          : null,
        [], // attendeeAgentIds empty — backend 跟据 mode 自动
        backendMode,
      );
      router.push(`/workstation/meeting/${created.id}`);
    } catch (e) {
      console.warn("[NewMeetingPane] /api/meetings POST 失败:", e);
      setCreateErr("创建会议失败,请稍后再试 (后端 API 暂不可用)");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <PaneHeader
        title="新建会议"
        sub="配置议程 + 真人参会人 + AI 专家阵容 — 全部就绪后一键开会"
      />

      <div style={{ display: "grid", gridTemplateColumns: "5fr 3fr", gap: 16 }}>
        {/* LEFT — form */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* title + mode */}
          <WCard padding={18}>
            <FormLabel>会议主题</FormLabel>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例:Q3 路线图对齐"
              style={inputBig}
            />

            <FormLabel style={{ marginTop: 16 }}>会议模式</FormLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <ModeOption
                on={mode === "mix"}
                onClick={() => setMode("mix")}
                title="真人 + AI 混合"
                sub="传统会议体验 · 真人发言 + @AI 召唤"
                icon="users"
              />
              <ModeOption
                on={mode === "autonomous"}
                onClick={() => setMode("autonomous")}
                title="AI 自主会议"
                sub="召集人 + N 个 AI · 系统自动推进议程"
                icon="sparkle"
              />
            </div>
          </WCard>

          {/* agenda */}
          <WCard padding={18}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <FormLabel noMb>
                议程项{" "}
                <span style={{ color: W_TOKENS.textMuted, fontWeight: 400 }}>
                  · 系统会监督跑题 + 时间预算
                </span>
              </FormLabel>
              <span
                style={{
                  fontSize: 12,
                  color: W_TOKENS.textMuted,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                总计 {totalMinutes} 分钟
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {agenda.map((a, i) => (
                <div
                  key={a.id}
                  style={{ display: "flex", gap: 8, alignItems: "center" }}
                >
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: "rgba(124,92,250,0.16)",
                      color: "#C4B5FD",
                      fontSize: 11,
                      fontWeight: 700,
                      lineHeight: "22px",
                      textAlign: "center",
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}
                  </span>
                  <input
                    value={a.title}
                    onChange={(e) => updateAgenda(a.id, "title", e.target.value)}
                    placeholder="议程项(如:合规风险评估)"
                    style={{ ...inputBase, flex: 1 }}
                  />
                  <input
                    type="number"
                    value={a.minutes}
                    onChange={(e) =>
                      updateAgenda(a.id, "minutes", Number(e.target.value) || 0)
                    }
                    placeholder="分钟"
                    style={{ ...inputBase, width: 80, textAlign: "right" }}
                  />
                  {agenda.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeAgenda(a.id)}
                      style={{
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        color: W_TOKENS.textMuted,
                        fontSize: 16,
                        padding: "6px 8px",
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addAgenda}
              style={{
                marginTop: 10,
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#C4B5FD",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "inherit",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: 0,
              }}
            >
              <WIcon name="plus" size={13} stroke={2.2} color="#C4B5FD" /> 添加议程项
            </button>
          </WCard>

          {/* participants */}
          <WCard padding={18}>
            <FormLabel>
              勾选参会人{" "}
              <span style={{ color: W_TOKENS.textMuted, fontWeight: 400 }}>
                · 须先在「录入声纹」录过
              </span>
            </FormLabel>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
              {Object.keys(W_HUMANS).map((id) => (
                <PickRow
                  key={id}
                  on={picked.has(id)}
                  onClick={() => togglePicked(id)}
                >
                  <WAvatar id={id} size={22} />
                  <span style={{ fontSize: 13.5, color: W_TOKENS.textPrimary }}>
                    {W_HUMANS[id]?.name}
                  </span>
                  <span style={{ flex: 1 }} />
                  {id === "ZK" ? (
                    <WPill tone="success" size="sm">
                      已录声纹
                    </WPill>
                  ) : (
                    <span style={{ fontSize: 11, color: W_TOKENS.textFaint }}>
                      无声纹
                    </span>
                  )}
                </PickRow>
              ))}
            </div>
          </WCard>

          {/* AI experts */}
          <WCard padding={18}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <FormLabel noMb>
                邀请 AI 专家{" "}
                <span style={{ color: W_TOKENS.textMuted, fontWeight: 400 }}>
                  · 可多选 · 不勾会议中没有 AI 自动发言
                </span>
              </FormLabel>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  height: 30,
                  padding: "0 10px",
                  borderRadius: 7,
                  background: W_TOKENS.bg,
                  boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
                }}
              >
                <WIcon name="search" size={12} color={W_TOKENS.textMuted} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索 姓名 / 领域"
                  style={{
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    color: W_TOKENS.textPrimary,
                    fontFamily: "inherit",
                    fontSize: 12,
                    width: 140,
                  }}
                />
              </div>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                gap: 8,
                maxHeight: 320,
                overflowY: "auto",
              }}
            >
              {filteredAIs.map((a) => (
                <PickRow
                  key={a.id}
                  on={pickedAI.has(a.id)}
                  onClick={() => togglePickedAI(a.id)}
                >
                  <WAIBadge id={a.id} size={22} radius={6} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: W_TOKENS.textPrimary,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {a.name}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: W_TOKENS.textMuted,
                        marginTop: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {a.domain}
                    </div>
                  </div>
                </PickRow>
              ))}
            </div>
          </WCard>
        </div>

        {/* RIGHT — sticky Mira summary */}
        <div style={{ position: "sticky", top: 80, alignSelf: "flex-start" }}>
          <div
            style={{
              position: "relative",
              overflow: "hidden",
              borderRadius: 14,
              background:
                "linear-gradient(135deg, #15102f 0%, #1c1538 50%, #251a40 100%)",
              boxShadow:
                "0 12px 32px rgba(124,92,250,0.20), inset 0 0 0 0.5px rgba(124,92,250,0.20)",
              padding: "18px 20px",
            }}
          >
            <WSparkle x={28} y={14} size={10} opacity={0.85} />
            <WSparkle x={66} y={36} size={6} opacity={0.55} />
            <WSparkle x="80%" y={26} size={9} opacity={0.7} />

            <div style={{ position: "relative" }}>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: "rgba(255,255,255,0.65)",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                }}
              >
                Mira · 会前检查
              </div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: "#fff",
                  marginTop: 4,
                }}
              >
                你这场会议的样子
              </div>

              <div style={{ marginTop: 16 }}>
                <SummaryItem icon="cal" label="主题" value={title || "(未填)"} />
                <SummaryItem
                  icon="bolt"
                  label="模式"
                  value={mode === "mix" ? "真人 + AI 混合" : "AI 自主会议"}
                />
                <SummaryItem
                  icon="target"
                  label="议程"
                  value={`${agenda.length} 项 · ${totalMinutes} 分钟`}
                />
                <SummaryItem icon="users" label="参会人" value={`${picked.size} 人`} />
                <SummaryItem
                  icon="sparkle"
                  label="AI 专家"
                  value={`${pickedAI.size} 位`}
                />
              </div>

              {/* AI lineup */}
              {pickedAI.size > 0 && (
                <div
                  style={{
                    marginTop: 14,
                    padding: "10px 12px",
                    borderRadius: 9,
                    background: "rgba(0,0,0,0.20)",
                    boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.05)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      color: "rgba(255,255,255,0.60)",
                      letterSpacing: 0.4,
                      textTransform: "uppercase",
                      marginBottom: 7,
                    }}
                  >
                    AI 阵容
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {[...pickedAI].map((id) => (
                      <span
                        key={id}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          padding: "3px 8px 3px 3px",
                          borderRadius: 14,
                          background: "rgba(255,255,255,0.10)",
                        }}
                      >
                        <WAIBadge id={id} size={16} radius={4} />
                        <span style={{ fontSize: 11, color: "#fff" }}>
                          {W_AGENTS.find((x) => x.id === id)?.name}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {createErr && (
                <div
                  style={{
                    marginTop: 12,
                    padding: "9px 12px",
                    borderRadius: 8,
                    background: "rgba(239,68,68,0.10)",
                    boxShadow: "inset 0 0 0 0.5px rgba(239,68,68,0.30)",
                    color: "#FCA5A5",
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}
                >
                  {createErr}
                </div>
              )}
              <WButton
                variant="primary"
                size="lg"
                iconRight="arr-r"
                full
                style={{ marginTop: 14 }}
                onClick={handleStart}
                disabled={creating}
              >
                {creating ? "创建中..." : "开始会议"}
              </WButton>
              <button
                type="button"
                style={{
                  width: "100%",
                  marginTop: 8,
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  color: "rgba(255,255,255,0.55)",
                  fontSize: 12,
                  padding: "8px",
                }}
              >
                + 录入新人声纹
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function ModeOption({
  on,
  onClick,
  title,
  sub,
  icon,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  sub: string;
  icon: "users" | "sparkle";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "12px 14px",
        borderRadius: 10,
        background: on ? "rgba(124,92,250,0.12)" : W_TOKENS.bg,
        boxShadow: on
          ? "inset 0 0 0 1px rgba(124,92,250,0.45)"
          : `inset 0 0 0 0.5px ${W_TOKENS.border}`,
        border: "none",
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        transition: "all 140ms ease",
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 7,
          background: on ? "rgba(124,92,250,0.20)" : "rgba(255,255,255,0.06)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <WIcon
          name={icon}
          size={15}
          color={on ? "#C4B5FD" : W_TOKENS.textSecondary}
        />
      </div>
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: on ? "#C4B5FD" : W_TOKENS.textPrimary,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: W_TOKENS.textMuted,
            marginTop: 3,
            lineHeight: 1.45,
          }}
        >
          {sub}
        </div>
      </div>
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          marginTop: 2,
          flexShrink: 0,
          background: on ? W_TOKENS.accent : "transparent",
          boxShadow: on
            ? "0 0 8px rgba(124,92,250,0.50)"
            : `inset 0 0 0 1.5px ${W_TOKENS.borderHover}`,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {on && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#fff",
            }}
          />
        )}
      </div>
    </button>
  );
}

function PickRow({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "8px 10px",
        borderRadius: 8,
        background: on ? "rgba(124,92,250,0.12)" : W_TOKENS.bg,
        boxShadow: on
          ? "inset 0 0 0 1px rgba(124,92,250,0.40)"
          : `inset 0 0 0 0.5px ${W_TOKENS.border}`,
        border: "none",
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
        display: "flex",
        alignItems: "center",
        gap: 9,
        width: "100%",
        transition: "all 120ms ease",
      }}
    >
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: 4,
          flexShrink: 0,
          background: on ? W_TOKENS.accent : "transparent",
          boxShadow: on
            ? "0 0 6px rgba(124,92,250,0.50)"
            : `inset 0 0 0 1.5px ${W_TOKENS.borderHover}`,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {on && <WIcon name="check" size={10} color="#fff" stroke={3} />}
      </div>
      {children}
    </button>
  );
}

function SummaryItem({
  icon,
  label,
  value,
}: {
  icon: "cal" | "bolt" | "target" | "users" | "sparkle";
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "7px 0",
        borderBottom: "0.5px solid rgba(255,255,255,0.06)",
      }}
    >
      <WIcon name={icon} size={13} color="rgba(255,255,255,0.50)" stroke={1.8} />
      <span
        style={{
          fontSize: 11.5,
          color: "rgba(255,255,255,0.55)",
          flex: "0 0 60px",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 13,
          color: "#fff",
          flex: 1,
          textAlign: "right",
          fontWeight: 500,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function FormLabel({
  children,
  noMb,
  style: extra,
}: {
  children: ReactNode;
  noMb?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: W_TOKENS.textMuted,
        letterSpacing: 0.5,
        textTransform: "uppercase",
        marginBottom: noMb ? 0 : 8,
        ...extra,
      }}
    >
      {children}
    </div>
  );
}

const inputBig: CSSProperties = {
  width: "100%",
  height: 44,
  padding: "0 14px",
  borderRadius: 9,
  background: W_TOKENS.bg,
  color: W_TOKENS.textPrimary,
  boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
  border: "none",
  outline: "none",
  fontFamily: "inherit",
  fontSize: 15,
  boxSizing: "border-box",
};
const inputBase: CSSProperties = {
  height: 38,
  padding: "0 12px",
  borderRadius: 8,
  background: W_TOKENS.bg,
  color: W_TOKENS.textPrimary,
  boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
  border: "none",
  outline: "none",
  fontFamily: "inherit",
  fontSize: 13.5,
  boxSizing: "border-box",
};
