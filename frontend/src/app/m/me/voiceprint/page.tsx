"use client";

/**
 * v27.0-mobile P22 · /m/me/voiceprint · 声纹录入页 (移动端).
 *
 * 跟 桌面端 /me/profile/voiceprints 同一套底层 (startAudioCapture 走
 * MediaRecorder + AudioContext 重采样到 16kHz mono Int16 PCM), 但 UI
 * 适配移动端单手操作:
 *   - 顶部朗读文 + "换一段"
 *   - 大圆按钮 开始 / 停止 录音
 *   - 进度条 + 秒数
 *   - 录够 20s+ 自动允许上传 / 60s 自动停
 *   - 上传中 跑 toast 等 pyannote 返结果
 *
 * 跟桌面端的区别:
 *   - 只能给"自己"录 (不需要选择 user)
 *   - 后端 ABAC v27.0-mobile P22 已加 自己-录-自己 豁免
 *   - 提交 user_id = auth.user.id (从 /api/auth/me 拿)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { mApi } from "@/lib/mobile/api";
import { api as desktopApi } from "@/lib/api";
import { startAudioCapture, type AudioCaptureHandle } from "@/lib/audioCapture";
import Toast from "@/components/mobile/Toast";

const TARGET_SECONDS = 30;
const MAX_SECONDS = 60;
const MIN_SUBMIT_SECONDS = 20;

// 跟桌面端共享同一组朗读文本
const SCRIPTS: { title: string; text: string }[] = [
  {
    title: "午后阅读",
    text: "我喜欢在安静的午后捧一本书, 坐在阳台上慢慢翻看. 窗外的阳光斜斜地洒在书页上, 远处偶尔传来几声鸟鸣. 读书最让人愉快的, 不是读完一本厚厚的著作那种成就感, 而是在某一页突然遇到一句让自己心里一动的话. 那一刻, 你会感觉作者像是在跟你说话.",
  },
  {
    title: "清晨小镇",
    text: "清晨的城市还没有完全醒过来. 地铁站门口排着稀疏的队, 便利店刚把热饮的招牌摆出来. 我点了一杯热豆浆和一个茶叶蛋, 靠在落地窗边吃完. 这样一份普通的早餐, 却让我觉得新的一天有了盼头. 我想, 所谓生活, 大概就是由这样一个个不起眼的瞬间慢慢拼起来的.",
  },
  {
    title: "学习新事",
    text: "学一件新东西的开头总是最难的. 你会反复怀疑自己, 会觉得别人都比你聪明, 会想干脆放弃算了. 但只要你能撑过最难受的那两三周, 事情就会突然变得清晰. 原本看不懂的概念开始有了意义, 原本笨拙的动作也慢慢顺手起来. 后来你回头看, 会觉得当时的自己只是缺一点点耐心而已.",
  },
];

type Phase = "idle" | "recording" | "uploading" | "done";

export default function MobileVoiceprintPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [scriptIdx, setScriptIdx] = useState(() =>
    Math.floor(Math.random() * SCRIPTS.length),
  );
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [currentVoiceprint, setCurrentVoiceprint] = useState<{
    sample_seconds: number | null;
    version: number;
    created_at: string;
  } | null>(null);
  const [toast, setToast] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  const captureRef = useRef<AudioCaptureHandle | null>(null);
  const bufRef = useRef<Uint8Array[]>([]);
  const tickRef = useRef<number | null>(null);

  const script = SCRIPTS[scriptIdx];
  const nextScript = useMemo(
    () => () => setScriptIdx((i) => (i + 1) % SCRIPTS.length),
    [],
  );

  // 拉 当前用户 id + 已录声纹状态
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const me = await desktopApi.me();
        if (!alive) return;
        setMyUserId(me.user_id);
      } catch {
        // ignore
      }
      try {
        const vp = await mApi.getMyVoiceprint();
        if (!alive) return;
        setCurrentVoiceprint(vp);
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const start = useCallback(async () => {
    if (phase !== "idle" && phase !== "done") return;
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
  }, [phase]);

  const stop = useCallback(
    async (autoSubmit: boolean = false) => {
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

      // 提交条件: ≥ 20 秒 (autoSubmit 总是提交即使 < 20s 也尝试 — 后端会做更严格校验)
      if (!autoSubmit && finalSec < MIN_SUBMIT_SECONDS) {
        setPhase("idle");
        setToast({
          kind: "error",
          text: `录了 ${finalSec.toFixed(0)}s, 至少 ${MIN_SUBMIT_SECONDS}s 才能提交`,
        });
        return;
      }

      // 拼 PCM
      const totalLen = bufRef.current.reduce((n, b) => n + b.byteLength, 0);
      const merged = new Uint8Array(totalLen);
      let p = 0;
      for (const b of bufRef.current) {
        merged.set(b, p);
        p += b.byteLength;
      }
      const blob = new Blob([merged], { type: "application/octet-stream" });

      if (!myUserId) {
        setPhase("idle");
        setToast({ kind: "error", text: "未拿到用户身份, 请刷新重试" });
        return;
      }

      setPhase("uploading");
      try {
        await mApi.uploadVoiceprint(myUserId, blob);
        setPhase("done");
        setToast({ kind: "success", text: "声纹录入成功" });
        // 拉新状态
        try {
          const vp = await mApi.getMyVoiceprint();
          setCurrentVoiceprint(vp);
        } catch {
          /* ignore */
        }
      } catch (e) {
        setPhase("idle");
        setToast({
          kind: "error",
          text: e instanceof Error ? e.message : "上传失败",
        });
      }
    },
    [seconds, myUserId],
  );

  const handleDelete = useCallback(async () => {
    if (
      !confirm("确认删除自己的声纹? 删除后系统在会议中将无法自动识别你的发言.")
    ) {
      return;
    }
    try {
      await mApi.deleteMyVoiceprint();
      setCurrentVoiceprint(null);
      setToast({ kind: "success", text: "已删除声纹" });
    } catch (e) {
      setToast({
        kind: "error",
        text: e instanceof Error ? `删除失败: ${e.message}` : "删除失败",
      });
    }
  }, []);

  // 卸载时清资源
  useEffect(
    () => () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      captureRef.current?.stop().catch(() => {});
    },
    [],
  );

  const target = Math.min(seconds / TARGET_SECONDS, 1);
  const canStop = phase === "recording" && seconds >= MIN_SUBMIT_SECONDS;

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
          声纹录入
        </h1>
      </div>

      <main className="flex flex-1 flex-col space-y-5 p-4 pb-8">
        {/* 当前状态卡 */}
        {currentVoiceprint ? (
          <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
            <p className="text-[15px] font-medium text-emerald-200">
              ✓ 已录入声纹
            </p>
            <p className="mt-1 text-[13px] leading-snug text-zinc-400">
              版本 v{currentVoiceprint.version} ·{" "}
              {currentVoiceprint.sample_seconds
                ? `${Math.round(currentVoiceprint.sample_seconds)} 秒样本`
                : "样本时长未知"}{" "}
              · {new Date(currentVoiceprint.created_at).toLocaleDateString()}
            </p>
            <p className="mt-1 text-[12px] text-zinc-500">
              会议中系统会自动识别你的发言. 想换 / 重新录入,继续下面流程.
            </p>
          </section>
        ) : (
          <section className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
            <p className="text-[15px] font-medium text-amber-200">
              ⚠ 尚未录入声纹
            </p>
            <p className="mt-1 text-[13px] leading-snug text-zinc-400">
              录入后,会议中系统能自动识别你的发言并打 "说话人" 标签. 录一次约
              30-45 秒.
            </p>
          </section>
        )}

        {/* 朗读文本 */}
        <section
          className={`rounded-2xl border p-4 transition ${
            phase === "recording"
              ? "border-accent-500/60 bg-accent-500/5"
              : "border-ink-800 bg-ink-900"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="rounded bg-ink-800 px-2 py-0.5 text-[12px] text-zinc-400">
              朗读这段 · {script.title}
            </span>
            <button
              type="button"
              onClick={nextScript}
              disabled={phase === "recording" || phase === "uploading"}
              className="text-[12px] text-zinc-500 active:text-accent-400 disabled:opacity-40"
            >
              换一段 ↻
            </button>
          </div>
          <p
            className={`mt-3 text-[16px] leading-loose tracking-wide ${
              phase === "recording" ? "text-white" : "text-zinc-200"
            }`}
          >
            {script.text}
          </p>
          <p className="mt-3 text-[12px] text-zinc-500">
            正常语速朗读约 30-45 秒. 读到结尾不够 30s 就接着重复.
          </p>
        </section>

        {/* 进度条 + 秒数 */}
        <section className="rounded-2xl bg-ink-900 p-4">
          <div className="flex items-center justify-between text-[13px] text-zinc-500">
            <span>
              已录 {seconds.toFixed(1)}s · 目标 {MIN_SUBMIT_SECONDS}-
              {MAX_SECONDS}s
            </span>
            <span>
              {phase === "recording"
                ? "录音中"
                : phase === "uploading"
                  ? "上传中"
                  : phase === "done"
                    ? "已完成"
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

        {/* 主操作按钮 */}
        <section className="flex flex-col items-center pt-4">
          {phase === "idle" || phase === "done" ? (
            <button
              type="button"
              onClick={() => void start()}
              className="flex h-20 w-20 items-center justify-center rounded-full bg-accent-500 text-3xl text-white shadow-lg shadow-accent-500/30 active:scale-95"
              data-testid="voiceprint-start"
            >
              🎙
            </button>
          ) : phase === "recording" ? (
            <button
              type="button"
              onClick={() => void stop(false)}
              className={`flex h-20 w-20 items-center justify-center rounded-full text-3xl text-white shadow-lg transition active:scale-95 ${
                canStop
                  ? "bg-rose-500 shadow-rose-500/30"
                  : "bg-zinc-700 shadow-zinc-700/30"
              }`}
              data-testid="voiceprint-stop"
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
              (canStop
                ? `已录 ${seconds.toFixed(0)}s,点击提交`
                : `继续录到 ${MIN_SUBMIT_SECONDS}s 以上`)}
            {phase === "uploading" && "正在生成声纹 (5-15s)..."}
            {phase === "done" && "完成 — 可重录"}
          </p>
        </section>

        {/* 删除入口(已录过的才显)*/}
        {currentVoiceprint ? (
          <section className="mt-auto">
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={phase === "recording" || phase === "uploading"}
              className="flex h-11 w-full items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/[0.06] text-[14px] text-rose-300 active:scale-[0.98] active:bg-rose-500/[0.12] disabled:opacity-50"
            >
              删除我的声纹
            </button>
            <p className="mt-2 text-center text-[12px] text-zinc-500">
              删除后下次会议无法自动识别你的发言.
            </p>
          </section>
        ) : null}
      </main>

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
