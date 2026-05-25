"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · round-3 · 资料 内嵌 inline 渲染.
 *
 * 用于 /m/meetings/new (edit 模式) + /m/meetings/[id]/summary (readonly 模式).
 *
 * 设计源 (推断):
 *   round-3 设计稿 (docs/design/handoffs/2026-05-25-meeting-room-r3/aimeeting/project/
 *   meeting-room-materials.jsx) 主要 给 会议室页 — 用 MaterialsStrip + MaterialsSheet
 *   分两段 (紧凑条 + 展开 sheet). new / summary 页 没专门设计, PM 要求 "三个页面
 *   视觉统一在 round-3", 这里 把 MaterialsSheet 的 list / upload tile 视觉 拆出
 *   inline 渲染 — 不带 sheet 容器, 直接 显在 form / 页面 流里.
 *
 * 视觉:
 *   - 浅色 iOS 风 (MR_COLORS) — white 卡片 / iOS hairline / 系统蓝
 *   - FileGlyph (4 色折角文档) + 文件名 + 上传人/time/size + extract_status pill
 *   - edit 模式: 顶部 上传 tile (虚框 蓝边) + 文件列表 + 删按钮 + 微信 picker (在小程序内)
 *   - readonly 模式: 仅 文件列表 (无上传, 无删, 但 文件可点 preview)
 *
 * 行为:
 *   - 文件点击 → FilePreview (全屏 暗色) overlay
 *   - + 添加文件 → UploadSheet (bottom sheet)
 *   - 微信 picker → wx.miniProgram.navigateTo
 *   - 删 → confirm + DELETE
 *
 * 自管:
 *   - 拉 attachments (draftId / meetingId 二选一)
 *   - 5s 轮询 extracting / pending
 *   - visibility-change 重拉 (小程序 picker 跳回)
 *
 * NOTE: 这是 v1.2.0 Saga 把 三页面 视觉 统一在 round-3 的产物 — AttachmentsSection
 *       已 标 @deprecated, 新页面 不再 用它.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";

import { mApi } from "@/lib/mobile/api";
import type { MeetingAttachmentOut } from "@/lib/mobile/types";

import MRIcon from "../MRIcon";
import { MR_COLORS, useInjectAnimations } from "../styles";

import FileGlyph, { FILE_TYPES } from "./FileGlyph";
import FilePreview from "./FilePreview";
import UploadSheet from "./UploadSheet";
import {
  adaptAttachmentsToMaterials,
  type Material,
} from "./types";

type Mode = "edit" | "readonly";

type Props = {
  /** 父组件 owned draft uuid (创建会议前). draftId / meetingId 二选一. */
  draftId?: string;
  /** 已创建会议 id (总结页). */
  meetingId?: string;
  /** 渲染模式: edit (新建页) / readonly (总结页). */
  mode?: Mode;
  /** 父监听 数量变化 (例: AI 拆议程 用了 N 份附件). */
  onAttachmentsChange?: (count: number) => void;
};

function isInMiniprogram(): boolean {
  if (typeof window === "undefined") return false;
  const env = (window as unknown as { __wxjs_environment?: string })
    .__wxjs_environment;
  return env === "miniprogram";
}

export default function MaterialsInline({
  draftId,
  meetingId,
  mode = "edit",
  onAttachmentsChange,
}: Props): ReactElement | null {
  // 注入本 Saga keyframes — UploadSheet / FilePreview 用 mr-fadeIn / mr-slideUp
  useInjectAnimations();

  const [attachments, setAttachments] = useState<MeetingAttachmentOut[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [previewing, setPreviewing] = useState<Material | null>(null);
  const inMp = isInMiniprogram();

  const refresh = useCallback(async () => {
    try {
      if (meetingId) {
        const r = await mApi.listMeetingAttachments(meetingId);
        setAttachments(r.items);
        onAttachmentsChange?.(r.items.length);
      } else if (draftId) {
        const r = await mApi.listDraftAttachments(draftId);
        setAttachments(r.items);
        onAttachmentsChange?.(r.items.length);
      }
    } catch (e) {
      console.warn("materials inline refresh failed", e);
    }
  }, [draftId, meetingId, onAttachmentsChange]);

  // mount 拉一次
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // visibility-change → 小程序 picker 跳回 H5 重拉
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refresh]);

  // 5s 轮询 — 有 extracting / pending 时 重拉
  useEffect(() => {
    const hasExtracting = attachments.some(
      (a) => a.extract_status === "extracting" || a.extract_status === "pending",
    );
    if (!hasExtracting) return;
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [attachments, refresh]);

  // backend → 设计稿 数据 适配
  const materials: Material[] = useMemo(
    () => adaptAttachmentsToMaterials(attachments),
    [attachments],
  );

  const handleDelete = useCallback(
    async (aid: string, filename: string) => {
      if (typeof window === "undefined") return;
      if (!window.confirm(`确定要删除 「${filename}」 吗?`)) return;
      try {
        await mApi.deleteMeetingAttachment(aid);
        await refresh();
      } catch (e) {
        setError(
          `删除失败: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
    [refresh],
  );

  const handlePickFromWechat = useCallback(() => {
    if (!draftId && !meetingId) {
      setError("缺少 draft_id / meeting_id, 无法触发小程序 picker");
      return;
    }
    const wx = (
      window as unknown as {
        wx?: {
          miniProgram?: {
            navigateTo: (opts: { url: string }) => void;
          };
        };
      }
    ).wx;
    if (!wx?.miniProgram?.navigateTo) {
      setError("当前不在小程序环境 — 请用 + 添加文件 按钮上传");
      return;
    }
    const qs = new URLSearchParams();
    if (draftId) qs.set("draft_id", draftId);
    if (meetingId) qs.set("meeting_id", meetingId);
    wx.miniProgram.navigateTo({
      url: `/pages/picker/picker?${qs.toString()}`,
    });
  }, [draftId, meetingId]);

  // readonly + 0 附件 → 整块不显 (跟旧 AttachmentsSection 一致行为)
  if (mode === "readonly" && attachments.length === 0) {
    return null;
  }

  const previewAttachment = previewing
    ? attachments.find((a) => a.id === previewing.id)
    : null;

  return (
    <section data-testid="materials-inline">
      {/* 标题行 — 跟 round-3 sheet 顶 title 调性一致, 但是 inline 不带 sheet 包装 */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          paddingLeft: 2,
          paddingRight: 2,
        }}
      >
        <h2
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: MR_COLORS.textPrimary,
            margin: 0,
          }}
        >
          参考资料{" "}
          {materials.length > 0 ? (
            <span
              style={{ fontSize: 13, color: MR_COLORS.textTertiary }}
            >
              · {materials.length}
            </span>
          ) : (
            <span
              style={{ fontSize: 12, color: MR_COLORS.textTertiary }}
            >
              · {mode === "edit" ? "选填" : "0 份"}
            </span>
          )}
        </h2>
        {mode === "edit" ? (
          <span style={{ fontSize: 11, color: MR_COLORS.textTertiary }}>
            ≤ 50MB / 份
          </span>
        ) : null}
      </div>

      {/* 上传 tile — 仅 edit 模式 */}
      {mode === "edit" ? (
        <button
          type="button"
          onClick={() => setUploadOpen(true)}
          data-testid="materials-inline-upload"
          style={{
            marginTop: 8,
            width: "100%",
            padding: "12px 14px",
            background: MR_COLORS.bgWhite,
            border: `1px dashed rgba(0,122,255,0.35)`,
            borderRadius: 12,
            fontFamily: "inherit",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 12,
            textAlign: "left",
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "rgba(0,122,255,0.10)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 5v14M5 12h14"
                stroke={MR_COLORS.systemBlue}
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: MR_COLORS.systemBlue,
              }}
            >
              {materials.length > 0 ? "添加更多资料" : "上传参考资料"}
            </div>
            <div
              style={{
                fontSize: 11.5,
                color: MR_COLORS.textTertiary,
                marginTop: 1,
              }}
            >
              PDF / Word / Excel / PPT · 单文件最大 50MB
            </div>
          </div>
        </button>
      ) : null}

      {/* 微信 picker — 仅 小程序 内 + edit 模式 */}
      {mode === "edit" && inMp ? (
        <button
          type="button"
          onClick={handlePickFromWechat}
          data-testid="materials-inline-wechat-picker"
          style={{
            marginTop: 8,
            width: "100%",
            padding: "10px 14px",
            background: `rgba(7,193,96,0.10)`,
            border: "none",
            borderRadius: 12,
            fontFamily: "inherit",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 10,
            textAlign: "left",
            color: MR_COLORS.wechatGreen,
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          <span style={{ fontSize: 16 }}>💬</span>
          <span>从 微信聊天记录 选</span>
        </button>
      ) : null}

      {/* 文件列表 — 白卡 + iOS hairline */}
      {materials.length > 0 ? (
        <div
          style={{
            marginTop: mode === "edit" ? 10 : 8,
            background: MR_COLORS.bgWhite,
            borderRadius: 12,
            overflow: "hidden",
            border: `0.5px solid ${MR_COLORS.hairline}`,
          }}
        >
          {materials.map((f, i) => (
            <MaterialRow
              key={f.id}
              f={f}
              last={i === materials.length - 1}
              onClick={() => setPreviewing(f)}
              onDelete={
                mode === "edit"
                  ? () => void handleDelete(f.id, f.name)
                  : undefined
              }
              readOnly={mode === "readonly"}
            />
          ))}
        </div>
      ) : null}

      {/* 提示 — 仅 edit 模式 */}
      {mode === "edit" && materials.length === 0 ? (
        <p
          style={{
            marginTop: 8,
            paddingLeft: 2,
            fontSize: 12,
            lineHeight: 1.5,
            color: MR_COLORS.textTertiary,
          }}
        >
          上传后 AI 拆议程 + 自主讨论 会读取这些内容.
          {inMp ? "" : " 小程序里 可用 「💬 从 微信聊天记录 选」 添加."}
        </p>
      ) : null}

      {/* 错误 */}
      {error ? (
        <p
          style={{
            marginTop: 8,
            paddingLeft: 2,
            fontSize: 12,
            color: MR_COLORS.systemRed,
          }}
        >
          {error}
        </p>
      ) : null}

      {/* Upload sheet — 跟会议室 同一个 sheet 复用 */}
      {mode === "edit" ? (
        <UploadSheet
          open={uploadOpen}
          draftId={draftId}
          meetingId={meetingId}
          onClose={() => setUploadOpen(false)}
          onComplete={() => void refresh()}
        />
      ) : null}

      {/* 全屏 预览 overlay — 跟会议室 同一个 preview */}
      {previewing && previewAttachment ? (
        <FilePreview
          file={previewing}
          attachmentId={previewing.id}
          extractSummary={previewAttachment.extract_summary}
          extractStatus={previewAttachment.extract_status}
          onClose={() => setPreviewing(null)}
        />
      ) : null}
    </section>
  );
}

/**
 * 单行 — 复用 MaterialsSheet 内的 视觉, 但去掉 sheet 容器, 让父组件 inline 直接渲染.
 */
function MaterialRow({
  f,
  last,
  onClick,
  onDelete,
  readOnly,
}: {
  f: Material;
  last: boolean;
  onClick: () => void;
  onDelete?: () => void;
  readOnly: boolean;
}): ReactElement {
  const meta = FILE_TYPES[f.type] || FILE_TYPES.other;
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "11px 14px",
        borderBottom: last ? "none" : `0.5px solid ${MR_COLORS.hairline}`,
        cursor: "pointer",
        WebkitTapHighlightColor: "rgba(0,0,0,0.04)",
      }}
    >
      <FileGlyph type={f.type} size={34} ring="transparent" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: MR_COLORS.textPrimary,
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
              flexShrink: 1,
            }}
          >
            {f.name}
          </span>
          {f.pinned ? (
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                color: meta.color,
                background: meta.accent,
                padding: "1px 5px",
                borderRadius: 3,
                letterSpacing: 0.3,
                flexShrink: 0,
              }}
            >
              主提案
            </span>
          ) : null}
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: MR_COLORS.textTertiary,
            marginTop: 2,
            display: "flex",
            alignItems: "center",
            gap: 5,
            flexWrap: "wrap",
          }}
        >
          <span>{f.size}</span>
          {f.extractStatus && f.extractStatus !== "ready" ? (
            <>
              <span>·</span>
              <ExtractStatusTag status={f.extractStatus} />
            </>
          ) : f.extractStatus === "ready" ? (
            <>
              <span>·</span>
              <ExtractStatusTag status="ready" />
            </>
          ) : null}
        </div>
        {f.extractStatus === "failed" && f.lastError ? (
          <p
            style={{
              marginTop: 4,
              fontSize: 11,
              color: MR_COLORS.systemRed,
              lineHeight: 1.4,
            }}
          >
            {f.lastError.slice(0, 100)}
          </p>
        ) : null}
      </div>
      {!readOnly && onDelete ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label={`删除 ${f.name}`}
          style={{
            background: "none",
            border: "none",
            padding: "0 4px",
            color: MR_COLORS.textTertiary,
            fontSize: 22,
            cursor: "pointer",
            flexShrink: 0,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      ) : (
        <MRIcon name="chev" size={16} color={MR_COLORS.textQuaternary} />
      )}
    </div>
  );
}

/**
 * extract_status 小 pill — 跟 MaterialsSheet 内的 ExtractStatusTag 视觉一致.
 * ready 在 inline 也显 (跟 sheet 内不同 — sheet 不显 ready, 因为 用户不关心已就绪的状态).
 * 这里 inline 显 是给用户 "AI 已读" 的反馈.
 */
function ExtractStatusTag({ status }: { status: string }): ReactElement {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    pending: { label: "上传中", color: "#3C3C43", bg: "#E5E5EA" },
    extracting: {
      label: "抽取中",
      color: MR_COLORS.systemPurple,
      bg: "rgba(94,92,230,0.10)",
    },
    ready: {
      label: "✓ 就绪",
      color: MR_COLORS.systemGreen,
      bg: "rgba(52,199,89,0.10)",
    },
    failed: {
      label: "抽取失败",
      color: MR_COLORS.systemRed,
      bg: "rgba(255,59,48,0.10)",
    },
    skipped: {
      label: "未识别",
      color: MR_COLORS.textTertiary,
      bg: MR_COLORS.bgGroupedPrimary,
    },
  };
  const meta = map[status];
  if (!meta) return <span>{status}</span>;
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        color: meta.color,
        background: meta.bg,
        padding: "1px 5px",
        borderRadius: 3,
      }}
    >
      {meta.label}
    </span>
  );
}
