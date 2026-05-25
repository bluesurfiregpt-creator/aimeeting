"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, type Agent, type KnowledgeBase, type Me } from "@/lib/api";
import { toast } from "@/lib/toast";
import { SkeletonGrid } from "@/components/Skeleton";
import { ConfirmDialog } from "@/components/ConfirmDialog";

// v1.3.1 ABAC (PM Q7.4 web 独占编辑):
//   workspace_creator / leader 可创建 / 删 KB + 改 owner_agent_id
//   admin                       仅看 (不能创建 / 不能删)
//   agent_owner                  仅可写 KB.owner_agent_id 指向 自己 primary AI 的 KB
//                                (UI 上看 can_write 字段)
//   member                       仅只读
const FULL_ADMIN_ROLES = new Set(["workspace_creator", "leader", "owner"]);

export default function KnowledgeAdmin() {
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);  // v26.5-02a: 给 owner select 用
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ownerAgentId, setOwnerAgentId] = useState<string>("");  // v26.5-02a
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  // v26.5-02a 编辑模式: 改 owner_agent_id
  const [editing, setEditing] = useState<KnowledgeBase | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editOwnerAgentId, setEditOwnerAgentId] = useState<string>("");
  const [editBusy, setEditBusy] = useState(false);

  const [me, setMe] = useState<Me | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, ag, meRes] = await Promise.all([
        api.listKnowledgeBases(),
        api.listAgents().catch(() => [] as Agent[]),  // v26.5-02a
        api.me().catch(() => null),
      ]);
      setKbs(list);
      setAgents(ag);
      setMe(meRes);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const isFullAdmin = me ? FULL_ADMIN_ROLES.has(me.role) : false;

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await api.createKnowledgeBase({
        name: name.trim(),
        description: description.trim() || undefined,
        owner_agent_id: ownerAgentId || null,
      });
      setName("");
      setDescription("");
      setOwnerAgentId("");
      await refresh();
      toast.success("知识库已创建");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建失败");
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (kb: KnowledgeBase) => {
    setEditing(kb);
    setEditName(kb.name);
    setEditDescription(kb.description ?? "");
    setEditOwnerAgentId(kb.owner_agent_id ?? "");
  };

  const cancelEdit = () => {
    setEditing(null);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setEditBusy(true);
    try {
      const body: { name?: string; description?: string | null; owner_agent_id?: string | null } = {};
      if (editName !== editing.name) body.name = editName.trim();
      if (editDescription !== (editing.description ?? "")) {
        body.description = editDescription || null;
      }
      // owner_agent_id 仅 leader+ 可改; 后端会拒
      if (isFullAdmin && editOwnerAgentId !== (editing.owner_agent_id ?? "")) {
        body.owner_agent_id = editOwnerAgentId || null;
      }
      await api.updateKnowledgeBase(editing.id, body);
      toast.success("已更新");
      setEditing(null);
      await refresh();
    } catch (e) {
      // toast 已在 api.ts 抛
      void e;
    } finally {
      setEditBusy(false);
    }
  };

  const remove = (id: string, kbName: string) => {
    setConfirmDelete({ id, name: kbName });
  };

  const performDelete = async () => {
    if (!confirmDelete) return;
    const { id } = confirmDelete;
    setConfirmDelete(null);
    try {
      await api.deleteKnowledgeBase(id);
      await refresh();
    } catch (e) {
      toast.error("删除失败", { detail: e instanceof Error ? e.message : "未知错误" });
    }
  };

  return (
    <div>
      {/* v26.14-P1: 心智模型 提示 — KB vs Memory 用户 容易 混淆, 顶部 一句话 讲清. */}
      <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 text-xs leading-5 text-zinc-300">
        <span className="font-medium text-sky-200">📚 知识库 = AI 能 查得到的 书架</span>
        <span className="ml-1 text-zinc-400">
          — 文档 摆 在 这, AI 回答 时 走 RAG 召回 检索 (不一定 每次 都 用, 跟 问题 相关 才 引).
        </span>
        <span className="mx-1 text-zinc-700">·</span>
        <span className="text-zinc-400">跟 「🧠 长期记忆」区别:</span>
        <Link href="/me/profile/memory" className="ml-1 text-sky-300 hover:text-sky-200">长期记忆</Link>
        <span className="text-zinc-400"> 是 AI 已经 内化 的 短句 经验 (每次 prompt 必带), KB 是 RAG 才用.</span>
      </div>

      <p className="mt-4 text-sm text-zinc-500">
        把业务文档(PDF / Word / Excel / Markdown / TXT)上传到知识库, AI 专家在会议中回答时会**优先**引用这里的内容。每个工作空间独立, 不会跨租户共享。
      </p>

      {/* v26.5-02a: 创建表单 仅 leader+ */}
      {isFullAdmin && (
      <section className="mt-6 rounded-xl border border-ink-700 bg-ink-900 p-5">
        <h2 className="text-sm font-medium text-zinc-300">新建知识库</h2>
        <div className="mt-3 grid gap-3">
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
          {/* v26.5-02a: 归属 AI 专家 (可选) */}
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <label className="block text-xs uppercase tracking-wider text-amber-300">
              🔗 归属 AI 专家 (可选)
            </label>
            <p className="mt-1 text-[11px] text-zinc-500">
              指定后, 该 AI 的 primary_user (manager) 也能 上传/删 文档.
              不指定 → 仅 leader+ 能管.
            </p>
            <select
              value={ownerAgentId}
              onChange={(e) => setOwnerAgentId(e.target.value)}
              className="mt-2 w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-zinc-100 focus:border-accent-500 focus:outline-none"
            >
              <option value="">— 不归属 AI (仅 admin 可写) —</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.domain ? ` · ${a.domain}` : ""}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={create}
            disabled={creating || !name.trim()}
            className="self-start rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white shadow disabled:opacity-50 hover:bg-accent-400 transition"
          >
            {creating ? "..." : "创建"}
          </button>
        </div>
      </section>
      )}

      {!isFullAdmin && me && (
        <section className="mt-6 rounded-xl border border-violet-500/30 bg-violet-500/5 p-4">
          <h3 className="text-sm font-medium text-violet-200">
            👋 部门 AI 维护人视角({me.name})
          </h3>
          <p className="mt-1 text-xs text-zinc-400">
            归属于你 primary 的 AI 的 KB (列表中有 ⭐ 标记的) 你 可以 ✏️ 编辑 / 上传文档.
            <br />
            其他 KB / 创建新 KB / 删除 KB / 改 KB 的归属 需 owner / admin / leader 操作.
          </p>
        </section>
      )}

      {/* List */}
      <section className="mt-6">
        <h2 className="text-sm font-medium text-zinc-300">已有知识库 ({kbs.length})</h2>
        {loading ? (
          <div className="mt-3">
            <SkeletonGrid items={4} />
          </div>
        ) : kbs.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600">还没有知识库,新建一个开始上传文档。</p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {kbs.map((kb) => (
              <li key={kb.id} className="group rounded-xl border border-ink-700 bg-ink-900 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/me/profile/knowledge/${kb.id}`} className="block">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white hover:text-accent-400">
                          {kb.name}
                        </span>
                        {/* v26.5-02a: 归属 AI 徽章 */}
                        {kb.owner_agent_name && (
                          <span
                            className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300"
                            title={`归属: ${kb.owner_agent_name}`}
                          >
                            🤖 {kb.owner_agent_name}
                          </span>
                        )}
                        {/* manager 自己可写的 KB 加 ⭐ */}
                        {!isFullAdmin && kb.can_write && (
                          <span
                            className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] text-violet-300"
                            title="你是这个 KB 归属 AI 的 primary_user, 可写"
                          >
                            ⭐ 我维护
                          </span>
                        )}
                      </div>
                      {kb.description && (
                        <p className="mt-1 truncate text-xs text-zinc-400">{kb.description}</p>
                      )}
                    </Link>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <span className="rounded bg-ink-800 px-2 py-0.5">📄 {kb.document_count} 文档</span>
                      <span className="rounded bg-ink-800 px-2 py-0.5">🧩 {kb.chunk_count} 分块</span>
                      {/* v26.5-Lineage P2: 反向查 — 被哪些 AI 引用 */}
                      {(kb.referenced_by_agent_names ?? []).length > 0 && (
                        <span
                          className="rounded bg-sky-500/15 px-2 py-0.5 text-sky-300"
                          title={`被 ${(kb.referenced_by_agent_names ?? []).join(" / ")} 引用`}
                        >
                          🔗 {(kb.referenced_by_agent_names ?? []).length} AI 引用
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {/* 编辑按钮: leader+ 全可 / manager 仅自己可写 KB 可 */}
                    {(isFullAdmin || kb.can_write) ? (
                      <button
                        onClick={() => startEdit(kb)}
                        className="text-xs text-zinc-400 hover:text-zinc-100"
                      >
                        ✏️ 编辑
                      </button>
                    ) : (
                      <span
                        className="text-xs text-zinc-700"
                        title={kb.owner_agent_name
                          ? `此 KB 归 ${kb.owner_agent_name} 管, 你无权编辑`
                          : "仅 owner / admin / leader 可编辑此 KB"}
                      >
                        🔒
                      </span>
                    )}
                    {/* 删除按钮: 仅 leader+ */}
                    {isFullAdmin ? (
                      <button
                        onClick={() => remove(kb.id, kb.name)}
                        className="text-xs text-rose-400 hover:text-rose-300"
                      >
                        删除
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 编辑 Dialog */}
      {editing && (
        <div
          className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4"
          onClick={cancelEdit}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-ink-700 bg-ink-900 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-zinc-200">编辑知识库</h4>
              <button
                onClick={cancelEdit}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                ✕
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block text-sm">
                <span className="text-xs text-zinc-500">名称</span>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white focus:border-accent-500 focus:outline-none"
                />
              </label>
              <label className="block text-sm">
                <span className="text-xs text-zinc-500">简介</span>
                <input
                  type="text"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white focus:border-accent-500 focus:outline-none"
                />
              </label>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <label className="block text-xs uppercase tracking-wider text-amber-300">
                  🔗 归属 AI 专家 {!isFullAdmin && "(仅 leader+ 可改)"}
                </label>
                {isFullAdmin ? (
                  <select
                    value={editOwnerAgentId}
                    onChange={(e) => setEditOwnerAgentId(e.target.value)}
                    className="mt-2 w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-zinc-100 focus:border-accent-500 focus:outline-none"
                  >
                    <option value="">— 不归属 (仅 admin 可写) —</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.domain ? ` · ${a.domain}` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="mt-2 rounded-md border border-ink-700 bg-ink-950/60 px-3 py-2 text-sm">
                    {editing.owner_agent_name ? (
                      <span className="text-zinc-100">
                        当前归属: <strong className="text-emerald-300">{editing.owner_agent_name}</strong>
                      </span>
                    ) : (
                      <span className="text-zinc-500">— 不归属 (仅 admin 可写) —</span>
                    )}
                    <p className="mt-1 text-[10px] text-amber-300/60">
                      🔒 转 KB 归属 需要 owner / admin / leader
                    </p>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={saveEdit}
                disabled={editBusy}
                className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white shadow disabled:opacity-50 hover:bg-accent-400"
              >
                {editBusy ? "保存中…" : "保存"}
              </button>
              <button
                onClick={cancelEdit}
                className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-zinc-300 hover:bg-ink-800"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title="确认删除知识库？"
        body={
          <>
            将删除「<span className="text-white">{confirmDelete?.name}</span>」。
            所有文档和分块会一起删除(OSS 上的源文件会保留,可联系管理员手动清理)。
          </>
        }
        confirmLabel="删除"
        danger
        onConfirm={performDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
