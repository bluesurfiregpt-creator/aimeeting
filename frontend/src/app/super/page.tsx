"use client";

/**
 * v26.4 · Platform Admin · 跨 workspace 控制台
 *
 * 进入条件:caller 的 email 在 env PLATFORM_ADMIN_EMAILS 白名单 (后端 super_me 判定).
 * 不在白名单 → 红色 banner + 跳 /me.
 *
 * 功能:
 *   - 列出 所有 workspace + 计数 + 最后活跃
 *   - ➕ 新建 workspace (代客建,自动生成 owner + 一次性邀请链接)
 *   - "进入此空间" 切到目标 workspace (重发 JWT;所有 /api/* 自动用新 ws)
 *   - 顶部红色"⚡ 平台超管模式"banner 始终提醒
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  preset_name: string | null;
  created_at: string;
  last_active_at: string | null;
  user_count: number;
  agent_count: number;
  meeting_count: number;
};

export default function SuperAdminPage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState<"checking" | "yes" | "no">("checking");
  const [meEmail, setMeEmail] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);

  // 权限校验 + 加载列表
  useEffect(() => {
    let alive = true;
    api
      .superMe()
      .then((r) => {
        if (!alive) return;
        setMeEmail(r.email);
        if (!r.is_platform_admin) {
          setAllowed("no");
          toast.error("无平台超管权限", {
            detail: `email ${r.email} 不在 PLATFORM_ADMIN_EMAILS 白名单`,
          });
          setTimeout(() => router.replace("/"), 1500);
          return;
        }
        setAllowed("yes");
      })
      .catch((e) => {
        if (!alive) return;
        // 401 由 api.ts 自己跳 /login
        setErr(e instanceof Error ? e.message : "权限校验失败");
        setAllowed("no");
      });
    return () => {
      alive = false;
    };
  }, [router]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.superListWorkspaces(includeArchived);
      setWorkspaces(rows);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);

  useEffect(() => {
    if (allowed === "yes") reload();
  }, [allowed, reload]);

  const switchInto = useCallback(
    async (ws: WorkspaceRow) => {
      if (!confirm(`确定切换进 「${ws.name}」?\n切换后 你 看到的所有数据 是 这个 workspace 的.要回来 再开 /super 切回原空间.`)) return;
      try {
        await api.superSwitchWorkspace(ws.id);
        toast.success(`已切到 ${ws.name}`);
        // 强刷整页以让所有缓存的 me / state 重新拉
        setTimeout(() => router.replace("/"), 500);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "切换失败");
      }
    },
    [router],
  );

  // ---- 渲染 ------
  if (allowed === "checking") {
    return (
      <main className="mx-auto max-w-5xl px-6 py-20 text-center">
        <p className="text-sm text-zinc-500">超管权限校验中…</p>
      </main>
    );
  }
  if (allowed === "no") {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20 text-center">
        <p className="text-lg text-rose-300">⚡ 无平台超管权限</p>
        <p className="mt-2 text-sm text-zinc-400">
          只有 email 在 PLATFORM_ADMIN_EMAILS 白名单的账号 才能访问 /super.
          {err && <span className="ml-1 text-rose-400">({err})</span>}
        </p>
        <p className="mt-1 text-xs text-zinc-600">正在跳转 /...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      {/* 红色平台超管 banner */}
      <div
        className="mb-6 flex items-center justify-between rounded-xl border-l-4 border-rose-500 bg-rose-500/10 px-4 py-3"
        data-testid="super-banner"
      >
        <div>
          <div className="text-sm font-semibold text-rose-200">
            ⚡ 平台超管模式 (Platform Admin)
          </div>
          <div className="mt-0.5 text-xs text-rose-300/70">
            email: {meEmail} · 你 正在跨 workspace 视角.所有操作 audit 留痕 (payload.platform_admin=true).
          </div>
        </div>
        <Link
          href="/"
          className="rounded-md border border-rose-500/40 px-3 py-1 text-xs text-rose-200 hover:bg-rose-500/10"
        >
          ← 退回自己 workspace
        </Link>
      </div>

      {/* 标题 + 工具栏 */}
      <header className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">
            v26.4 platform admin
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-white">
            所有租户工作空间
          </h1>
          <p className="mt-1 text-xs text-zinc-500">
            {workspaces.length} 个 workspace · 含 user / agent / meeting 统计
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              className="h-3.5 w-3.5 accent-rose-500"
            />
            含已归档
          </label>
          <button
            onClick={reload}
            disabled={loading}
            className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-ink-800 disabled:opacity-50"
          >
            🔄 刷新
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-md bg-accent-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-400"
            data-testid="open-create"
          >
            ➕ 新建工作空间
          </button>
        </div>
      </header>

      {err && (
        <div className="mb-3 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
          {err}
        </div>
      )}

      {/* 列表 */}
      <div className="overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
        <table className="w-full text-sm">
          <thead className="bg-ink-950 text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-3 py-2 text-left">名称 / slug</th>
              <th className="px-3 py-2 text-center">状态</th>
              <th className="px-3 py-2 text-center">user</th>
              <th className="px-3 py-2 text-center">agent</th>
              <th className="px-3 py-2 text-center">meeting</th>
              <th className="px-3 py-2 text-center">最后活跃</th>
              <th className="px-3 py-2 text-center">创建时间</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {workspaces.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-xs text-zinc-500">
                  {loading ? "加载中…" : "没有 workspace"}
                </td>
              </tr>
            ) : (
              workspaces.map((ws) => (
                <tr
                  key={ws.id}
                  className="border-t border-ink-800 hover:bg-ink-800/50"
                  data-testid={`ws-row-${ws.slug}`}
                >
                  <td className="px-3 py-2.5">
                    <div className="text-white">{ws.name}</div>
                    <div className="text-[10px] text-zinc-500">
                      {ws.slug}
                      {ws.preset_name && (
                        <span className="ml-2 rounded bg-amber-500/15 px-1 py-0.5 text-amber-300">
                          {ws.preset_name}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span
                      className={
                        ws.status === "active"
                          ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300"
                          : ws.status === "suspended"
                          ? "rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300"
                          : "rounded-full bg-zinc-700/40 px-2 py-0.5 text-[10px] text-zinc-400"
                      }
                    >
                      {ws.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center tabular-nums text-zinc-300">
                    {ws.user_count}
                  </td>
                  <td className="px-3 py-2.5 text-center tabular-nums text-zinc-300">
                    {ws.agent_count}
                  </td>
                  <td className="px-3 py-2.5 text-center tabular-nums text-zinc-300">
                    {ws.meeting_count}
                  </td>
                  <td className="px-3 py-2.5 text-center text-[10px] text-zinc-500">
                    {ws.last_active_at
                      ? new Date(ws.last_active_at).toLocaleString("zh-CN")
                      : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-center text-[10px] text-zinc-500">
                    {new Date(ws.created_at).toLocaleDateString("zh-CN")}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => switchInto(ws)}
                      className="rounded-md border border-rose-500/40 px-2 py-1 text-[11px] text-rose-200 hover:bg-rose-500/10"
                      data-testid={`switch-${ws.slug}`}
                    >
                      进入 →
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateWorkspaceModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            reload();
          }}
        />
      )}
    </main>
  );
}


// ============================================================================
// 新建 workspace modal
// ============================================================================

function CreateWorkspaceModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [seedDemo, setSeedDemo] = useState(false);
  const [createInvite, setCreateInvite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{
    workspace_name: string;
    owner_email: string;
    temp_password: string | null;
    invite_url: string | null;
  } | null>(null);

  const submit = async () => {
    setErr(null);
    if (!name.trim() || !ownerName.trim() || !ownerEmail.trim()) {
      setErr("名称 / owner 姓名 / owner 邮箱 都必填");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail.trim())) {
      setErr("owner 邮箱格式不对");
      return;
    }
    setBusy(true);
    try {
      const r = await api.superCreateWorkspace({
        name: name.trim(),
        owner_email: ownerEmail.trim(),
        owner_name: ownerName.trim(),
        temp_password: tempPassword.trim() || undefined,
        seed_demo: seedDemo,
        create_invite: createInvite,
      });
      setResult({
        workspace_name: r.workspace_name,
        owner_email: r.owner_email,
        temp_password: r.temp_password,
        invite_url: r.invite_url,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "创建失败");
    } finally {
      setBusy(false);
    }
  };

  // 创建成功后的"凭证回执"屏 — 让 你 复制密码 / 邀请链接
  if (result) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const fullInvite = result.invite_url ? `${origin}${result.invite_url}` : null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCreated}>
        <div
          className="w-full max-w-lg rounded-2xl border border-emerald-500/40 bg-ink-950 p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="text-lg font-semibold text-emerald-200">
            ✓ workspace 「{result.workspace_name}」 已创建
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            把下面的凭证 复制 给客户.关闭对话框后 这些信息将无法再次显示.
          </p>

          <div className="mt-4 space-y-3 text-sm">
            <div>
              <div className="text-xs text-zinc-500">owner 邮箱</div>
              <div className="mt-1 break-all rounded-md border border-ink-700 bg-ink-900 px-3 py-2 font-mono text-emerald-200">
                {result.owner_email}
              </div>
            </div>
            {result.temp_password && (
              <div>
                <div className="text-xs text-zinc-500">
                  临时密码 (生成的 32 字符随机串 · 首次登录后让 客户 改掉)
                </div>
                <div className="mt-1 break-all rounded-md border border-ink-700 bg-ink-900 px-3 py-2 font-mono text-amber-200">
                  {result.temp_password}
                </div>
              </div>
            )}
            {fullInvite && (
              <div>
                <div className="text-xs text-zinc-500">
                  一次性邀请链接 (7 天有效 · 客户用这个链接直接走 /register 改自己的密码)
                </div>
                <div className="mt-1 flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={fullInvite}
                    className="flex-1 break-all rounded-md border border-ink-700 bg-ink-900 px-3 py-2 font-mono text-xs text-violet-200"
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(fullInvite);
                      toast.success("已复制邀请链接");
                    }}
                    className="rounded-md bg-violet-500 px-3 py-2 text-xs text-violet-950 hover:bg-violet-400"
                  >
                    复制
                  </button>
                </div>
              </div>
            )}
          </div>

          <footer className="mt-6 flex justify-end">
            <button
              onClick={onCreated}
              className="rounded-md bg-emerald-500 px-4 py-2 text-sm text-emerald-950 hover:bg-emerald-400"
            >
              我已记下,关闭
            </button>
          </footer>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-ink-700 bg-ink-950 p-6"
        onClick={(e) => e.stopPropagation()}
        data-testid="create-workspace-modal"
      >
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">➕ 新建租户 workspace</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white" aria-label="关闭">
            ✕
          </button>
        </header>
        <p className="mt-1 text-xs text-zinc-500">
          代客户建空间.填 名称 + owner 邮箱 + owner 姓名,系统自动创建 + 给 owner 生成临时密码 / 一次性邀请链接.
        </p>

        <div className="mt-5 space-y-3 text-sm">
          <Field label="工作空间名称 (客户单位)" value={name} onChange={setName} placeholder="南山住建局" required />
          <Field label="owner 姓名" value={ownerName} onChange={setOwnerName} placeholder="张三" required />
          <Field
            label="owner 邮箱"
            value={ownerEmail}
            onChange={setOwnerEmail}
            placeholder="admin@nanshan.gov.cn"
            type="email"
            required
          />
          <Field
            label="临时密码 (留空 = 自动生成 32 位)"
            value={tempPassword}
            onChange={setTempPassword}
            placeholder="留空自动生成"
            type="text"
          />
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={createInvite}
              onChange={(e) => setCreateInvite(e.target.checked)}
              className="h-3.5 w-3.5 accent-violet-500"
            />
            生成一次性邀请链接 (7 天有效,客户用它改自己密码 — 推荐)
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={seedDemo}
              onChange={(e) => setSeedDemo(e.target.checked)}
              className="h-3.5 w-3.5 accent-amber-500"
            />
            自动 seed 演示数据 (19 个 demo 用户 + 16 AI + 历史会议 · 演示场景用 · 慢 ~60s)
          </label>
        </div>

        {err && (
          <div className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
            ⚠️ {err}
          </div>
        )}

        <footer className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-ink-700 px-4 py-2 text-sm text-zinc-300 hover:bg-ink-800"
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-400 disabled:opacity-50"
            data-testid="submit-create"
          >
            {busy ? "创建中…" : "✓ 创建"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs text-zinc-400">
        {label}
        {required && <span className="ml-1 text-rose-400">*</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-accent-500 focus:outline-none"
      />
    </label>
  );
}
