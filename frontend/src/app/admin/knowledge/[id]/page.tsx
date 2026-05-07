"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, type KnowledgeBase, type KnowledgeDocument } from "@/lib/api";
import { toast } from "@/lib/toast";

const STATUS_TONE: Record<string, string> = {
  uploading: "bg-zinc-700/40 text-zinc-300",
  parsing: "bg-amber-500/15 text-amber-300",
  embedding: "bg-amber-500/15 text-amber-300",
  ready: "bg-emerald-500/15 text-emerald-300",
  failed: "bg-rose-500/15 text-rose-300",
};

const STATUS_LABEL: Record<string, string> = {
  uploading: "上传中",
  parsing: "解析中",
  embedding: "向量化",
  ready: "✓ 就绪",
  failed: "失败",
};

function fmtBytes(n?: number | null) {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function KbDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: kbId } = use(params);

  const [kb, setKb] = useState<KnowledgeBase | null>(null);
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, ds] = await Promise.all([
        api.listKnowledgeBases(),
        api.listKnowledgeDocuments(kbId),
      ]);
      setKb(list.find((x) => x.id === kbId) ?? null);
      setDocs(ds);
    } finally {
      setLoading(false);
    }
  }, [kbId]);

  useEffect(() => {
    void refresh();
    // Auto-poll while any doc is in a non-terminal state
    const id = window.setInterval(async () => {
      try {
        const ds = await api.listKnowledgeDocuments(kbId);
        setDocs(ds);
      } catch {}
    }, 4000);
    return () => window.clearInterval(id);
  }, [kbId, refresh]);

  const onUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        try {
          await api.uploadKnowledgeDocument(kbId, f);
          toast.info(`已上传 ${f.name}`, { detail: "正在后台解析+向量化" });
        } catch (e) {
          toast.error(`上传失败:${f.name}`, {
            detail: e instanceof Error ? e.message : "",
          });
        }
      }
      await refresh();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onDeleteDoc = async (doc: KnowledgeDocument) => {
    if (!confirm(`删除「${doc.filename}」?`)) return;
    await api.deleteKnowledgeDocument(kbId, doc.id);
    await refresh();
  };

  const onReprocess = async (doc: KnowledgeDocument) => {
    await api.reprocessKnowledgeDocument(kbId, doc.id);
    await refresh();
  };

  return (
    <div>
      <header className="flex items-center justify-between">
        <div>
          <Link
            href="/admin/knowledge"
            className="text-xs text-zinc-500 hover:text-accent-400"
          >
            ← 返回知识库列表
          </Link>
          <h2 className="mt-1 text-lg font-medium text-white">
            {kb?.name ?? "..."}
          </h2>
          {kb?.description && (
            <p className="mt-1 text-sm text-zinc-400">{kb.description}</p>
          )}
        </div>
        <label className="cursor-pointer rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white shadow hover:bg-accent-400 transition">
          {uploading ? "上传中..." : "上传文档"}
          <input
            ref={fileRef}
            type="file"
            multiple
            disabled={uploading}
            accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.markdown,.csv,.json,.yaml,.yml,.text,.log"
            onChange={(e) => onUpload(e.target.files)}
            className="hidden"
          />
        </label>
      </header>

      <p className="mt-2 text-xs text-zinc-500">
        支持 PDF / DOCX / XLSX / TXT / MD / CSV / JSON / YAML, 单文件 ≤ 50 MB。上传后会自动解析、切块、嵌入(通常几十秒到一两分钟)。
      </p>

      <section className="mt-6">
        {loading ? (
          <p className="text-sm text-zinc-600">加载中...</p>
        ) : docs.length === 0 ? (
          <p className="text-sm text-zinc-600">还没有文档,点右上角「上传文档」开始。</p>
        ) : (
          <ul className="divide-y divide-ink-800 rounded-xl border border-ink-700 bg-ink-900">
            {docs.map((d) => {
              const tone = STATUS_TONE[d.status] ?? STATUS_TONE.uploading;
              const label = STATUS_LABEL[d.status] ?? d.status;
              return (
                <li
                  key={d.id}
                  className="flex items-start justify-between gap-3 px-4 py-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-white">{d.filename}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${tone}`}>
                        {label}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                      <span>{fmtBytes(d.byte_size)}</span>
                      {d.char_count != null && (
                        <span>{d.char_count.toLocaleString()} 字符</span>
                      )}
                      {d.chunk_count != null && d.chunk_count > 0 && (
                        <span>🧩 {d.chunk_count} 分块</span>
                      )}
                      <span>{new Date(d.created_at).toLocaleString("zh-CN")}</span>
                    </div>
                    {d.error_message && (
                      <p className="mt-1 text-xs text-rose-400">
                        {d.error_message}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-3 text-xs">
                    {d.status === "failed" && (
                      <button
                        onClick={() => onReprocess(d)}
                        className="text-amber-400 hover:text-amber-300"
                      >
                        重试
                      </button>
                    )}
                    <button
                      onClick={() => onDeleteDoc(d)}
                      className="text-rose-400 hover:text-rose-300"
                    >
                      删除
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
