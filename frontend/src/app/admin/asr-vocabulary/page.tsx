"use client";

/**
 * v25.9 — ASR 词表 管理.
 *
 * 操作:
 *   1. 多行 textarea, 一行一词
 *   2. 「从会议导入 hot words」下拉 — 拉某场会议自动收集的词
 *   3. 「保存并同步」 — 后端调 DashScope 创建/更新 vocabulary,缓存 vocab_id
 *   4. 状态显示:总词数 / 同步状态 / 上次同步时间 / 错误重试
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Meeting } from "@/lib/api";
import { toast } from "@/lib/toast";

type Entry = { text: string; weight: number; lang: string };

const STATUS_LABEL: Record<string, string> = {
  never: "未同步",
  ok: "已同步",
  failed: "同步失败",
  preview: "预览中",
};
const STATUS_TONE: Record<string, string> = {
  never: "bg-zinc-700/40 text-zinc-300",
  ok: "bg-emerald-500/15 text-emerald-300",
  failed: "bg-rose-500/15 text-rose-300",
  preview: "bg-amber-500/15 text-amber-300",
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN");
  } catch {
    return iso;
  }
}

export default function AsrVocabularyPage() {
  const [textarea, setTextarea] = useState("");
  const [vocabId, setVocabId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string>("never");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [targetModel, setTargetModel] = useState<string>("paraformer-realtime-v2");
  const [maxEntries, setMaxEntries] = useState<number>(500);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [importing, setImporting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const v = await api.getAsrVocabulary();
      setVocabId(v.dashscope_vocab_id);
      setSyncStatus(v.sync_status);
      setSyncError(v.sync_error);
      setLastSyncedAt(v.last_synced_at);
      setTargetModel(v.target_model);
      setMaxEntries(v.max_entries);
      setTextarea(v.entries.map((e) => e.text).join("\n"));
    } catch (e) {
      toast.error(`加载失败: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    api.listMeetings().then((ms) => setMeetings(ms.slice(0, 30))).catch(() => {});
  }, [refresh]);

  const parsedEntries = useMemo(() => {
    return textarea
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((text) => ({ text, weight: 4, lang: "zh" as const }));
  }, [textarea]);

  const tooMany = parsedEntries.length > maxEntries;

  const save = async () => {
    if (tooMany) {
      toast.error(`超出 ${maxEntries} 词上限`);
      return;
    }
    setSaving(true);
    try {
      const r = await api.saveAsrVocabulary(parsedEntries.map((e) => e.text));
      setVocabId(r.dashscope_vocab_id);
      setSyncStatus(r.sync_status);
      setSyncError(r.sync_error);
      setLastSyncedAt(r.last_synced_at);
      if (r.sync_status === "ok") {
        toast.success(`✅ 同步成功(${r.entries.length} 词)`);
      } else {
        toast.error(`保存了 但同步 DashScope 失败:${r.sync_error || "未知"}`);
      }
    } catch (e) {
      toast.error(`保存失败: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const resync = async () => {
    setSaving(true);
    try {
      const r = await api.resyncAsrVocabulary();
      setVocabId(r.dashscope_vocab_id);
      setSyncStatus(r.sync_status);
      setSyncError(r.sync_error);
      if (r.sync_status === "ok") {
        toast.success("✅ 重新同步成功");
      } else {
        toast.error(`同步失败: ${r.sync_error || "未知"}`);
      }
    } catch (e) {
      toast.error(`重试失败: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const importFromMeeting = async (meetingId: string) => {
    setImporting(meetingId);
    try {
      const r = await api.importAsrVocabFromMeeting(meetingId);
      setTextarea(r.entries.map((e) => e.text).join("\n"));
      toast.info(`已合并 hot words(共 ${r.entries.length} 词,点保存才同步)`);
    } catch (e) {
      toast.error(`导入失败: ${(e as Error).message}`);
    } finally {
      setImporting(null);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold text-white">ASR 词表</h2>
        <p className="mt-1 text-sm text-zinc-400">
          预先录入业务术语 / 人名 / 缩写,ASR 优先识别。改完点「保存并同步」自动调 DashScope vocabulary API。
        </p>
      </header>

      {/* 状态条 */}
      <section className="grid gap-3 rounded-2xl border border-ink-700 bg-ink-900 p-5 sm:grid-cols-4">
        <Stat label="词数" value={parsedEntries.length} hint={tooMany ? `>${maxEntries} 超限` : undefined} />
        <Stat
          label="状态"
          value={STATUS_LABEL[syncStatus] || syncStatus}
          tone={STATUS_TONE[syncStatus]}
        />
        <Stat label="上次同步" value={fmtTime(lastSyncedAt)} />
        <Stat
          label="vocab_id"
          value={vocabId ? vocabId.slice(0, 24) + "…" : "—"}
          mono
        />
      </section>

      {syncError && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
          ⚠️ 上次同步错误:<code className="break-all">{syncError}</code>
          <button
            onClick={resync}
            disabled={saving}
            className="ml-2 rounded bg-rose-600 px-2 py-0.5 text-white hover:bg-rose-500 disabled:opacity-50"
          >
            重试同步
          </button>
        </div>
      )}

      {/* 主编辑器 */}
      <section className="rounded-2xl border border-ink-700 bg-ink-900 p-5">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium text-white">词条列表</h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              一行一词,空行忽略;支持中英文。Model:
              <code className="ml-1 text-zinc-400">{targetModel}</code>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="rounded-lg border border-ink-700 bg-ink-950 px-2 py-1.5 text-xs text-zinc-200"
              onChange={(e) => {
                const id = e.target.value;
                if (id) void importFromMeeting(id);
                e.target.value = "";
              }}
              disabled={!!importing || loading}
              defaultValue=""
            >
              <option value="">+ 从会议导入 hot words</option>
              {meetings.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title.slice(0, 30)}{m.title.length > 30 ? "…" : ""}
                </option>
              ))}
            </select>
            <button
              onClick={save}
              disabled={saving || loading || tooMany}
              className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "同步中…" : "💾 保存并同步"}
            </button>
          </div>
        </div>
        <textarea
          value={textarea}
          onChange={(e) => setTextarea(e.target.value)}
          rows={20}
          spellCheck={false}
          placeholder={`一行一词,例如:
前海合作区
粤港澳大湾区
专精特新
邓西
张明
i 深圳`}
          className={`w-full rounded-lg border bg-ink-950 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none ${
            tooMany ? "border-rose-500/50" : "border-ink-700 focus:border-emerald-500/40"
          }`}
        />
        {tooMany && (
          <p className="mt-1 text-xs text-rose-400">
            超出 {maxEntries} 词上限,保存按钮已禁用。
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-ink-700 bg-ink-900/40 p-5 text-xs text-zinc-400">
        <h3 className="text-sm font-medium text-zinc-200">💡 使用提示</h3>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>
            <b>保存后立即生效</b>:下次创建的会议,ASR 自动用本词表 优先识别业务术语。
          </li>
          <li>
            <b>常见错字</b>:把 ASR 经常听错的词列在这(例如「前嗨合作区」→「前海合作区」),
            DashScope 会优先匹配。
          </li>
          <li>
            <b>从会议导入</b>:右上下拉选某场会议,自动合并参会人姓名 + 邀请的 AI 专家 keywords + KB 标题。
          </li>
          <li>
            <b>同步失败</b>:常见原因 DASHSCOPE_API_KEY 未配 / 网络异常 / 词表格式错误。点「重试同步」即可。
          </li>
          <li>
            <b>不影响其他</b>:词表是 workspace 级,只影响本工作空间的会议。
          </li>
        </ul>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
  mono,
}: {
  label: string;
  value: string | number;
  tone?: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div
        className={`mt-1 inline-flex max-w-full items-center rounded-md px-2 py-0.5 text-sm font-medium ${
          tone || "text-zinc-100"
        } ${mono ? "font-mono text-xs" : ""}`}
      >
        <span className="truncate">{value}</span>
      </div>
      {hint && <div className="mt-0.5 text-[10px] text-rose-400">{hint}</div>}
    </div>
  );
}
