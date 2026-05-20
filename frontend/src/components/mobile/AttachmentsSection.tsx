"use client";

/**
 * v27.0-mobile P19-B · 会议参考资料 上传区.
 *
 * 用于 /m/meetings/new 创建页 + (后续) /m/meetings/[id] 详情页追加附件.
 *
 * 双端兼容:
 *   - 普通浏览器 / 微信外: `<input type="file" multiple>` 标准 上传
 *   - 小程序 web-view 内 (检测 `__wxjs_environment === "miniprogram"` 或
 *     `window.__wxjs_environment === "miniprogram"`):
 *       显额外 按钮 "从 微信聊天记录 选" → 调 wx.miniProgram.navigateTo
 *       跳 小程序 原生 picker 页, 选完文件 上传到 同一个 后端 endpoint, 然后
 *       wx.navigateBack 回 web-view. 本 H5 页面 visibility-change 时 重拉
 *       GET /attachments?draft_id=... 同步.
 *
 * 状态管理:
 *   - draftId: 由父组件 owned (页面级 stable uuid, 跨多次上传 复用)
 *   - 内部 自己 拉 attachments 列表 (mount + visibility-change + 上传完都拉)
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { mApi } from "@/lib/mobile/api";
import type { MeetingAttachmentOut } from "@/lib/mobile/types";

type Props = {
  /** 父组件 owned 的 draft uuid. 不传 (创建会议后) 走 meetingId 路径. */
  draftId?: string;
  /** 已创建会议, 追加附件场景. draftId / meetingId 二选一. */
  meetingId?: string;
  /** 父组件 可监听 attachments 数变化 (例: 拆议程时 知道 用了 几份 附件) */
  onAttachmentsChange?: (count: number) => void;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "上传中…",
  extracting: "抽取中…",
  ready: "✓ 就绪",
  skipped: "⊘ 未识别",
  failed: "✗ 失败",
};

const STATUS_TONE: Record<string, string> = {
  pending: "bg-zinc-700 text-zinc-300",
  extracting: "bg-violet-500/15 text-violet-300",
  ready: "bg-emerald-500/15 text-emerald-300",
  skipped: "bg-zinc-700 text-zinc-400",
  failed: "bg-rose-500/15 text-rose-300",
};

const ACCEPT_ATTR =
  ".pdf,.docx,.xlsx,.xls,.txt,.md,.csv,.log,.json,.yaml,.yml," +
  ".jpg,.jpeg,.png,.bmp,.tiff,.tif,.webp,.gif";

// 单文件 50MB 上限 (跟后端 一致)
const MAX_BYTES = 50 * 1024 * 1024;

function formatSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function isInMiniprogram(): boolean {
  if (typeof window === "undefined") return false;
  // 小程序 web-view 内 注入: window.__wxjs_environment === "miniprogram"
  const env = (window as unknown as { __wxjs_environment?: string })
    .__wxjs_environment;
  return env === "miniprogram";
}

export default function AttachmentsSection({
  draftId,
  meetingId,
  onAttachmentsChange,
}: Props) {
  const [attachments, setAttachments] = useState<MeetingAttachmentOut[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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
      // 静默 — list 失败 不影响 上传
      console.warn("attachments refresh failed", e);
    }
  }, [draftId, meetingId, onAttachmentsChange]);

  // mount 拉一次
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // visibility-change → 从 小程序 picker 跳回 H5 时 重拉 (核心同步机制)
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refresh]);

  // 轮询 — 有 extracting 状态的 附件时 每 5 秒 重拉, 直到都 ready
  useEffect(() => {
    const hasExtracting = attachments.some(
      (a) => a.extract_status === "extracting" || a.extract_status === "pending",
    );
    if (!hasExtracting) return;
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [attachments, refresh]);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      if (uploading) return;
      setUploading(true);
      setError(null);
      try {
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          if (f.size > MAX_BYTES) {
            setError(`${f.name}: 文件超 50MB 上限`);
            continue;
          }
          await mApi.uploadMeetingAttachment(f, {
            client_draft_id: draftId,
            meeting_id: meetingId,
          });
        }
        await refresh();
      } catch (e) {
        setError(`上传失败: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [uploading, draftId, meetingId, refresh],
  );

  const handleDelete = useCallback(
    async (aid: string, filename: string) => {
      if (!confirm(`确定要删除 「${filename}」 吗?`)) return;
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

  /**
   * v27.0-mobile P19-B 小程序桥接:
   * 在小程序 web-view 里调 wx.miniProgram.navigateTo 跳到 picker 页.
   * 小程序 picker 用 wx.chooseMessageFile + wx.uploadFile 上传同一个后端 endpoint,
   * 完成后 wx.navigateBack 回 web-view, 本组件 visibility-change 自动 拉新列表.
   *
   * draftId 通过 query 传给 小程序 — picker 用它当上传 form key.
   */
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

  return (
    <section data-testid="attachments-section">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[14px] font-medium text-zinc-300">
          参考资料{" "}
          {attachments.length > 0 ? (
            <span className="text-[13px] text-zinc-500">
              · {attachments.length}
            </span>
          ) : (
            <span className="text-[12px] text-zinc-500">· 选填</span>
          )}
        </h2>
        <span className="text-[11px] text-zinc-500">≤ 50MB / 份</span>
      </div>

      {/* 文件列表 */}
      {attachments.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {attachments.map((att) => (
            <li
              key={att.id}
              className="rounded-xl border border-ink-800 bg-ink-900 p-3"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-[14px] font-medium text-zinc-100"
                    title={att.filename}
                  >
                    {att.filename}
                  </p>
                  <p className="mt-0.5 flex items-center gap-2 text-[12px] text-zinc-500">
                    <span className="tabular-nums">
                      {formatSize(att.size_bytes)}
                    </span>
                    <span>·</span>
                    <span
                      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${
                        STATUS_TONE[att.extract_status] || STATUS_TONE.pending
                      }`}
                    >
                      {STATUS_LABEL[att.extract_status] || att.extract_status}
                    </span>
                  </p>
                  {att.extract_status === "failed" && att.last_error ? (
                    <p className="mt-1 text-[11px] text-rose-400">
                      {att.last_error.slice(0, 100)}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => void handleDelete(att.id, att.filename)}
                  className="shrink-0 px-2 text-[18px] text-zinc-500 active:text-rose-400"
                  aria-label={`删除 ${att.filename}`}
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {/* 操作按钮 */}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 rounded-full bg-ink-800 px-4 py-2 text-[13px] font-medium text-zinc-200 active:scale-[0.97] active:bg-ink-700 disabled:opacity-50"
        >
          {uploading ? (
            <>
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-zinc-400/40 border-t-zinc-300" />
              上传中…
            </>
          ) : (
            <>+ 添加文件</>
          )}
        </button>

        {inMp ? (
          <button
            type="button"
            onClick={handlePickFromWechat}
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-4 py-2 text-[13px] font-medium text-emerald-300 active:scale-[0.97] active:bg-emerald-500/25"
            data-testid="attachments-wechat-picker"
          >
            💬 从 微信聊天记录 选
          </button>
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />

      {/* 提示文案 */}
      <p className="mt-2 text-[12px] leading-snug text-zinc-500">
        支持 PDF / Word / Excel / 文本 / 图片. AI 拆议程 + 自主讨论 会读取这些内容.
        {inMp
          ? null
          : " 小程序里 可 用 「💬 从 微信聊天记录 选」 添加 聊天里发过的文件."}
      </p>

      {error ? (
        <p className="mt-2 text-[12px] text-rose-400">{error}</p>
      ) : null}
    </section>
  );
}
