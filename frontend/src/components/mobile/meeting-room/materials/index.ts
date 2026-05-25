"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · round-3 · materials 模块入口.
 */

export { default as FileGlyph, FILE_TYPES, mapExtensionToType } from "./FileGlyph";
export type { MaterialType } from "./FileGlyph";
export { default as MaterialsStrip } from "./MaterialsStrip";
export { default as MaterialsSheet } from "./MaterialsSheet";
export { default as UploadSheet } from "./UploadSheet";
export { default as FilePreview } from "./FilePreview";
export { default as MaterialUploadedEvent } from "./MaterialUploadedEvent";
export {
  adaptAttachmentsToMaterials,
  hasNewMaterial,
  recentMaterials,
} from "./types";
export type { Material } from "./types";
