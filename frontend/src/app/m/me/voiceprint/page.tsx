"use client";

/**
 * v27.0-mobile P22 · /m/me/voiceprint · 声纹库管理 (移动端).
 *
 * 跟桌面端 /me/profile/voiceprints 同一套模型:
 *   - 声纹库 = workspace 级共享, 列出所有 user + has_voiceprint 标记
 *   - 任何 user 可看列表; leader+ 才能录入 / 重录 / 删除
 *   - "录新人" 流程: 输姓名 → POST /api/users 建 speaker-only profile →
 *     POST /api/voiceprints { user_id, audio }
 *   - 重录已有: 选列表里某人 → POST /api/voiceprints { user_id: 同, audio }
 *
 * UI 两态:
 *   - listing: 列表 + 顶部"+ 录新人"按钮 (leader+ 显) + 每行点击重录
 *   - recording: 模态全屏 — 输姓名 + 录音 + 上传
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { mApi } from "@/lib/mobile/api";
import { api as desktopApi } from "@/lib/api";
import { startAudioCapture, type AudioCaptureHandle } from "@/lib/audioCapture";
import Toast from "@/components/mobile/Toast";

const TARGET_SECONDS = 30;
const MAX_SECONDS = 60;
const MIN_SUBMIT_SECONDS = 20;

const SCRIPTS: { title: string; text: string }[] = [
  {
    title: "午后阅读",
    text: "我喜欢在安静的午后捧一本书, 坐在阳台上慢慢翻看. 窗外的阳光斜斜地洒在书页上, 远处偶尔传来几声鸟鸣. 读书最让人愉快的, 不是读完一本厚厚的著作那种成就感, 而是在某一页突然遇到一句让自己心里一动的话. 那一刻, 你会感觉作者像是在跟你说话.",
  },
  {
    title: "清晨小镇",
    text: "清晨的城市还没有完全醒过来. 地铁站门口排着稀疏的队, 便利店刚把热饮的招牌摆出来. 我点了一杯热豆浆和一个茶叶蛋, 靠在落地窗边吃完. 这样一份普通的早餐, 却让我觉得新的一天有了盼头.",
  },
  {
    title: "学习新事",
    text: "学一件新东西的开头总是最难的. 你会反复怀疑自己, 会觉得别人都比你聪明, 会想干脆放弃算了. 但只要你能撑过最难受的那两三周, 事情就会突然变得清晰. 原本看不懂的概念开始有了意义.",
  },
];

type Phase = "idle" | "recording" | "uploading";

type WUser = {
  id: string;
  name: string;
  email: string | null;
  has_voiceprint: boolean;
  created_at: string;
};

export default function MobileVoiceprintLibraryPage() {
  // 列表
  const [users, setUsers] = useState<WUser[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);

  // 当前 caller 是否 leader+ (影响"+ 录新人"和"重录/删除"按钮显)
  const [isAdmin, setIsAdmin] = useState(false);

  // 录入面板 state
  const [recordOpen, setRecordOpen] = useState(false);
  const [targetUserId, setTargetUserId] = useState<string | null>(null);
  // null = 录新人 (要输姓名); 非 null = 重录已有
  const [name, setName] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [scriptIdx, setScriptIdx] = useState(0);
  const script = SCRIPTS[scriptIdx];
  const nextScript = useMemo(
    () => () => setScriptIdx((i) => (i + 1) % SCRIPTS.length),
    [],
  );

  const captureRef = useRef<AudioCaptureHandle | null>(null);
  const bufRef = useRef<Uint8Array[]>([]);
  const tickRef = useRef<number | null>(null);

  const [toast, setToast] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  // 拉列表 + me (判断 isAdmin)
  const refresh = useCallback(async () => {
    try {
      const list = await mApi.listWorkspaceUsers();
      setUsers(list);
      setListErr(null);
    } catch (e) {
      setListErr(e instanceof Error ? e.message : "加载失败");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const me = await desktopApi.me();
        if (!alive) return;
        const role = me.role;
        setIsAdmin(role === "owner" || role === "admin" || role === "leader");
      } catch {
        /* ignore */
      }
    })();
    void refresh();
    return () => {
      alive = false;
    };
  }, [refresh]);

  // 排序: 已录在前, 按 created_at 倒序
  const sortedUsers = useMemo(() => {
    if (!users) return null;
    return [...users].sort((a, b) => {
      if (a.has_voiceprint !== b.has_voiceprint) {
        return a.has_voiceprint ? -1 : 1;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [users]);

  const enrolledCount = useMemo(
    () => (users || []).filter((u) => u.has_voiceprint).length,
    [users],
  );

  // 开"录新人"
  const onOpenRecordNew = useCallback(() => {
    setTargetUserId(null);
    setName("");
    setPhase("idle");
    setSeconds(0);
    setRecordOpen(true);
  }, []);

  // 重录已有
  const onOpenRecordFor = useCallback((u: WUser) => {
    setTargetUserId(u.id);
    setName(u.name);
    setPhase("idle");
    setSeconds(0);
    setRecordOpen(true);
  }, []);

  // 删除某 user 声纹
  const onDeleteFor = useCallback(
    async (u: WUser) => {
      if (
        !confirm(
          `撤销 「${u.name}」 的声纹? 撤销后会议中无法自动识别 TA 的发言.`,
        )
      ) {
        return;
      }
      try {
        await mApi.deleteVoiceprintForUser(u.id);
        setToast({ kind: "success", text: "已撤销" });
        await refresh();
      } catch (e) {
        setToast({
          kind: "error",
          text: e instanceof Error ? `撤销失败: ${e.message}` : "撤销失败",
        });
      }
    },
    [refresh],
  );

  // ===== 录音 =====

  const start = useCallback(async () => {
    if (phase !== "idle") return;
    if (!targetUserId && !name.trim()) {
      setToast({ kind: "error", text: "请先填姓名" });
      return;
    }
    bufRef.current = [];
    setSeconds(0);
    setPhase("recording");
    try {
      const cap = await startAudioCapture((frame) => {
        bufRef.current.push(new Uint8Array(frame));
      });
      captureRef.current = cap;
      const startedAt = performance.now();
      tickRef.current = window.setInterval(() => {
        const s = (performance.now() - startedAt) / 1000;
        setSeconds(s);
        if (s >= MAX_SECONDS) void stop(true);
      }, 200);
    } catch (e) {
      setPhase("idle");
      setToast({
        kind: "error",
        text:
          e instanceof Error
            ? `麦克风启动失败: ${e.message}`
            : "麦克风启动失败",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, targetUserId, name]);

  const stop = useCallback(
    async (autoSubmit = false) => {
      if (tickRef.current) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
      try {
        await captureRef.current?.stop();
      } catch {
        /* ignore */
      }
      captureRef.current = null;

      const finalSec = seconds;
      if (bufRef.current.length === 0 || finalSec < 1) {
        setPhase("idle");
        setToast({ kind: "error", text: "没录到声音" });
        return;
      }

      if (!autoSubmit && finalSec < MIN_SUBMIT_SECONDS) {
        setPhase("idle");
        setToast({
          kind: "error",
          text: `录了 ${finalSec.toFixed(0)}s, 至少 ${MIN_SUBMIT_SECONDS}s 才能提交`,
        });
        return;
      }

      const totalLen = bufRef.current.reduce((n, b) => n + b.byteLength, 0);
      const merged = new Uint8Array(totalLen);
      let p = 0;
      for (const b of bufRef.current) {
        merged.set(b, p);
        p += b.byteLength;
      }
      const blob = new Blob([merged], { type: "application/octet-stream" });

      setPhase("uploading");
      try {
        let userId = targetUserId;
        if (!userId) {
          // 新人 — 先建 speaker profile
          const created = await mApi.createSpeakerUser(name.trim());
          userId = created.id;
        }
        await mApi.uploadVoiceprint(userId, blob);
        setToast({
          kind: "success",
          text: targetUserId
            ? `${name} 重新录入成功`
            : `${name} 声纹录入成功`,
        });
        setRecordOpen(false);
        await refresh();
      } catch (e) {
        setPhase("idle");
        setToast({
          kind: "error",
          text: e instanceof Error ? e.message : "上传失败",
        });
      }
    },
    [seconds, targetUserId, name, refresh],
  );

  // 卸载时清资源
  useEffect(
    () => () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      captureRef.current?.stop().catch(() => {});
    },
    [],
  );

  const target = Math.min(seconds / TARGET_SECONDS, 1);
  const total = users?.length ?? 0;

  return (
    <div className="flex min-h-screen flex-col">
      {/* 顶栏 */}
      <div
        className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink-800 bg-ink-950/85 px-4 pb-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Link
          href="/m/me"
          className="-ml-2 flex h-10 w-10 items-center justify-center text-zinc-300 active:text-zinc-50"
          aria-label="返回"
        >
          <span className="text-2xl leading-none">←</span>
        </Link>
        <h1 className="flex-1 truncate text-[18px] font-semibold text-zinc-50">
          声纹库
        </h1>
      </div>

      <main className="flex-1 space-y-4 p-4 pb-8">
        {/* 概要 + 录新人按钮 */}
        <section className="rounded-2xl bg-ink-900 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[18px] font-semibold text-zinc-50">
                工作区声纹 · {enrolledCount}/{total}
              </p>
              <p className="mt-1 text-[12px] leading-snug text-zinc-400">
                已录 {enrolledCount} 人 · 共 {total} 人. 会议中系统自动识别已录者发言.
              </p>
            </div>
            {isAdmin ? (
              <button
                type="button"
                onClick={onOpenRecordNew}
                className="shrink-0 rounded-full bg-accent-500 px-4 py-2 text-[13px] font-medium text-white active:scale-[0.97] active:bg-accent-600"
                data-testid="voiceprint-add-new"
              >
                + 录新人
              </button>
            ) : null}
          </div>
          {!isAdmin ? (
            <p className="mt-3 text-[12px] text-amber-300">
              ⚠ 只有 leader / admin / owner 可以录入或修改声纹.
            </p>
          ) : null}
        </section>

        {/* 列表 */}
        {listErr ? (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/[0.06] p-3 text-[13px] text-rose-300">
            {listErr}
          </div>
        ) : null}

        {users === null ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-2xl bg-ink-900"
              />
            ))}
          </div>
        ) : sortedUsers && sortedUsers.length > 0 ? (
          <ul className="space-y-2">
            {sortedUsers.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-3 rounded-2xl bg-ink-900 p-4"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-accent-500 text-[18px] font-semibold text-white">
                  {u.name.slice(0, 1)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-zinc-50">
                    {u.name}
                  </p>
                  <p className="mt-0.5 text-[12px] text-zinc-500">
                    {u.has_voiceprint ? (
                      <span className="text-emerald-300">● 已录入</span>
                    ) : (
                      <span className="text-zinc-500">○ 未录入</span>
                    )}
                    {u.email ? (
                      <span className="ml-2 text-zinc-600">· {u.email}</span>
                    ) : null}
                  </p>
                </div>
                {isAdmin ? (
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      onClick={() => onOpenRecordFor(u)}
                      className="rounded-full bg-ink-800 px-3 py-1.5 text-[12px] text-zinc-200 active:bg-ink-700"
                    >
                      {u.has_voiceprint ? "重录" : "录入"}
                    </button>
                    {u.has_voiceprint ? (
                      <button
                        type="button"
                        onClick={() => void onDeleteFor(u)}
                        className="rounded-full border border-rose-500/30 px-3 py-1.5 text-[12px] text-rose-300 active:bg-rose-500/[0.06]"
                      >
                        撤销
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center">
            <p className="text-[14px] text-zinc-400">工作区里 没人</p>
            {isAdmin ? (
              <p className="mt-2 text-[12px] text-zinc-500">
                点上面的 + 录新人 添加一个人
              </p>
            ) : null}
          </div>
        )}
      </main>

      {/* 录音 模态 */}
      {recordOpen ? (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-ink-950"
          data-testid="voiceprint-record-modal"
        >
          {/* 顶栏 */}
          <div
            className="sticky top-0 z-10 flex items-center gap-3 border-b border-ink-800 bg-ink-950/85 px-4 pb-3 backdrop-blur"
            style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
          >
            <button
              type="button"
              onClick={() => {
                if (phase === "recording" || phase === "uploading") return;
                setRecordOpen(false);
              }}
              className="-ml-2 flex h-10 w-10 items-center justify-center text-zinc-300 active:text-zinc-50"
              aria-label="关闭"
            >
              <span className="text-2xl leading-none">×</span>
            </button>
            <h2 className="flex-1 truncate text-[17px] font-semibold text-zinc-50">
              {targetUserId ? `重录 · ${name}` : "录入新人"}
            </h2>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {/* 姓名 — 新人才能编辑 */}
            <section>
              <label className="text-[12px] text-zinc-500">姓名</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!!targetUserId || phase !== "idle"}
                placeholder="例: 张三"
                maxLength={40}
                className="mt-1 h-11 w-full rounded-xl bg-ink-900 px-3 text-[16px] text-zinc-50 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-accent-500 disabled:opacity-60"
              />
            </section>

            {/* 朗读文 */}
            <section
              className={`rounded-2xl border p-4 transition ${
                phase === "recording"
                  ? "border-accent-500/60 bg-accent-500/5"
                  : "border-ink-800 bg-ink-900"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="rounded bg-ink-800 px-2 py-0.5 text-[12px] text-zinc-400">
                  朗读 · {script.title}
                </span>
                <button
                  type="button"
                  onClick={nextScript}
                  disabled={phase !== "idle"}
                  className="text-[12px] text-zinc-500 active:text-accent-400 disabled:opacity-40"
                >
                  换一段 ↻
                </button>
              </div>
              <p
                className={`mt-3 text-[15px] leading-loose tracking-wide ${
                  phase === "recording" ? "text-white" : "text-zinc-200"
                }`}
              >
                {script.text}
              </p>
              <p className="mt-3 text-[12px] text-zinc-500">
                正常 语速 读完一遍 约 30-45 秒. 不够 30s 接着重复.
              </p>
            </section>

            {/* 进度 */}
            <section className="rounded-2xl bg-ink-900 p-4">
              <div className="flex items-center justify-between text-[13px] text-zinc-500">
                <span>
                  已录 {seconds.toFixed(1)}s · 目标 {MIN_SUBMIT_SECONDS}-{MAX_SECONDS}s
                </span>
                <span>
                  {phase === "recording"
                    ? "录音中"
                    : phase === "uploading"
                      ? "上传中"
                      : "未开始"}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-800">
                <div
                  className="h-full bg-accent-500 transition-all"
                  style={{ width: `${target * 100}%` }}
                />
              </div>
            </section>

            {/* 大圆按钮 */}
            <section className="flex flex-col items-center pt-2">
              {phase === "idle" ? (
                <button
                  type="button"
                  onClick={() => void start()}
                  className="flex h-20 w-20 items-center justify-center rounded-full bg-accent-500 text-3xl text-white shadow-lg shadow-accent-500/30 active:scale-95"
                >
                  🎙
                </button>
              ) : phase === "recording" ? (
                <button
                  type="button"
                  onClick={() => void stop(false)}
                  className={`flex h-20 w-20 items-center justify-center rounded-full text-3xl text-white shadow-lg transition active:scale-95 ${
                    seconds >= MIN_SUBMIT_SECONDS
                      ? "bg-rose-500 shadow-rose-500/30"
                      : "bg-zinc-700 shadow-zinc-700/30"
                  }`}
                >
                  ■
                </button>
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-violet-500/20 text-3xl">
                  <span className="animate-pulse">⏳</span>
                </div>
              )}
              <p className="mt-3 text-[13px] text-zinc-400">
                {phase === "idle" && "点击开始录音"}
                {phase === "recording" &&
                  (seconds >= MIN_SUBMIT_SECONDS
                    ? `已录 ${seconds.toFixed(0)}s, 点击提交`
                    : `继续录到 ${MIN_SUBMIT_SECONDS}s 以上`)}
                {phase === "uploading" && "正在生成声纹 (5-15s)..."}
              </p>
            </section>
          </div>
        </div>
      ) : null}

      {toast ? (
        <Toast
          kind={toast.kind}
          text={toast.text}
          onClose={() => setToast(null)}
        />
      ) : null}
    </div>
  );
}
