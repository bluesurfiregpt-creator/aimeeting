"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · 发言人筛选 sheet.
 *
 * 设计源 1:1: meeting-room.jsx:936-1034 (FilterSheet).
 *
 * 仅 UI (TD8); 筛选目标是 transcript view 本地 mock + 真实 lines.
 * 父级传 selected Set + counts (key → 发言条数).
 */

import type { ReactElement } from "react";

import {
  MOCK_AIS,
  MOCK_HOST,
  MRAIAvatar,
  MRHostAvatar,
  MRHumanAvatar,
  type MockAiId,
} from "../shared/avatars";
import MRIcon from "../shared/Icon";
import Sheet from "./Sheet";
import { MR_COLORS } from "./styles";

export type FilterSpeaker = {
  /** 唯一 key — page.tsx 用 "host" / agent_id / mock-AI key / speaker_name 都行 */
  key: string;
  /** 显示名 */
  name: string;
  /** 角色 / 副标题 */
  sub: string;
  /** 头像类型 — host = 同心圆 / ai = 渐变方形 / human = 圆形 */
  kind: "host" | "ai" | "human";
  /** human 用 color (个人色); ai 用 agentColor 或 grad */
  color?: string;
  agentColor?: string | null;
  grad?: [string, string];
};

type Props = {
  open: boolean;
  /** 当前选中 */
  selected: Set<string>;
  /** 每个 speaker 的发言条数 */
  counts: Record<string, number>;
  /** 全 speaker 数据 — 父级聚合 */
  speakers: { hosts: FilterSpeaker[]; humans: FilterSpeaker[]; ais: FilterSpeaker[] };
  onChange: (next: Set<string>) => void;
  onClose: () => void;
};

export default function FilterSheet({
  open,
  selected,
  counts,
  speakers,
  onChange,
  onClose,
}: Props): ReactElement | null {
  const toggle = (k: string) => {
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onChange(next);
  };
  const clear = () => onChange(new Set());

  const renderRow = (sp: FilterSpeaker, i: number, total: number) => {
    const sel = selected.has(sp.key);
    const count = counts[sp.key] || 0;
    let avatar: ReactElement;
    if (sp.kind === "host") {
      avatar = <MRHostAvatar size={30} />;
    } else if (sp.kind === "ai") {
      avatar = <MRAIAvatar agentColor={sp.agentColor} grad={sp.grad} size={30} />;
    } else {
      avatar = (
        <MRHumanAvatar
          name={sp.name}
          color={sp.color || "#5E5CE6"}
          size={30}
        />
      );
    }
    return (
      <button
        type="button"
        key={sp.key}
        onClick={() => toggle(sp.key)}
        data-testid="mobile-filter-row"
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "9px 14px",
          borderTop: i === 0 ? "none" : `0.5px solid ${MR_COLORS.hairline}`,
          background: "transparent",
          border: "none",
          fontFamily: "inherit",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        {avatar}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 500,
              color: MR_COLORS.textPrimary,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {sp.name}
          </div>
          <div
            style={{
              fontSize: 12,
              color: MR_COLORS.textTertiary,
              marginTop: 1,
            }}
          >
            {sp.sub} · {count} 条发言
          </div>
        </div>
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: sel ? MR_COLORS.systemBlue : "transparent",
            border: sel ? "none" : `1.5px solid ${MR_COLORS.textQuaternary}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {sel ? <MRIcon name="check" size={14} color="#fff" /> : null}
        </div>
      </button>
    );
  };

  const Section = ({
    title,
    items,
  }: {
    title: string;
    items: FilterSpeaker[];
  }) => {
    if (items.length === 0) return null;
    return (
      <div style={{ marginTop: 14 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: MR_COLORS.textTertiary,
            letterSpacing: 0.3,
            padding: "0 4px 6px",
          }}
        >
          {title}
        </div>
        <div
          style={{
            background: MR_COLORS.bgWhite,
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {items.map((sp, i) => renderRow(sp, i, items.length))}
        </div>
      </div>
    );
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="筛选发言"
      maxHeight="84%"
      leftAction={{
        label: "清空",
        onClick: clear,
        disabled: selected.size === 0,
      }}
      testid="mobile-filter-sheet"
    >
      <div
        style={{
          fontSize: 12,
          color: MR_COLORS.textTertiary,
          lineHeight: 1.5,
          padding: "0 4px",
        }}
      >
        勾选 1 人或多人, timeline 仅显示其发言. 会议中和会后归档都可用.
      </div>
      <Section title="主持人" items={speakers.hosts} />
      <Section
        title={`团队成员 · ${speakers.humans.length} 人`}
        items={speakers.humans}
      />
      <Section
        title={`AI 专家 · ${speakers.ais.length} 位`}
        items={speakers.ais}
      />
    </Sheet>
  );
}

/** 便利工具: 把 mock 6 AI 转成 FilterSpeaker[]. */
export function mockAisAsSpeakers(): FilterSpeaker[] {
  return (Object.keys(MOCK_AIS) as MockAiId[]).map((k) => {
    const a = MOCK_AIS[k];
    return {
      key: `mock-${k}`,
      name: a.name,
      sub: a.role,
      kind: "ai",
      grad: a.grad,
    };
  });
}

/** Host (Mira) — 在所有 saga 内统一 key = 'host' */
export function mockHostAsSpeaker(): FilterSpeaker {
  return {
    key: "host",
    name: MOCK_HOST.name,
    sub: MOCK_HOST.role,
    kind: "host",
  };
}
