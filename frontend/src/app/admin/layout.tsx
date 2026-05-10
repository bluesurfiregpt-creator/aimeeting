import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">admin</div>
          <h1 className="mt-1 text-2xl font-semibold text-white">系统配置</h1>
        </div>
        <Link href="/" className="text-sm text-zinc-400 hover:text-white">
          ← 首页
        </Link>
      </header>
      <nav className="mt-6 flex gap-1 border-b border-ink-700">
        <AdminTab href="/admin/agents" label="AI 专家" />
        <AdminTab href="/admin/knowledge" label="知识库" />
        <AdminTab href="/admin/models" label="LLM 模型" />
        <AdminTab href="/admin/memory" label="长期记忆" />
        <AdminTab href="/admin/cron-rules" label="定期巡检" />
        <AdminTab href="/admin/team" label="团队" />
        <AdminTab href="/admin/audit" label="操作日志" />
        <AdminTab href="/admin/demo-data" label="演示数据" />
      </nav>
      <div className="mt-8">{children}</div>
    </div>
  );
}

function AdminTab({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-t-lg px-4 py-2 text-sm text-zinc-400 hover:bg-ink-800 hover:text-white"
    >
      {label}
    </Link>
  );
}
