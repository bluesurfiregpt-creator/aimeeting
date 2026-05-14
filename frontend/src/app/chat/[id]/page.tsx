"use client";

// v26.13.1: AI 私聊 调试模式 — 真实现 (替代 v26.12 mock 页).
//
// 设计:
//   - 顶部: 大字 "🔧 调试模式 · 内容不保留" + AI 身份
//   - 中部: 消息 列表 (来自 sessionStorage, 关浏览器/退出 自动 清)
//   - 底部: 输入框 + 文件上传 + 麦克风
//   - 右侧 sidebar (折叠): AI 底牌 (persona / KB / 关键词 / 本次召回 chunk)
//   - 服务端 完全 无状态 — 每次 提交 history 全量 push 给 SSE endpoint
//
// 限制:
//   - 调试模式 日配额 50 次/天 (后端 兜底)
//   - 单文件 ≤ 20MB, ≤ 10 个 attachments

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api, type Agent, type KnowledgeBase } from "@/lib/api";
import {
  streamChat,
  openChatSttSocket,
  type ChatMessage,
  type ChatAttachment,
  type AgentCitation,
  type ChatSttSocket,
} from "@/lib/chatStream";
import {
  startAudioCapture,
  type AudioCaptureHandle,
  MicPermissionError,
} from "@/lib/audioCapture";
import { toast } from "@/lib/toast";

const AGENT_COLOR_HEX: Record<string, string> = {
  violet: "#8b5cf6", rose: "#f43f5e", emerald: "#10b981", amber: "#f59e0b",
  sky: "#0ea5e9", cyan: "#06b6d4", lime: "#84cc16", fuchsia: "#d946ef",
  blue: "#3b82f6", green: "#22c55e", orange: "#f97316", red: "#ef4444",
  teal: "#14b8a6", indigo: "#6366f1", pink: "#ec4899", yellow: "#eab308",
};

// 消息 内部 表示 (前端 多带 几个 字段 给 UI 用; 提交 后端 时 只 取 role/content)
type UIMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  done: boolean;             // assistant 流式 中 = false
  attachments?: ChatAttachment[];   // 仅 user 消息 可能 有
  citations?: AgentCitation[];     // 仅 assistant 完成 时 有
  debug?: { kb_hits: number; memory_hits: number };
};

// 浏览器 sessionStorage key — 每个 user × agent 唯一
function storageKey(agentId: string): string {
  return `aimeeting:chat:${agentId}`;
}

function loadFromSession(agentId: string): UIMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(storageKey(agentId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveToSession(agentId: string, msgs: UIMessage[]): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey(agentId), JSON.stringify(msgs));
  } catch (e) {
    console.warn("chat: sessionStorage save failed", e);
  }
}

export default function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: agentId } = use(params);

  // === 核心 state ===
  const [agent, setAgent] = useState<Agent | null>(null);
  const [agentLoadErr, setAgentLoadErr] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);
  const [kbList, setKbList] = useState<KnowledgeBase[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // 语音输入 state
  const [voiceMode, setVoiceMode] = useState(false);
  const captureRef = useRef<AudioCaptureHandle | null>(null);
  const sttRef = useRef<ChatSttSocket | null>(null);

  // SSE abort controller (用户 取消 / 卸载页面 时 取消)
  const abortRef = useRef<AbortController | null>(null);

  // 滚动 锚 — 新消息 / 流式 chunk 时 自动 滚到 底
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 第一次 进入 — 拉 agent + 该 agent 的 KB + 从 sessionStorage 恢复 history
  useEffect(() => {
    api.getAgent(agentId).then(
      (a) => setAgent(a),
      (e) => setAgentLoadErr(e instanceof Error ? e.message : "加载失败"),
    );
    // 恢复 history (跨 tab 不存, 关 浏览器 清)
    setMessages(loadFromSession(agentId));
  }, [agentId]);

  // 拉 该 agent 绑定 的 KB (sidebar "AI 底牌" 用)
  useEffect(() => {
    if (!agent?.knowledge_base_ids || agent.knowledge_base_ids.length === 0) {
      setKbList([]);
      return;
    }
    api.listKnowledgeBases().then(
      (all) => {
        const ids = new Set(agent.knowledge_base_ids ?? []);
        setKbList(all.filter((kb) => ids.has(kb.id)));
      },
      () => setKbList([]),
    );
  }, [agent?.knowledge_base_ids]);

  // 滚到 底
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // 持久 化 (每次 messages 变 都 写 sessionStorage)
  useEffect(() => {
    saveToSession(agentId, messages);
  }, [agentId, messages]);

  // 卸载 时 取消 流 + 关 麦克风
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      captureRef.current?.stop().catch(() => {});
      sttRef.current?.close();
    };
  }, []);

  const colorHex = agent
    ? AGENT_COLOR_HEX[agent.color || "violet"] || AGENT_COLOR_HEX.violet
    : "#8b5cf6";
  const displayName = agent
    ? (agent.nickname?.trim() || agent.name)
    : "AI";

  // === 发送 消息 (核心 流程) ===
  const sendMessage = useCallback(async () => {
    if (streaming) return;
    const text = input.trim();
    if (!text && pendingAttachments.length === 0) return;

    // 构 user 消息 + 占位 assistant 消息
    const userMsg: UIMessage = {
      id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: "user",
      content: text,
      done: true,
      attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
    };
    const assistantMsg: UIMessage = {
      id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: "assistant",
      content: "",
      done: false,
    };
    const nextMsgs = [...messages, userMsg, assistantMsg];
    setMessages(nextMsgs);
    setInput("");
    const attsToSend = pendingAttachments;
    setPendingAttachments([]);

    // 调 SSE
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // 构 后端 payload — 只 取 role+content, history 全量 push
    const apiMessages: ChatMessage[] = nextMsgs
      .slice(0, -1) // 去掉 占位 assistant
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      for await (const ev of streamChat({
        agentId,
        messages: apiMessages,
        attachments: attsToSend,
        signal: ctrl.signal,
      })) {
        if (ev.type === "chat_quota") {
          setQuotaRemaining(ev.remaining_today);
        } else if (ev.type === "agent_message_start") {
          // 流式 起头 — 占位 不动, 等 chunk
        } else if (ev.type === "agent_message_chunk") {
          setMessages((prev) => {
            const draft = prev.slice();
            const last = draft[draft.length - 1];
            if (last && last.role === "assistant" && !last.done) {
              draft[draft.length - 1] = { ...last, content: last.content + ev.chunk };
            }
            return draft;
          });
        } else if (ev.type === "agent_message_end") {
          setMessages((prev) => {
            const draft = prev.slice();
            const last = draft[draft.length - 1];
            if (last && last.role === "assistant") {
              draft[draft.length - 1] = {
                ...last,
                content: ev.text || last.content,
                citations: ev.citations,
                done: true,
              };
            }
            return draft;
          });
        } else if (ev.type === "chat_debug_info") {
          setMessages((prev) => {
            const draft = prev.slice();
            const last = draft[draft.length - 1];
            if (last && last.role === "assistant") {
              draft[draft.length - 1] = {
                ...last,
                debug: { kb_hits: ev.kb_hits, memory_hits: ev.memory_hits },
              };
            }
            return draft;
          });
        } else if (ev.type === "system") {
          if (ev.msg === "internal_error") {
            toast.error("AI 调用失败", { detail: "服务器 内部 错误" });
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        // 用户 主动 取消, 不报错
      } else {
        const detail = err instanceof Error ? err.message : String(err);
        toast.error("AI 调用失败", { detail });
        // 把 占位 assistant 标 done + 显 错误
        setMessages((prev) => {
          const draft = prev.slice();
          const last = draft[draft.length - 1];
          if (last && last.role === "assistant" && !last.done) {
            draft[draft.length - 1] = {
              ...last,
              content: `❌ ${detail}`,
              done: true,
            };
          }
          return draft;
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [agentId, input, messages, pendingAttachments, streaming]);

  // === 文件 上传 ===
  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files) return;
    if (pendingAttachments.length + files.length > 10) {
      toast.warn("最多 10 个附件");
      return;
    }
    for (const file of Array.from(files)) {
      try {
        const r = await api.parseChatFile(file);
        setPendingAttachments((prev) => [...prev, { filename: r.filename, text: r.text }]);
        toast.success(`✅ ${r.filename} 已解析 (${r.char_count} 字)`);
      } catch (e) {
        const detail = e instanceof Error ? e.message : "解析失败";
        toast.error(`${file.name} 解析失败`, { detail });
      }
    }
  }, [pendingAttachments.length]);

  // === 语音 输入 ===
  const toggleVoice = useCallback(async () => {
    if (voiceMode) {
      // 停止
      try { await captureRef.current?.stop(); } catch {}
      captureRef.current = null;
      sttRef.current?.close();
      sttRef.current = null;
      setVoiceMode(false);
      return;
    }
    // 启动
    try {
      const sock = openChatSttSocket({
        onEvent: (e) => {
          if (e.type === "transcript" && e.is_final && e.text) {
            // final 句 → 追加 到 输入框
            setInput((prev) => (prev ? prev + " " : "") + e.text);
          }
        },
        onClose: () => {
          sttRef.current = null;
        },
      });
      sttRef.current = sock;
      const cap = await startAudioCapture((frame) => sock.send(frame));
      captureRef.current = cap;
      setVoiceMode(true);
    } catch (err) {
      const detail =
        err instanceof MicPermissionError
          ? err.message
          : err instanceof Error
          ? err.message
          : "麦克风启动失败";
      toast.error("麦克风启动失败", { detail });
    }
  }, [voiceMode]);

  // === 清空 对话 ===
  const clearChat = useCallback(() => {
    if (!confirm("清空 当前 对话?\n(本来就 是 临时 的, 清完 不可恢复)")) return;
    setMessages([]);
    window.sessionStorage.removeItem(storageKey(agentId));
  }, [agentId]);

  // === 加载 / 错误 状态 ===
  if (agentLoadErr) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-10">
        <Link href="/" className="text-xs text-zinc-500 hover:text-accent-400">
          ← 返回 首页
        </Link>
        <div className="mt-12 rounded-xl border border-rose-500/30 bg-rose-500/5 p-6 text-center">
          <p className="text-sm text-rose-300">无法加载 AI 专家: {agentLoadErr}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-screen max-w-6xl flex-col px-4 py-4">
      {/* 顶部 chrome */}
      <header className="flex shrink-0 items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-2.5">
        <Link href="/" className="text-xs text-zinc-400 hover:text-accent-400">
          ← 返回
        </Link>
        <span className="h-5 w-px bg-ink-700" />
        <span className="text-base">🔧</span>
        <span className="text-sm font-medium text-amber-200">
          调试模式 · 内容不保留 (sessionStorage)
        </span>
        <div className="ml-auto flex items-center gap-3 text-xs">
          {quotaRemaining !== null && (
            <span className="text-zinc-500">
              今日剩余 <span className="text-zinc-300">{quotaRemaining}</span> 次
            </span>
          )}
          <button
            onClick={clearChat}
            disabled={streaming || messages.length === 0}
            className="rounded border border-ink-700 px-2 py-1 text-zinc-400 hover:bg-ink-800 disabled:opacity-30"
            title="清空对话"
          >
            🗑️ 清空
          </button>
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="rounded border border-ink-700 px-2 py-1 text-zinc-400 hover:bg-ink-800"
            title="折叠/展开 AI 底牌 sidebar"
          >
            {sidebarOpen ? "→" : "←"} 底牌
          </button>
        </div>
      </header>

      {/* 中间 grid: 左 主对话 / 右 sidebar */}
      <div className="mt-3 flex flex-1 gap-3 overflow-hidden">
        {/* 主对话 */}
        <section className="flex min-w-0 flex-1 flex-col rounded-xl border border-ink-700 bg-ink-900">
          {/* AI 身份 banner */}
          {agent && (
            <div className="flex shrink-0 items-center gap-3 border-b border-ink-800 px-4 py-3">
              <div
                className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full text-sm font-semibold text-white"
                style={{
                  background: agent.avatar_url ? undefined : colorHex,
                  boxShadow: `0 0 0 1.5px ${colorHex}40`,
                }}
              >
                {agent.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={agent.avatar_url} alt={displayName} className="h-full w-full object-cover" />
                ) : (
                  displayName.slice(0, 1).toUpperCase()
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-zinc-100">
                  {displayName}
                  {agent.nickname?.trim() && (
                    <span className="ml-2 text-xs font-normal text-zinc-500">
                      ｜ {agent.name}
                    </span>
                  )}
                </div>
                {agent.domain && (
                  <div className="truncate text-[11px] text-zinc-500">{agent.domain}</div>
                )}
              </div>
            </div>
          )}

          {/* 消息 列表 */}
          <div
            ref={scrollRef}
            className="scrollbar-thin flex-1 overflow-y-auto px-4 py-3 space-y-3"
          >
            {messages.length === 0 ? (
              <div className="rounded-lg border border-dashed border-ink-700 bg-ink-950 p-6 text-center text-xs text-zinc-500">
                跟 <span className="text-zinc-300">{displayName}</span> 聊点什么试试 ——
                <br />
                文本 · 上传 PDF/图片/Word · 麦克风 语音输入. 内容 不会 保留.
              </div>
            ) : (
              messages.map((m) => (
                <MessageBubble key={m.id} msg={m} agentName={displayName} colorHex={colorHex} />
              ))
            )}
          </div>

          {/* Pending attachments 预览 */}
          {pendingAttachments.length > 0 && (
            <div className="border-t border-ink-800 px-4 py-2">
              <div className="flex flex-wrap gap-1.5">
                {pendingAttachments.map((a, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-full bg-accent-500/15 px-2 py-0.5 text-[10px] text-accent-200"
                  >
                    📎 {a.filename} ({a.text.length} 字)
                    <button
                      type="button"
                      onClick={() =>
                        setPendingAttachments((prev) => prev.filter((_, idx) => idx !== i))
                      }
                      className="text-accent-100 hover:text-rose-300"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 输入栏 */}
          <div className="shrink-0 border-t border-ink-800 px-3 py-2">
            <div className="flex items-end gap-2">
              <label
                title="上传 PDF / 图片 / Word (≤ 20MB)"
                className="shrink-0 cursor-pointer rounded-lg border border-ink-700 bg-ink-950 px-2.5 py-2 text-base text-zinc-400 hover:border-accent-500/40 hover:text-zinc-200"
              >
                📎
                <input
                  type="file"
                  multiple
                  accept=".pdf,.docx,.xlsx,.txt,.md,.png,.jpg,.jpeg,.webp"
                  className="hidden"
                  onChange={(e) => {
                    handleFileSelect(e.target.files);
                    e.target.value = ""; // 让 同一文件 二次选 也触发 onChange
                  }}
                  disabled={streaming}
                />
              </label>
              <button
                type="button"
                onClick={toggleVoice}
                disabled={streaming}
                title={voiceMode ? "停止 录音" : "开始 语音输入"}
                className={`shrink-0 rounded-lg border px-2.5 py-2 text-base transition ${
                  voiceMode
                    ? "border-rose-500 bg-rose-500/15 text-rose-300 animate-pulse"
                    : "border-ink-700 bg-ink-950 text-zinc-400 hover:border-accent-500/40 hover:text-zinc-200"
                }`}
              >
                {voiceMode ? "⏹" : "🎤"}
              </button>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder={voiceMode ? "🎤 录音中... 说完会自动转文字" : "输入消息 (Enter 发送, Shift+Enter 换行)"}
                rows={1}
                className="flex-1 resize-none rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-accent-500 focus:outline-none"
                style={{ maxHeight: 120 }}
                disabled={streaming}
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={streaming || (!input.trim() && pendingAttachments.length === 0)}
                className="shrink-0 rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white shadow disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-400"
              >
                {streaming ? "..." : "发送"}
              </button>
            </div>
          </div>
        </section>

        {/* 右侧 sidebar: AI 底牌 */}
        {sidebarOpen && agent && (
          <aside className="hidden w-72 shrink-0 flex-col gap-3 overflow-y-auto rounded-xl border border-ink-700 bg-ink-900 p-3 lg:flex">
            <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              🃏 AI 底牌
            </h3>
            <div>
              <div className="text-[10px] text-zinc-500">人格 / 风格</div>
              <p className="mt-1 text-xs leading-5 text-zinc-300">
                {agent.persona?.trim() || "(未填写 persona)"}
              </p>
            </div>
            {agent.tone && (
              <div>
                <div className="text-[10px] text-zinc-500">语气</div>
                <p className="mt-1 text-xs text-zinc-300">{agent.tone}</p>
              </div>
            )}
            {agent.boundary && (
              <div>
                <div className="text-[10px] text-zinc-500">边界</div>
                <p className="mt-1 text-xs text-zinc-300">{agent.boundary}</p>
              </div>
            )}
            {(agent.keywords ?? []).length > 0 && (
              <div>
                <div className="text-[10px] text-zinc-500">触发关键词</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(agent.keywords ?? []).map((k) => (
                    <span
                      key={k}
                      className="rounded-full border border-ink-700 bg-ink-950 px-2 py-0.5 text-[10px] text-zinc-400"
                    >
                      {k}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="text-[10px] text-zinc-500">
                绑定 KB ({kbList.length})
              </div>
              {kbList.length === 0 ? (
                <p className="mt-1 text-[11px] text-zinc-600">(无)</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {kbList.map((kb) => (
                    <li key={kb.id}>
                      <Link
                        href={`/me/profile/knowledge/${kb.id}`}
                        className="block truncate rounded border border-ink-700 bg-ink-950 px-2 py-1 text-[11px] text-zinc-300 hover:border-accent-500/40 hover:text-zinc-100"
                        title={kb.description ?? ""}
                      >
                        📚 {kb.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {/* 调试信息 — 最后 一条 assistant 的 召回 数 */}
            {(() => {
              const last = [...messages].reverse().find((m) => m.role === "assistant" && m.debug);
              if (!last?.debug) return null;
              return (
                <div className="mt-auto rounded-lg border border-violet-500/30 bg-violet-500/5 p-2 text-[10px]">
                  <div className="text-violet-200">📊 上一次 召回</div>
                  <div className="mt-1 text-zinc-400">
                    KB chunks: <span className="text-zinc-200">{last.debug.kb_hits}</span>
                  </div>
                  <div className="text-zinc-400">
                    memory: <span className="text-zinc-200">{last.debug.memory_hits}</span>
                  </div>
                </div>
              );
            })()}
          </aside>
        )}
      </div>
    </main>
  );
}

// ============================================================================
// 消息气泡
// ============================================================================
function MessageBubble({
  msg,
  agentName,
  colorHex,
}: {
  msg: UIMessage;
  agentName: string;
  colorHex: string;
}) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-accent-500/15 px-3 py-2 text-sm text-zinc-100">
          {msg.content && <div className="whitespace-pre-wrap">{msg.content}</div>}
          {msg.attachments && msg.attachments.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {msg.attachments.map((a, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-full bg-accent-500/20 px-2 py-0.5 text-[10px] text-accent-100"
                >
                  📎 {a.filename}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
  // assistant
  return (
    <div className="flex gap-2">
      <div
        className="shrink-0 grid h-8 w-8 place-items-center rounded-full text-[10px] font-semibold text-white"
        style={{ backgroundColor: colorHex }}
      >
        {agentName.slice(0, 1).toUpperCase()}
      </div>
      <div className="max-w-[80%] rounded-2xl rounded-tl-md bg-ink-950 px-3 py-2 text-sm text-zinc-100">
        {msg.content ? (
          <div className="whitespace-pre-wrap">
            {msg.content}
            {!msg.done && <span className="ml-1 animate-pulse">▌</span>}
          </div>
        ) : (
          <span className="text-zinc-500 italic">思考中…</span>
        )}
        {msg.done && msg.citations && msg.citations.length > 0 && (
          <div className="mt-2 border-t border-ink-800 pt-1.5">
            <div className="text-[9px] text-zinc-500">📚 召回 来源:</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {msg.citations.slice(0, 5).map((c, i) => (
                <span
                  key={c.chunk_id}
                  title={c.snippet}
                  className="cursor-help rounded-full border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[9px] text-zinc-500"
                >
                  [{i + 1}] {c.document_filename}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
