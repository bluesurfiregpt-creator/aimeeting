"use client";

/**
 * R5.D Web 会议室 modals:
 *  - MRFilterModal — 居中, 640px, 3 段: 主持人 / 团队成员 / AI 专家. Checkbox 风格.
 *  - MREndModal    — 380px 确认弹窗, "结束并返回首页"
 *
 * 设计源: `meeting-room-web.jsx:1265-1402`.
 */

import { useRouter } from "next/navigation";
import {
  MR_HOST,
  MR_HUMANS_IN_MEETING,
  MR_AGENTS_IN_MEETING,
  MR_AI_IDS,
  mrSpeakerLabel,
} from "./data";
import {
  MRSpeakerAvatar,
  MRIcon,
} from "./atoms";
import { MR_TOKENS } from "./tokens";

// ────────────── Filter Modal ──────────────
export function MRFilterModal({
  open,
  selected,
  onChange,
  onClose,
  counts,
}: {
  open: boolean;
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
  onClose: () => void;
  counts: Record<string, number>;
}) {
  if (!open) return null;
  const toggle = (k: string) => {
    const n = new Set(selected);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    onChange(n);
  };

  const Section = ({ title, keys }: { title: string; keys: string[] }) => (
    <div style={{ marginTop: 18 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: MR_TOKENS.fgTertiary,
          letterSpacing: 0.4,
          padding: "0 4px 8px",
        }}
      >
        {title}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
        }}
      >
        {keys.map((k) => {
          const sel = selected.has(k);
          const sub =
            k === "host"
              ? MR_HOST.role
              : MR_HUMANS_IN_MEETING[k]
                ? MR_HUMANS_IN_MEETING[k].role
                : MR_AGENTS_IN_MEETING[k]
                  ? MR_AGENTS_IN_MEETING[k].roleShort
                  : "";
          return (
            <div
              key={k}
              onClick={() => toggle(k)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 11px",
                borderRadius: 10,
                background: sel ? "rgba(0,122,255,0.08)" : MR_TOKENS.bgSubtle,
                border: sel
                  ? "0.5px solid rgba(0,122,255,0.35)"
                  : "0.5px solid transparent",
                cursor: "pointer",
              }}
            >
              <MRSpeakerAvatar k={k} size={30} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: MR_TOKENS.fgPrimary }}>
                  {mrSpeakerLabel(k)}
                </div>
                <div style={{ fontSize: 11, color: MR_TOKENS.fgTertiary }}>
                  {sub} · {counts[k] || 0} 条
                </div>
              </div>
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 5,
                  background: sel ? "#007AFF" : MR_TOKENS.bgSurface,
                  border: sel ? "none" : `1.5px solid ${MR_TOKENS.fgQuaternary}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {sel && <MRIcon name="check" size={13} color="#fff" />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const humanKeys = Object.keys(MR_HUMANS_IN_MEETING);
  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.32)",
          zIndex: 80,
          animation: "mrFadeIn 180ms ease",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: 640,
          maxHeight: "80%",
          background: MR_TOKENS.bgSurface,
          borderRadius: 14,
          zIndex: 81,
          boxShadow: MR_TOKENS.shadowModal,
          display: "flex",
          flexDirection: "column",
          animation: "mrPopIn 200ms cubic-bezier(.22,.61,.36,1)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: MR_TOKENS.borderHair,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 700, color: MR_TOKENS.fgPrimary }}>筛选发言</div>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              border: "none",
              background: MR_TOKENS.bgChip,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <MRIcon name="close" size={14} color={MR_TOKENS.fgPrimary} />
          </button>
        </div>
        <div className="mr-scroll" style={{ padding: "6px 20px 20px", overflow: "auto" }}>
          <div
            style={{
              fontSize: 12,
              color: MR_TOKENS.fgTertiary,
              padding: "10px 4px 0",
              lineHeight: 1.5,
            }}
          >
            勾选 1 人或多人,timeline 仅显示其发言。会议中和会后归档共用一套筛选规则。
          </div>
          <Section title="主持人" keys={["host"]} />
          <Section
            title={`团队成员 · ${humanKeys.length} 人`}
            keys={humanKeys}
          />
          <Section
            title={`AI 专家 · ${MR_AI_IDS.length} 位`}
            keys={[...MR_AI_IDS]}
          />
        </div>
        <div
          style={{
            padding: "12px 20px",
            borderTop: MR_TOKENS.borderHair,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <button
            type="button"
            onClick={() => onChange(new Set())}
            disabled={selected.size === 0}
            style={{
              background: "none",
              border: "none",
              color: selected.size === 0 ? MR_TOKENS.fgQuaternary : "#007AFF",
              fontSize: 14,
              fontFamily: "inherit",
              cursor: selected.size === 0 ? "default" : "pointer",
            }}
          >
            清空选择
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              height: 34,
              padding: "0 18px",
              borderRadius: 8,
              background: "#007AFF",
              color: "#fff",
              border: "none",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            完成 · 已选 {selected.size}
          </button>
        </div>
      </div>
    </>
  );
}

// ────────────── End Modal ──────────────
export function MREndModal({
  open,
  onCancel,
}: {
  open: boolean;
  onCancel: () => void;
}) {
  const router = useRouter();
  if (!open) return null;
  return (
    <>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          zIndex: 90,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: 380,
          zIndex: 91,
          background: MR_TOKENS.bgSurface,
          borderRadius: 14,
          boxShadow: MR_TOKENS.shadowModal,
          overflow: "hidden",
          animation: "mrPopIn 200ms cubic-bezier(.22,.61,.36,1)",
        }}
      >
        <div style={{ padding: "22px 22px 18px" }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: MR_TOKENS.fgPrimary }}>结束会议?</div>
          <div
            style={{
              fontSize: 13,
              color: MR_TOKENS.fgSecondary,
              marginTop: 8,
              lineHeight: 1.5,
            }}
          >
            主持人 Mira 会自动整理 AI 摘要、决策项与行动项,完成后发给所有参会成员,也会沉淀到会议历史。
          </div>
        </div>
        <div style={{ display: "flex", borderTop: MR_TOKENS.borderHair }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              flex: 1,
              height: 48,
              background: "none",
              border: "none",
              color: "#007AFF",
              fontSize: 14,
              fontFamily: "inherit",
              cursor: "pointer",
              borderRight: MR_TOKENS.borderHair,
            }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              router.push("/");
            }}
            style={{
              flex: 1,
              height: 48,
              background: "#FFF1F0",
              border: "none",
              color: "#FF3B30",
              fontSize: 14,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            结束并返回首页
          </button>
        </div>
      </div>
    </>
  );
}
