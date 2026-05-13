"use client";

import { useCallback, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

/**
 * v24.2 #3 — 公文智能审核 (智慧住建文档 §3.3).
 *
 * 用户粘贴公文内容 → LLM 三维审核(format / wording / policy)→
 * 显示按严重度排序的 issues 列表 + 整体评价.
 */

type Issue = {
  severity: "high" | "medium" | "low";
  category: "format" | "wording" | "policy";
  location: string;
  issue: string;
  suggestion: string;
};

type AuditResult = {
  issues: Issue[];
  overall: string;
  audited_chars: number;
  truncated: boolean;
  fallback_used: boolean;
  error: string | null;
};

const SEVERITY_LABEL: Record<Issue["severity"], string> = {
  high: "严重",
  medium: "一般",
  low: "建议",
};
const SEVERITY_COLOR: Record<Issue["severity"], string> = {
  high: "bg-red-500/20 text-red-200 border-red-500/40",
  medium: "bg-amber-500/20 text-amber-200 border-amber-500/40",
  low: "bg-zinc-700/40 text-zinc-300 border-ink-700",
};
const CATEGORY_LABEL: Record<Issue["category"], string> = {
  format: "格式",
  wording: "用语",
  policy: "政策引用",
};
const CATEGORY_EMOJI: Record<Issue["category"], string> = {
  format: "📐",
  wording: "✍️",
  policy: "📜",
};

const SAMPLE = `关于沙头街道老旧小区幕墙安全整治工作的通知

经研究,决定从 2025-1-1 起对辖区内老旧小区开展幕墙安全大排查,
具体由各物业公司按规定推进,大概有 30 户需要重点检查。
请相关单位务必重视,搞好这项工作,确保 3 月底前完成。`;

export default function DocumentAuditPage() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);

  const audit = useCallback(async () => {
    const t = text.trim();
    if (!t) {
      toast.error("请先粘贴或输入待审核文稿");
      return;
    }
    if (t.length < 10) {
      toast.error("文稿太短(< 10 字)");
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const r = await api.auditDocument(t);
      setResult(r);
      if (r.error) {
        toast.error(`审核失败:${r.error}`);
      } else if (r.issues.length === 0) {
        toast.success("✅ 审核完成 — 无明显问题");
      } else {
        toast.success(`审核完成 — 发现 ${r.issues.length} 条问题`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "审核失败");
    } finally {
      setBusy(false);
    }
  }, [text]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-12 pt-20">
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold text-white">公文智能审核</h1>
          <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-200">
            ✨ AI v24.2
          </span>
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          LLM 三维审核:格式(标题/段落/标点)+ 用语(口语化/长句/错字)+
          政策引用(文号格式).智慧住建文档 §3.3.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 输入区 */}
        <section className="rounded-xl border border-ink-700 bg-ink-900 p-5">
          <header className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-300">📝 待审核文稿</h2>
            <button
              type="button"
              onClick={() => setText(SAMPLE)}
              className="text-[11px] text-zinc-500 hover:text-zinc-300"
            >
              贴入示例
            </button>
          </header>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={20}
            maxLength={20000}
            placeholder="粘贴公文 / 通知 / 报告内容…(最多 20000 字)"
            data-testid="audit-text-input"
            className="mt-3 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 font-mono text-xs text-white placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-zinc-600">
              {text.length} / 20000 字符
            </span>
            <button
              type="button"
              onClick={audit}
              disabled={busy || !text.trim()}
              data-testid="audit-submit-btn"
              className="rounded-lg bg-violet-500 px-4 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-violet-400 transition"
            >
              {busy ? "🤖 审核中(5-15s)…" : "✨ 提交审核"}
            </button>
          </div>
        </section>

        {/* 结果区 */}
        <section
          className="rounded-xl border border-ink-700 bg-ink-900 p-5"
          data-testid="audit-result-panel"
        >
          <h2 className="text-sm font-medium text-zinc-300">🔍 审核结果</h2>
          {!result ? (
            <div className="mt-12 text-center text-xs text-zinc-600">
              {busy ? "AI 正在审核…" : "提交后这里会显示问题列表"}
            </div>
          ) : (
            <div className="mt-3">
              <div
                className="rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-xs text-zinc-300"
                data-testid="audit-overall"
              >
                <div className="text-[10px] text-zinc-500">📊 总评</div>
                <div className="mt-0.5">{result.overall}</div>
                {result.truncated && (
                  <div className="mt-1 text-[10px] text-amber-400">
                    ⚠️ 文稿过长已截断到 20000 字
                  </div>
                )}
              </div>

              {result.issues.length === 0 ? (
                <div className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4 text-center text-sm text-emerald-200">
                  ✅ 无明显问题
                </div>
              ) : (
                <ul className="mt-4 space-y-2" data-testid="audit-issues-list">
                  {result.issues.map((it, i) => (
                    <li
                      key={i}
                      data-testid="audit-issue-row"
                      data-severity={it.severity}
                      className={`rounded-md border px-3 py-2 ${SEVERITY_COLOR[it.severity]}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-medium">
                          [{SEVERITY_LABEL[it.severity]}]
                        </span>
                        <span className="text-[10px] text-zinc-400">
                          {CATEGORY_EMOJI[it.category]} {CATEGORY_LABEL[it.category]}
                        </span>
                        {it.location && (
                          <span className="text-[10px] text-zinc-500">
                            · {it.location}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs">
                        <div className="text-zinc-200">{it.issue}</div>
                        {it.suggestion && (
                          <div className="mt-0.5 text-[11px] text-zinc-400">
                            💡 {it.suggestion}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
