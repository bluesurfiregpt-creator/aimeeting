"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

// v25.16: 加 'loading' 区分 "页面刚打开还在拉数据" vs "真的 LLM 在跑"
// 之前默认 status='pending' 导致首次加载就显示 "LLM 通常 5-30 秒..." 误导文案.
type Status = "loading" | "pending" | "ready" | "failed" | "unconfigured" | "skipped";

export default function SummaryCard({
  meetingId,
  refreshKey = 0,
  onStatusChange,
}: {
  meetingId: string;
  // v25.19: 外部触发 重生成 后 ++ 这个 key,SummaryCard 会重启 polling.
  refreshKey?: number;
  // v25.20: 把 polling 到的 status 实时回报给 父 — 让父的进度条 在 ready 时
  // 跳到 100% (重生成纪要 真正完成 的信号).
  onStatusChange?: (status: Status) => void;
}) {
  const [summary, setSummary] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");  // v25.16
  const [skipMessage, setSkipMessage] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  // v25.20: 同步把 status 变化告诉外部
  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  const fetchOnce = useCallback(async () => {
    try {
      const r = await api.getMeetingSummary(meetingId);
      setSummary(r.summary_md);
      setStatus(r.status as Status);
      setSkipMessage(r.message ?? null);
      return r.status as Status;
    } catch (e) {
      console.warn("getMeetingSummary failed", e);
      // 加载失败 — 保持 loading 状态(UI 显示加载中而非生成中)
      return "loading" as Status;
    }
  }, [meetingId]);

  // Poll: pending → keep polling every 4s, up to 5 minutes
  // v25.19: 加 refreshKey 依赖 — 外部触发 重生成 后,polling 重启,
  // 不然 polling 已经停在 ready,看不到 新结果.
  useEffect(() => {
    let alive = true;
    let attempts = 0;
    // v25.19: refreshKey 变化时,先 reset 显示状态(让用户立刻看到 骨架屏)
    if (refreshKey > 0) {
      setSummary(null);
      setStatus("pending");
    }
    const tick = async () => {
      if (!alive) return;
      attempts++;
      const s = await fetchOnce();
      if (!alive) return;
      // v25.16: ready/failed/unconfigured/skipped 都是 terminal,停 polling
      // loading 是首次错误(网络等),也停 — 避免无限重试
      if (
        s === "ready" || s === "failed" || s === "unconfigured" ||
        s === "skipped" || s === "loading"
      ) return;
      if (attempts > 75) return; // ~5 min cap
      pollRef.current = window.setTimeout(tick, 4000);
    };
    tick();
    return () => {
      alive = false;
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [fetchOnce, refreshKey]);

  const download = useCallback(async (format: "md" | "docx") => {
    try {
      const { blob, filename } = await api.downloadMeetingExport(meetingId, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`已导出 ${filename}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导出失败");
    }
  }, [meetingId]);

  // v25-5: 完整纪要 docx(含议程 / agent 发言 / 待办)
  const downloadMinutes = useCallback(async () => {
    try {
      const { blob, filename } = await api.downloadMeetingMinutes(meetingId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`已导出 ${filename}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导出失败");
    }
  }, [meetingId]);

  // v25.19 #1: 「重生成纪要」按钮 移到实录 tab 顶部工具栏(page.tsx).
  // SummaryCard 只负责 渲染 + polling — summary_md=NULL 时自动显示 loading 骨架.

  return (
    <section className="mt-6 rounded-xl border border-ink-700 bg-ink-900 p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">📋</span>
          <h2 className="text-base font-medium text-white">会议纪要</h2>
          {status === "loading" && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-zinc-700/40 px-2 py-0.5 text-xs text-zinc-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-500" />
              加载中…
            </span>
          )}
          {status === "pending" && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
              生成中…
            </span>
          )}
          {status === "ready" && (
            <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
              ✓ 已生成
            </span>
          )}
          {status === "skipped" && (
            <span className="ml-2 rounded-full bg-zinc-700/40 px-2 py-0.5 text-xs text-zinc-400">
              已跳过
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs">
          <button
            onClick={() => download("md")}
            className="text-zinc-500 hover:text-accent-400"
            title="导出为 Markdown 文件"
          >
            导出 .md
          </button>
          <button
            onClick={() => download("docx")}
            className="text-zinc-500 hover:text-accent-400"
            title="导出为 Word 文档(简版:摘要 + 实录)"
          >
            导出 .docx
          </button>
          <button
            onClick={downloadMinutes}
            className="rounded-md bg-violet-500/15 px-2 py-0.5 font-medium text-violet-300 hover:bg-violet-500/25"
            title="导出完整会议纪要 docx(含议程 / AI 发言 / 待办事项 / 政务公文格式)"
          >
            📄 完整纪要
          </button>
          {/* v25.19 #2: 「识别 debug」 改名「声纹诊断」 + 加用户能看懂的解释.
              它的作用:当发现 实录里说话人识别错很多(误识 / 大量 [?]) 时,
              点这里看具体哪一环出问题 — 没录声纹? 切片漏? 阈值太严? */}
          <span className="text-zinc-700">|</span>
          <button
            onClick={async () => {
              try {
                const d = await api.identifyDebug(meetingId);
                console.log("[identify-debug]", d);
                const total = d.transcript_lines || 1;
                const ratio = Math.round((d.transcript_with_speaker / total) * 100);
                const lines = [
                  `🎙️ 已录声纹的成员:${d.voiceprint_count} 人`,
                  `📦 pyannote 切片:${d.segment_count_total} 段(其中 ${d.segment_count_kept} 段达标用于对齐)`,
                  `📝 实录:${d.transcript_lines} 句 — 识别到说话人 ${d.transcript_with_speaker} 句(${ratio}%),未识别 ${d.transcript_unknown} 句`,
                  `匹配阈值:${d.threshold_used}(数值越大 越严)`,
                  "",
                  "📌 系统诊断:",
                  ...(d.notes || ["(暂无)"]),
                  "",
                  "💡 排错思路:",
                  "  • 未识别 句 多 → 让缺席成员去 /me 补录声纹",
                  "  • 识别错 多 → 阈值可能太松,或两人声音相近,用 ✏️ 批量纠正",
                  "  • 切片少 → 录音质量差(噪音 / 远场),试「🎯 高清重跑 ASR」",
                ].join("\n");
                alert(lines);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "诊断失败");
              }
            }}
            className="text-zinc-500 hover:text-cyan-400"
            title="声纹诊断 — 看本场会议 声纹识别 各环节数据(声纹库 / 切片 / 实录覆盖率 / 阈值),帮你判断为啥说话人识别错或漏"
          >
            🔍 声纹诊断
          </button>
          <button
            onClick={async () => {
              try {
                const r = await api.meetingHotWords(meetingId);
                console.log("[hot-words]", r);
                const text = [
                  `📛 参会人姓名 (${r.attendee_names.length} 个):`,
                  `  ${r.attendee_names.join(", ") || "(无)"}`,
                  "",
                  `🤖 AI 专家关键词 (${r.agent_keywords.length} 个):`,
                  `  ${r.agent_keywords.join(", ") || "(无)"}`,
                  "",
                  `📚 KB 文档标题 (${r.kb_titles.length} 个):`,
                  `  ${r.kb_titles.join(", ") || "(无)"}`,
                  "",
                  `💡 ${r.suggestion}`,
                ].join("\n");
                alert(text);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "hot words 失败");
              }
            }}
            className="text-zinc-500 hover:text-lime-400"
            title="ASR 热词 — 本会议自动喂给 DashScope 的热词词表(让 ASR 优先识别这些专有名词)"
          >
            🔥 ASR 热词
          </button>
        </div>
      </header>

      {summary ? (
        <article className="mt-4 prose-invert max-w-none text-sm text-zinc-200">
          <Markdown>{summary}</Markdown>
        </article>
      ) : status === "loading" ? (
        // v25.16: 首次加载 — 不要显示 "LLM 5-30 秒" 那种误导文案
        <div className="mt-4 space-y-2">
          <div className="h-3 w-1/3 animate-pulse rounded bg-ink-800" />
          <div className="h-3 w-full animate-pulse rounded bg-ink-800" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-ink-800" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-ink-800" />
        </div>
      ) : (
        <p className="mt-4 text-sm text-zinc-500">
          {status === "unconfigured"
            ? "未配置 LLM 模型,无法生成纪要。请先去「LLM 模型」页面配置。"
            : status === "skipped"
            ? skipMessage ?? "实录过短,未生成纪要。"
            : status === "failed"
            ? "生成失败。点「重新生成」重试,或检查后端日志。"
            : "纪要生成中。LLM 通常需要 5-30 秒读完整场会议、按结构整理。"}
        </p>
      )}
    </section>
  );
}

/**
 * Markdown wrapper with element-level Tailwind styling so we don't pull in
 * @tailwindcss/typography just for one component.
 */
function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: (p) => <h2 {...p} className="mt-5 text-base font-semibold text-white" />,
        h2: (p) => (
          <h3 {...p} className="mt-5 mb-2 text-sm font-semibold uppercase tracking-wider text-accent-400" />
        ),
        h3: (p) => <h4 {...p} className="mt-3 text-sm font-semibold text-zinc-100" />,
        p: (p) => <p {...p} className="my-2 leading-relaxed text-zinc-200" />,
        ul: (p) => <ul {...p} className="my-2 list-disc space-y-1 pl-5 text-zinc-200" />,
        ol: (p) => <ol {...p} className="my-2 list-decimal space-y-1 pl-5 text-zinc-200" />,
        li: (p) => <li {...p} className="leading-relaxed" />,
        strong: (p) => <strong {...p} className="font-semibold text-white" />,
        em: (p) => <em {...p} className="text-zinc-300" />,
        code: (p) => <code {...p} className="rounded bg-ink-800 px-1 py-0.5 text-xs text-amber-300" />,
        a: (p) => <a {...p} className="text-accent-400 underline hover:text-accent-500" />,
        blockquote: (p) => (
          <blockquote {...p} className="my-3 border-l-2 border-ink-700 pl-3 text-zinc-400" />
        ),
        // GFM task lists (- [ ] 待办事项)
        input: (p) => {
          if (p.type === "checkbox") {
            return (
              <input
                {...p}
                disabled
                className="mr-2 h-3.5 w-3.5 align-middle accent-accent-500"
              />
            );
          }
          return <input {...p} />;
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
