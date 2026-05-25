"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · round-3 · 资料数据适配层.
 *
 * 设计稿 用 `Material` 接口 (id / name / type / size / uploader / when / time…).
 * Backend 用 `MeetingAttachmentOut` (id / filename / extension / size_bytes /
 *   extract_status / uploader_user_id / …).
 *
 * 这一层把后端结构 映射到 设计稿的 渲染 输入. PM round-3 要求 严格 按设计稿 视觉,
 * 但 数据 仍然 来自 真实后端.
 *
 * `when: 'pre' | 'live'` 暂时全设为 'pre' — backend 暂无 created_at vs
 * meeting started_at 比对的字段. 后续接 created_at 后 再细化.
 */

import type { MeetingAttachmentOut } from "@/lib/mobile/types";

import { mapExtensionToType, type MaterialType } from "./FileGlyph";

export type Material = {
  /** 后端 attachment id. */
  id: string;
  /** 显示文件名. */
  name: string;
  /** 设计稿 4 类 (pdf/word/excel/ppt/other). */
  type: MaterialType;
  /** 显示用文件大小 (1.1 MB / 52 KB / …). */
  size: string;
  /** 'pre' 会前 上传 / 'live' 会中 上传. */
  when: "pre" | "live";
  /** 显示用时间 ("昨天 22:18" / "刚刚" / "今天 09:42"). 现 fallback "—". */
  time: string;
  /** 上传人 id (跟 MOCK_HUMANS key 兼容; backend 用 user uuid → fallback "—") */
  uploaderId: string | null;
  /** 上传人 显示名. */
  uploaderName: string;
  /** 描述 (设计稿示例: "本次会议主提案" / "议程 2 核心数据来源"). 暂 空. */
  desc?: string;
  /** 是否主提案 (设计稿示例 `pinned: true` 显 "主提案" pill). 暂 false. */
  pinned?: boolean;
  /** backend extract_status — 用于 sheet 行上的小 tag. */
  extractStatus?: string;
  /** 错误描述 (extract_status=failed 时显). */
  lastError?: string | null;
};

function formatSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/** 把 backend MeetingAttachmentOut[] 映射成 Material[]. */
export function adaptAttachmentsToMaterials(
  items: MeetingAttachmentOut[],
): Material[] {
  return items.map((a) => ({
    id: a.id,
    name: a.filename,
    type: mapExtensionToType(a.extension),
    size: formatSize(a.size_bytes),
    when: "pre", // backend 暂无 created_at vs started_at 比对; round-4 再接
    time: "—",
    uploaderId: a.uploader_user_id,
    uploaderName: "—", // backend 不返 user display name; round-4 再接 user join
    extractStatus: a.extract_status,
    lastError: a.last_error,
  }));
}

/** 适合 显示在 strip 上的 "最新的 N 个文件" — 取最后 N 个 (按数组顺序). */
export function recentMaterials(items: Material[], n = 4): Material[] {
  return items.slice(-n).reverse();
}

/** 是否有 "新" 文件 (会中刚上传). 现状 永远 false — backend 接 created_at 后启用. */
export function hasNewMaterial(items: Material[]): boolean {
  return items.some((m) => m.when === "live");
}
