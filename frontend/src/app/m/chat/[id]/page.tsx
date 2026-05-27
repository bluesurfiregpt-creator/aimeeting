"use client";

/**
 * v1.4.0 Phase B · 8 · NEW-C (NORTH_STAR § 6.2 · 痛点 7): Mobile 1-on-1 跟 AI 对话.
 *
 * 用户场景: 不在会议里 临时 想 找 Mira / 某 AI 问问题. Backend `_call_for_chat`
 * (v26.13.1) + Web `/chat/[id]` (747 行) 已 ready, Mobile 从 0 加 简版.
 *
 * 简版 范围 (Phase B):
 *  - 浅色 iOS bubble (user 右蓝 / assistant 左灰)
 *  - SSE 流式 chunk
 *  - sessionStorage 持久 (跟 Web 一致, 关 tab 清)
 *  - 顶部 返回 + AI 头像 + name + "私聊 · 关闭即清" 警告
 *  - 底部 sticky 输入栏 + safe-area
 *
 * 不在 本 commit (留 Phase C/D 升级):
 *  - 文件 上传 / mic / 语音 输入
 *  - 右侧 AI 底牌 sidebar
 *  - KB miss hint + Perplexity 补充
 *  - chat quota indicator (用户 几乎 触不到, 后端 50/天 兜底)
 */

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { streamChat, type ChatMessage } from "@/lib/chatStream";
import { mApi } from "@/lib/mobile/api";
import type { AgentDetailOut } from "@/lib/mobile/types";
import { MR_COLORS } from "@/components/mobile/meeting-room/styles";

type UIMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  done: boolean;
};

function storageKey(agentId: string): string {
  return `aimeeting:m-chat:${agentId}`;
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
  } catch {
    /* 静默 */
  }
}

export default function MobileChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: agentId } = use(params);
  const [agent, setAgent] = useState<AgentDetailOut | null>(null);
  const [agentLoadErr, setAgentLoadErr] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 拉 agent + 恢复 history
  useEffect(() => {
    mApi.getAgentDetail(agentId).then(
      (a) => setAgent(a),
      (e) => setAgentLoadErr(e instanceof Error ? e.message : "加载失败"),
    );
    setMessages(loadFromSession(agentId));
  }, [agentId]);

  // 持久化
  useEffect(() => {
    saveToSession(agentId, messages);
  }, [agentId, messages]);

  // auto scroll 到底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [messages]);

  // 取消 mid-stream (页面离开 / abort)
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const agentDisplayName = useMemo(() => {
    if (!agent) return "AI 专家";
    return (agent.nickname && agent.nickname.trim()) || agent.name;
  }, [agent]);

  const agentColor = useMemo(() => {
    if (!agent?.color) return "#5E5CE6";
    const c = agent.color;
    return c.startsWith("#") ? c : `#${c}`;
  }, [agent]);

  const sendMessage = useCallback(async () => {
    if (streaming) return;
    const text = input.trim();
    if (!text) return;

    const userMsg: UIMessage = {
      id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: "user",
      content: text,
      done: true,
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
    setStreaming(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const apiMessages: ChatMessage[] = nextMsgs
      .slice(0, -1) // 去掉 占位 assistant
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      for await (const ev of streamChat({
        agentId,
        messages: apiMessages,
        signal: ctrl.signal,
      })) {
        if (ev.type === "agent_message_chunk") {
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
                done: true,
              };
            }
            return draft;
          });
        }
        // agent_message_start / chat_debug_info / kb_miss_hint / system: 简版 忽略
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        const detail = err instanceof Error ? err.message : String(err);
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
  }, [agentId, input, messages, streaming]);

  // ─── Render ───

  if (agentLoadErr) {
    return (
      <div
        style={{
          padding: 20,
          textAlign: "center",
          color: MR_COLORS.systemRed,
          fontSize: 14,
        }}
      >
        加载 AI 专家失败: {agentLoadErr}
      </div>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        background: MR_COLORS.bgGroupedPrimary,
        fontFamily:
          '-apple-system, "PingFang SC", system-ui, sans-serif',
      }}
    >
      {/* === 顶部 === */}
      <header
        data-testid="m-chat-header"
        style={{
          flexShrink: 0,
          background: MR_COLORS.bgWhite,
          borderBottom: `0.5px solid ${MR_COLORS.separatorLight}`,
          padding: "calc(env(safe-area-inset-top, 0px) + 8px) 12px 8px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Link
          href="/m"
          aria-label="返回"
          style={{
            width: 32,
            height: 32,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 16,
            color: MR_COLORS.systemBlue,
            fontSize: 18,
            textDecoration: "none",
            fontFamily: "inherit",
          }}
        >
          ←
        </Link>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            background: agentColor,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          {agentDisplayName.charAt(0)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: MR_COLORS.textPrimary,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {agentDisplayName}
          </div>
          <div
            style={{
              marginTop: 1,
              fontSize: 11,
              color: MR_COLORS.textTertiary,
            }}
          >
            私聊 · 关闭页 即清
          </div>
        </div>
      </header>

      {/* === 消息 列表 === */}
      <div
        ref={scrollRef}
        className="mobile-scroll-area"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 12px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              padding: "40px 24px",
              textAlign: "center",
              color: MR_COLORS.textTertiary,
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>💬</div>
            <div style={{ color: MR_COLORS.textSecondary, marginBottom: 4 }}>
              跟 {agentDisplayName} 临时聊聊
            </div>
            <div>没有会议背景, 直接 问 任何 你 关心 的</div>
          </div>
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              msg={m}
              agentDisplayName={agentDisplayName}
              agentColor={agentColor}
            />
          ))
        )}
      </div>

      {/* === 底部 输入栏 === */}
      <footer
        style={{
          flexShrink: 0,
          background: MR_COLORS.bgWhite,
          borderTop: `0.5px solid ${MR_COLORS.separatorLight}`,
          padding: "8px 10px calc(env(safe-area-inset-bottom, 0px) + 8px)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <input
          data-testid="m-chat-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !(e.nativeEvent as unknown as { isComposing?: boolean })
                .isComposing
            ) {
              e.preventDefault();
              void sendMessage();
            }
          }}
          placeholder={
            streaming ? `${agentDisplayName} 正在回复…` : "问一句吧…"
          }
          disabled={streaming}
          style={{
            flex: 1,
            minWidth: 0,
            height: 36,
            padding: "0 12px",
            borderRadius: 18,
            border: `0.5px solid ${MR_COLORS.hairlineStrong}`,
            background: MR_COLORS.bgInputFill,
            fontSize: 14,
            fontFamily: "inherit",
            color: MR_COLORS.textPrimary,
            outline: "none",
          }}
        />
        <button
          type="button"
          onClick={() => void sendMessage()}
          disabled={!input.trim() || streaming}
          aria-label="发送"
          data-testid="m-chat-send"
          style={{
            flexShrink: 0,
            width: 36,
            height: 36,
            borderRadius: 18,
            border: "none",
            background: input.trim() && !streaming
              ? MR_COLORS.systemBlue
              : MR_COLORS.bgInputFill,
            color: "#fff",
            cursor: input.trim() && !streaming ? "pointer" : "default",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 16,
            fontFamily: "inherit",
          }}
        >
          ↑
        </button>
      </footer>
    </div>
  );
}

function MessageBubble({
  msg,
  agentDisplayName,
  agentColor,
}: {
  msg: UIMessage;
  agentDisplayName: string;
  agentColor: string;
}) {
  const isUser = msg.role === "user";
  return (
    <div
      data-testid={isUser ? "m-chat-msg-user" : "m-chat-msg-ai"}
      style={{
        display: "flex",
        flexDirection: isUser ? "row-reverse" : "row",
        alignItems: "flex-end",
        gap: 6,
        maxWidth: "100%",
      }}
    >
      {!isUser ? (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            background: agentColor,
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 700,
            flexShrink: 0,
            marginBottom: 2,
          }}
          aria-hidden="true"
        >
          {agentDisplayName.charAt(0)}
        </div>
      ) : null}
      <div
        style={{
          maxWidth: "78%",
          padding: "8px 12px",
          borderRadius: 16,
          background: isUser ? MR_COLORS.systemBlue : MR_COLORS.bgWhite,
          color: isUser ? "#fff" : MR_COLORS.textPrimary,
          fontSize: 14,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          border: isUser
            ? "none"
            : `0.5px solid ${MR_COLORS.separatorLight}`,
          // 流式 中 visual hint — assistant 不 done 时 加 cursor
          position: "relative",
        }}
      >
        {msg.content || (msg.role === "assistant" && !msg.done ? "…" : "")}
        {msg.role === "assistant" && !msg.done && msg.content ? (
          <span
            style={{
              display: "inline-block",
              width: 6,
              height: 14,
              background: MR_COLORS.textTertiary,
              marginLeft: 2,
              verticalAlign: "text-bottom",
              animation: "mrLivePulse 1s steps(2) infinite",
            }}
            aria-hidden="true"
          />
        ) : null}
      </div>
    </div>
  );
}
