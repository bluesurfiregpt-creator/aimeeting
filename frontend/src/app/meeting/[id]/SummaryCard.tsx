"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

type Status = "pending" | "ready" | "failed" | "unconfigured" | "skipped";

export default function SummaryCard({ meetingId }: { meetingId: string }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("pending");
  const [skipMessage, setSkipMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

  const fetchOnce = useCallback(async () => {
    try {
      const r = await api.getMeetingSummary(meetingId);
      setSummary(r.summary_md);
      setStatus(r.status as Status);
      setSkipMessage(r.message ?? null);
      return r.status as Status;
    } catch (e) {
      console.warn("getMeetingSummary failed", e);
      return "pending" as Status;
    }
  }, [meetingId]);

  // Poll: pending → keep polling every 4s, up to 5 minutes
  useEffect(() => {
    let alive = true;
    let attempts = 0;
    const tick = async () => {
      if (!alive) return;
      attempts++;
      const s = await fetchOnce();
      if (!alive) return;
      if (s === "ready" || s === "failed" || s === "unconfigured" || s === "skipped") return;
      if (attempts > 75) return; // ~5 min cap
      pollRef.current = window.setTimeout(tick, 4000);
    };
    tick();
    return () => {
      alive = false;
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [fetchOnce]);

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

  const regen = useCallback(async () => {
    setBusy(true);
    setSummary(null);
    setStatus("pending");
    try {
      await api.regenerateMeetingSummary(meetingId);
      // restart polling
      let attempts = 0;
      const tick = async () => {
        attempts++;
        const s = await fetchOnce();
        if (
          s === "ready" ||
          s === "failed" ||
          s === "unconfigured" ||
          s === "skipped"
        ) {
          setBusy(false);
          return;
        }
        if (attempts > 75) {
          setBusy(false);
          return;
        }
        pollRef.current = window.setTimeout(tick, 4000);
      };
      tick();
    } catch (e) {
      console.error(e);
      setBusy(false);
    }
  }, [meetingId, fetchOnce]);

  return (
    <section className="mt-6 rounded-xl border border-ink-700 bg-ink-900 p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">📋</span>
          <h2 className="text-base font-medium text-white">会议纪要</h2>
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
          <span className="text-zinc-700">|</span>
          <button
            onClick={regen}
            disabled={busy}
            className="text-zinc-500 hover:text-accent-400 disabled:opacity-50"
          >
            {busy ? "生成中..." : "重新生成"}
          </button>
          {/* v25.7-#4: 重跑声纹识别 + debug */}
          <span className="text-zinc-700">|</span>
          <button
            onClick={async () => {
              try {
                const r = await api.rerunIdentify(meetingId);
                toast.success(r.note);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "重跑失败");
              }
            }}
            className="text-zinc-500 hover:text-amber-400"
            title="重跑声纹识别(testing 时调阈值后看新结果;30-60s 后刷新)"
          >
            🔄 重新识别
          </button>
          <button
            onClick={async () => {
              try {
                const d = await api.identifyDebug(meetingId);
                console.log("[identify-debug]", d);
                const summary = [
                  `🎙️ 声纹: ${d.voiceprint_count}`,
                  `📦 segments: ${d.segment_count_total}(命中 ${d.segment_count_kept})`,
                  `📝 实录: ${d.transcript_lines} (识别 ${d.transcript_with_speaker} / 未识 ${d.transcript_unknown})`,
                  `阈值: ${d.threshold_used}`,
                  ...d.notes,
                ].join("\n");
                alert(summary + "\n\n详细数据见 console");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "debug 失败");
              }
            }}
            className="text-zinc-500 hover:text-cyan-400"
            title="声纹识别 debug — 在 console 看 segments / confidence / 提示"
          >
            🔍 识别 debug
          </button>
          {/* v25.8-#4: 离线 ASR 高清重跑(2-5 分钟,质量更高) */}
          <button
            onClick={async () => {
              if (!confirm("离线 ASR 重跑会:1) 用 paraformer-v2 高清模型重新转录(2-5 分钟);2) 替换原实录;3) 重跑 identify + cleaner + summary.\n\n确定继续?")) return;
              try {
                toast.info("📡 离线 ASR 提交中…(5 分钟内别关页面)");
                const r = await api.rerunOfflineAsr(meetingId);
                toast.success(`✅ ${r.next_step}(${r.sentences} 句)`);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "离线 ASR 失败");
              }
            }}
            className="rounded-md bg-orange-500/15 px-2 py-0.5 font-medium text-orange-300 hover:bg-orange-500/25"
            title="高清重跑 — paraformer-v2 离线模型,质量比 realtime 高 20-30%(耗时 2-5 分钟)"
          >
            🎯 高清重跑
          </button>
          <button
            onClick={async () => {
              try {
                const r = await api.meetingHotWords(meetingId);
                console.log("[hot-words]", r);
                const text = [
                  `参会人姓名 (${r.attendee_names.length}): ${r.attendee_names.join(", ") || "无"}`,
                  `Agent keywords (${r.agent_keywords.length}): ${r.agent_keywords.join(", ") || "无"}`,
                  `KB 标题 (${r.kb_titles.length}): ${r.kb_titles.join(", ") || "无"}`,
                  `\n💡 ${r.suggestion}`,
                ].join("\n\n");
                alert(text);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "hot words 失败");
              }
            }}
            className="text-zinc-500 hover:text-lime-400"
            title="本会议自动收集的 hot words(参会人 + agent.keywords + KB)"
          >
            🔥 hot words
          </button>
        </div>
      </header>

      {summary ? (
        <article className="mt-4 prose-invert max-w-none text-sm text-zinc-200">
          <Markdown>{summary}</Markdown>
        </article>
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
