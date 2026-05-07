"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, type KnowledgeBase } from "@/lib/api";
import { toast } from "@/lib/toast";

export default function KnowledgeAdmin() {
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setKbs(await api.listKnowledgeBases());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await api.createKnowledgeBase({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      setName("");
      setDescription("");
      await refresh();
      toast.success("知识库已创建");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建失败");
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id: string, kbName: string) => {
    if (!confirm(`确认删除知识库「${kbName}」？所有文档和分块会一起删除（OSS 上的源文件会保留）。`))
      return;
    await api.deleteKnowledgeBase(id);
    await refresh();
  };

  return (
    <div>
      <p className="text-sm text-zinc-500">
        把业务文档(PDF / Word / Excel / Markdown / TXT)上传到知识库, AI 专家在会议中回答时会**优先**引用这里的内容。每个工作空间独立, 不会跨租户共享。
      </p>

      {/* Create form */}
      <section className="mt-6 rounded-xl border border-ink-700 bg-ink-900 p-5">
        <h2 className="text-sm font-medium text-zinc-300">新建知识库</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="名称(如「产品文档」)"
            className="rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
          />
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="一句话简介(可选)"
            className="rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
          />
          <button
            onClick={create}
            disabled={creating || !name.trim()}
            className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white shadow disabled:opacity-50 hover:bg-accent-400 transition"
          >
            {creating ? "..." : "创建"}
          </button>
        </div>
      </section>

      {/* List */}
      <section className="mt-6">
        <h2 className="text-sm font-medium text-zinc-300">已有知识库 ({kbs.length})</h2>
        {loading ? (
          <p className="mt-3 text-sm text-zinc-600">加载中...</p>
        ) : kbs.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600">还没有知识库,新建一个开始上传文档。</p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {kbs.map((kb) => (
              <li key={kb.id} className="group rounded-xl border border-ink-700 bg-ink-900 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/knowledge/${kb.id}`} className="block">
                      <div className="text-sm font-medium text-white hover:text-accent-400">
                        {kb.name}
                      </div>
                      {kb.description && (
                        <p className="mt-1 truncate text-xs text-zinc-400">{kb.description}</p>
                      )}
                    </Link>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <span className="rounded bg-ink-800 px-2 py-0.5">📄 {kb.document_count} 文档</span>
                      <span className="rounded bg-ink-800 px-2 py-0.5">🧩 {kb.chunk_count} 分块</span>
                    </div>
                  </div>
                  <button
                    onClick={() => remove(kb.id, kb.name)}
                    className="text-xs text-zinc-600 opacity-0 transition group-hover:opacity-100 hover:text-rose-400"
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
