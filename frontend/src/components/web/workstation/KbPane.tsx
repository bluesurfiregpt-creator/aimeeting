"use client";

import { useState } from "react";
import { W_TOKENS } from "../tokens";
import {
  WIcon,
  WPill,
  WAIBadge,
  WButton,
  WCard,
  WModal,
} from "../atoms";
import { W_AGENTS } from "../data/agents";
import { W_KBS, type WKB, type WKBDoc } from "../data/kbs";
import { PaneHeader } from "./PaneHeader";

/**
 * 知识库 pane — R5.C.
 *
 * 来自 round-6 设计稿 KBPane:
 *  - "+ 新建知识库" CTA (mock)
 *  - grid (auto-fill, minmax(380px, 1fr)) - KBCard
 *  - 每卡: book icon + 名/sub + 关联 AI + 文档数 + 分块数
 *  - 点卡 → mock modal 显示文档列表 (各文档 type / size / pages / cited)
 *
 * **后续 Saga**: 接 backend kb / chunks API.
 */
export function KbPane() {
  const [openKB, setOpenKB] = useState<WKB | null>(null);

  return (
    <>
      <PaneHeader
        title="知识库 · 书架"
        sub="把业务文档 (PDF / Word / Excel / Markdown) 上传到知识库,AI 专家在会议中回答时会优先引用这里的内容。每个工作空间独立。"
        action={
          <WButton variant="primary" size="md" icon="plus">
            新建知识库
          </WButton>
        }
      />

      <div
        style={{
          marginBottom: 12,
          fontSize: 12,
          color: W_TOKENS.textMuted,
        }}
      >
        已有知识库 ({W_KBS.length}) · 我管理 (
        {W_KBS.filter((k) => k.byMe).length})
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
          gap: 12,
        }}
      >
        {W_KBS.map((kb) => (
          <KBCard key={kb.id} kb={kb} onOpen={() => setOpenKB(kb)} />
        ))}
      </div>

      <WModal open={!!openKB} onClose={() => setOpenKB(null)} maxWidth={760}>
        {openKB && <KBDetailModal kb={openKB} onClose={() => setOpenKB(null)} />}
      </WModal>
    </>
  );
}

function KBCard({ kb, onOpen }: { kb: WKB; onOpen: () => void }) {
  const owner = W_AGENTS.find((x) => x.id === kb.owner);
  const blocks = kb.docs.reduce((s, d) => s + d.blocks, 0);
  return (
    <WCard hover padding={16} onClick={onOpen}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: "rgba(124,92,250,0.10)",
            boxShadow: "inset 0 0 0 0.5px rgba(124,92,250,0.30)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <WIcon name="book" size={18} color="#C4B5FD" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <h3
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 700,
                color: W_TOKENS.textPrimary,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {kb.name}
            </h3>
            {kb.byMe && (
              <WPill tone="accent" size="sm">
                我管理
              </WPill>
            )}
          </div>
          <div
            style={{
              fontSize: 12,
              color: W_TOKENS.textMuted,
              marginTop: 4,
              lineHeight: 1.5,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {kb.sub}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              marginTop: 10,
              flexWrap: "wrap",
            }}
          >
            {owner && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "2px 8px 2px 3px",
                  borderRadius: 5,
                  background: "rgba(255,255,255,0.04)",
                  boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
                  fontSize: 11,
                  color: W_TOKENS.textSecondary,
                }}
              >
                <WAIBadge id={kb.owner} size={16} />
                {owner.name}
              </span>
            )}
            <WPill tone="neutral" icon="doc">
              {kb.docs.length} 文档
            </WPill>
            <WPill tone="neutral">{blocks} 分块</WPill>
            <span
              style={{
                fontSize: 10.5,
                color: W_TOKENS.textFaint,
                marginLeft: "auto",
              }}
            >
              更新 {kb.updated}
            </span>
          </div>
        </div>
      </div>
    </WCard>
  );
}

function KBDetailModal({ kb, onClose }: { kb: WKB; onClose: () => void }) {
  const owner = W_AGENTS.find((x) => x.id === kb.owner);
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 18 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 11,
            background: "rgba(124,92,250,0.14)",
            boxShadow: "inset 0 0 0 0.5px rgba(124,92,250,0.30)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <WIcon name="book" size={22} color="#C4B5FD" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 700,
              color: W_TOKENS.textPrimary,
              letterSpacing: -0.2,
            }}
          >
            {kb.name}
          </h2>
          <div
            style={{
              fontSize: 13,
              color: W_TOKENS.textMuted,
              marginTop: 5,
              lineHeight: 1.5,
            }}
          >
            {kb.sub}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              marginTop: 10,
              flexWrap: "wrap",
            }}
          >
            {owner && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 12,
                  color: W_TOKENS.textSecondary,
                }}
              >
                <WAIBadge id={kb.owner} size={18} />
                关联 {owner.name}
              </span>
            )}
            <WPill tone="neutral">
              {kb.docs.length} 文档 · {kb.docs.reduce((s, d) => s + d.blocks, 0)} 分块
            </WPill>
          </div>
        </div>
        <WButton variant="ghost" size="sm" onClick={onClose}>
          ×
        </WButton>
      </div>

      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: W_TOKENS.textMuted,
          letterSpacing: 0.5,
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        文档列表
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {kb.docs.map((d) => (
          <DocRow key={d.id} d={d} />
        ))}
      </div>

      <div
        style={{
          marginTop: 22,
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
        }}
      >
        <WButton variant="ghost" size="md" onClick={onClose}>
          关闭
        </WButton>
        <WButton variant="primary" size="md" icon="plus">
          上传文档
        </WButton>
      </div>
    </div>
  );
}

type DocTone = "accent" | "cyan" | "pink" | "warn" | "neutral" | "success";
const TYPE_TONE: Record<WKBDoc["type"], DocTone> = {
  pdf: "warn", // pdf 用 warn (黄), 避免太突兀
  word: "cyan",
  excel: "success",
  md: "accent",
  txt: "neutral",
  ppt: "pink",
};

function DocRow({ d }: { d: WKBDoc }) {
  const tone: DocTone = TYPE_TONE[d.type] || "neutral";
  const meta =
    d.pages !== undefined
      ? `${d.pages} 页 · ${d.size}`
      : d.rows !== undefined
      ? `${d.rows} 行 · ${d.size}`
      : d.size;
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 8,
        background: W_TOKENS.surfaceRaised,
        boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          background: "rgba(255,255,255,0.04)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <WIcon name="doc" size={13} color={W_TOKENS.textMuted} />
      </div>
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
          {d.name}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            marginTop: 3,
            fontSize: 11,
            color: W_TOKENS.textMuted,
          }}
        >
          <WPill tone={tone} size="sm">
            {d.type.toUpperCase()}
          </WPill>
          <span>{meta}</span>
          <span>·</span>
          <span>{d.blocks} 分块</span>
          <span>·</span>
          <span>{d.uploadedWhen}</span>
        </div>
      </div>
      <div
        style={{
          fontSize: 11,
          color: W_TOKENS.textMuted,
          flexShrink: 0,
          textAlign: "right",
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#C4B5FD",
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {d.citedTimes}
        </div>
        <div style={{ fontSize: 10, marginTop: 3 }}>引用</div>
      </div>
    </div>
  );
}
