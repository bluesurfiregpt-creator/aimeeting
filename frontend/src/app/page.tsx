import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-16">
      <div className="text-xs uppercase tracking-[0.3em] text-ink-700">aimeeting</div>
      <h1 className="mt-4 text-center text-4xl font-semibold leading-tight text-white sm:text-5xl">
        让会议拥有<span className="text-accent-400">记忆与专家</span>
      </h1>
      <p className="mt-5 max-w-xl text-center text-base text-ink-700/90 text-zinc-400">
        实时字幕 · 声纹识别 · AI 专家参会 · 长期记忆。<br />
        每一场会议都让组织变得更聪明一点。
      </p>
      <div className="mt-10 flex gap-3">
        <Link
          href="/meeting/demo"
          className="rounded-lg bg-accent-500 px-5 py-2.5 text-sm font-medium text-white shadow hover:bg-accent-400 transition"
        >
          进入演示会议室
        </Link>
        <a
          href="/healthz"
          className="rounded-lg border border-zinc-700 px-5 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 transition"
        >
          系统状态
        </a>
      </div>
      <p className="mt-12 text-xs text-zinc-600">
        Phase 1 · 单 Agent MVP · {new Date().getFullYear()}
      </p>
    </main>
  );
}
