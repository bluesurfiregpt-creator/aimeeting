"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · 议程切换分隔符.
 *
 * 设计源 1:1: meeting-room.jsx:254-286.
 *
 * R4 mitigation: bundle 用正则从 message body 抽议程编号 + title, 我们直接
 * 拿 page.tsx 推下来的 fromIdx/toIdx/title/total/agendaMinutes 字段, 不解析文本.
 */

import type { ReactElement } from "react";

import { MR_COLORS } from "./styles";

export type ChapterDividerData = {
  /** 新议程 (1-based) — toIdx + 1, 显示在分隔符上 */
  newAgendaNumber: number;
  /** 总议程数 */
  totalAgenda: number;
  /** 新议程 title */
  newAgendaTitle: string;
  /** 新议程时长 (分钟). null = 不显 */
  agendaMinutes: number | null;
  /** 切换时间 ("23:02" 风格) */
  t: string;
};

type Props = {
  data: ChapterDividerData;
};

export default function ChapterDivider({ data }: Props): ReactElement {
  return (
    <div style={{ padding: "22px 16px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, height: 0.5, background: MR_COLORS.separator }} />
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: MR_COLORS.textTertiary,
            letterSpacing: 0.8,
            textTransform: "uppercase",
          }}
        >
          议程 {data.newAgendaNumber} / {data.totalAgenda}
        </span>
        <div style={{ flex: 1, height: 0.5, background: MR_COLORS.separator }} />
      </div>
      <div
        style={{
          textAlign: "center",
          fontSize: 17,
          fontWeight: 700,
          color: MR_COLORS.textPrimary,
          marginTop: 8,
          letterSpacing: -0.2,
        }}
      >
        {data.newAgendaTitle}
      </div>
      <div
        style={{
          textAlign: "center",
          fontSize: 12,
          color: MR_COLORS.textTertiary,
          marginTop: 4,
          display: "inline-flex",
          justifyContent: "center",
          gap: 8,
          width: "100%",
        }}
      >
        {data.agendaMinutes !== null ? (
          <>
            <span>{data.agendaMinutes} 分钟</span>
            <span>·</span>
          </>
        ) : null}
        {data.newAgendaNumber > 1 ? (
          <>
            <span style={{ color: MR_COLORS.systemGreen, fontWeight: 600 }}>
              议程 {data.newAgendaNumber - 1} 完成 ✓
            </span>
            <span>·</span>
          </>
        ) : null}
        <span>{data.t}</span>
      </div>
    </div>
  );
}
