"use client";

/**
 * v26.5-Lineage P2 · 全景血缘桑基图
 *
 * 3 层节点 + 多语义边:
 *   左 来源 (上传 / 会议 / 任务)
 *   中 数据 (KB 文档 / Memory 条目)
 *   右 AI 专家
 *
 * 边语义:
 *   source       — 来源 → 数据 (灰)
 *   primary      — 数据 → 主 AI (绿)
 *   subscriber   — 数据 → 订阅 AI (紫)
 *   reference    — KB → AI 借阅 (蓝虚线)
 *
 * 用 @nivo/sankey 渲染. 节点 click → 弹详情, 节点 hover → 高亮所在 path.
 * Filter: 按 AI / 按数据类型 / 按时间.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ResponsiveSankey } from "@nivo/sankey";
import { api, type Agent, type LineageOut, type LineageNode } from "@/lib/api";

// 颜色映射 — 节点类型
const NODE_COLOR: Record<string, string> = {
  meeting: "#fbbf24",   // amber
  upload: "#94a3b8",    // slate
  kb_doc: "#38bdf8",    // sky
  memory: "#a78bfa",    // violet
  agent: "#34d399",     // emerald
};

const NODE_TYPE_LABEL: Record<string, string> = {
  meeting: "🎙️ 来源",
  upload: "📁 来源",
  kb_doc: "📄 KB",
  memory: "🧠 Memory",
  agent: "🤖 AI",
};

export default function LineagePage() {
  const [data, setData] = useState<LineageOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"all" | string>("all");  // "all" or agent_id
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedNode, setSelectedNode] = useState<LineageNode | null>(null);
  const [highlightAgentId, setHighlightAgentId] = useState<string | null>(null);
  const [showShareOnly, setShowShareOnly] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const d = scope === "all"
        ? await api.getLineage()
        : await api.getAgentLineage(scope);
      setData(d);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    api.listAgents().then(setAgents).catch(() => setAgents([]));
  }, []);

  // 把后端 nodes/edges 转 nivo sankey 格式
  const sankeyData = useMemo(() => {
    if (!data) return { nodes: [], links: [] };
    // 计算 共享数据 (被 2+ agent 引用) — 用 highlight 模式时高亮这些
    const sharedNodes = new Set<string>();
    const dataNodeAgentCount: Record<string, Set<string>> = {};
    for (const e of data.edges) {
      if (e.kind === "primary" || e.kind === "subscriber" || e.kind === "reference") {
        if (!dataNodeAgentCount[e.source]) dataNodeAgentCount[e.source] = new Set();
        dataNodeAgentCount[e.source].add(e.target);
      }
    }
    for (const [nid, ags] of Object.entries(dataNodeAgentCount)) {
      if (ags.size >= 2) sharedNodes.add(nid);
    }

    const includeNodes = new Set<string>();
    // 计算 哪些节点被 highlightAgentId 牵连
    let includedSet: Set<string> | null = null;
    if (highlightAgentId) {
      includedSet = new Set<string>();
      includedSet.add(`agent:${highlightAgentId}`);
      // 向左走两步 — data → agent edges 反着找 data, 再 source → data 找来源
      const dataNodes = new Set<string>();
      for (const e of data.edges) {
        if (e.target === `agent:${highlightAgentId}`) {
          dataNodes.add(e.source);
          includedSet.add(e.source);
        }
      }
      for (const e of data.edges) {
        if (dataNodes.has(e.target) && e.kind === "source") {
          includedSet.add(e.source);
        }
      }
    }
    // 共享模式: 只显示 sharedNodes + 其连边
    if (showShareOnly) {
      includedSet = new Set<string>();
      for (const nid of sharedNodes) {
        includedSet.add(nid);
        for (const e of data.edges) {
          if (e.source === nid) includedSet.add(e.target);
          if (e.target === nid) includedSet.add(e.source);
        }
      }
    }

    const filteredEdges = data.edges.filter((e) => {
      if (includedSet) return includedSet.has(e.source) && includedSet.has(e.target);
      return true;
    });
    const usedIds = new Set<string>();
    for (const e of filteredEdges) {
      usedIds.add(e.source);
      usedIds.add(e.target);
    }
    const filteredNodes = data.nodes.filter((n) => usedIds.has(n.id));
    void includeNodes;

    return {
      nodes: filteredNodes.map((n) => ({
        id: n.id,
        nodeColor: NODE_COLOR[n.type] ?? "#888",
        label: n.label,
        type: n.type,
        _meta: n.meta ?? null,
        _isShared: sharedNodes.has(n.id),
      })),
      links: filteredEdges.map((e) => ({
        source: e.source,
        target: e.target,
        value: e.weight ?? 1,
        _kind: e.kind,
      })),
    };
  }, [data, highlightAgentId, showShareOnly]);

  const stats = data?.stats;

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-medium text-white">🌐 数据血缘图</h2>
        <p className="mt-1 text-sm text-zinc-500">
          看 来源 (会议 / 上传) → 数据 (KB / Memory) → AI 专家 的完整链路.
          点节点查看详情, 选 AI 查看单 AI 视角.
        </p>
      </header>

      {/* Stats */}
      {stats && (
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <StatBox color={NODE_COLOR.agent} label="AI 专家" value={stats.agents} />
          <StatBox color={NODE_COLOR.kb_doc} label="KB 文档" value={stats.kb_docs} />
          <StatBox color={NODE_COLOR.memory} label="Memory" value={stats.memories} />
          <StatBox color={NODE_COLOR.meeting} label="来源会议/任务" value={stats.meetings} />
          <StatBox color={NODE_COLOR.upload} label="上传人" value={stats.uploads} />
        </section>
      )}

      {/* 控制条 */}
      <section className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-700 bg-ink-900 p-3">
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          视角:
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="rounded-lg border border-ink-700 bg-ink-950 px-2 py-1 text-sm text-white focus:border-accent-500 focus:outline-none"
          >
            <option value="all">全景 (整个 workspace)</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>单 AI · {a.name}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          高亮 AI:
          <select
            value={highlightAgentId ?? ""}
            onChange={(e) => setHighlightAgentId(e.target.value || null)}
            className="rounded-lg border border-ink-700 bg-ink-950 px-2 py-1 text-sm text-white focus:border-accent-500 focus:outline-none"
          >
            <option value="">— 不高亮 —</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={showShareOnly}
            onChange={(e) => setShowShareOnly(e.target.checked)}
            className="accent-amber-500"
          />
          只看共享数据 (≥2 AI 引用)
        </label>
        <button
          type="button"
          onClick={() => refresh()}
          className="ml-auto rounded-lg border border-ink-700 px-3 py-1 text-xs text-zinc-300 hover:bg-ink-800"
        >
          🔄 刷新
        </button>
      </section>

      {/* 桑基图 */}
      <section className="rounded-xl border border-ink-700 bg-ink-900 p-2">
        {loading ? (
          <p className="p-8 text-center text-sm text-zinc-500">加载血缘…</p>
        ) : sankeyData.nodes.length === 0 ? (
          <p className="p-8 text-center text-sm text-zinc-500">
            该 workspace 还没有数据. 创建 AI / 上传 KB / 跑几场会, 这里就会出现血缘图.
          </p>
        ) : (
          <div style={{ height: 600 }}>
            <ResponsiveSankey
              data={sankeyData}
              margin={{ top: 20, right: 200, bottom: 20, left: 50 }}
              align="justify"
              colors={(n) => (n as { nodeColor: string }).nodeColor ?? "#888"}
              nodeOpacity={1}
              nodeHoverOthersOpacity={0.35}
              nodeThickness={14}
              nodeSpacing={18}
              nodeBorderWidth={0}
              nodeBorderRadius={3}
              linkOpacity={0.4}
              linkHoverOthersOpacity={0.1}
              linkContract={3}
              enableLinkGradient
              labelPosition="outside"
              labelOrientation="horizontal"
              labelPadding={8}
              labelTextColor="#cbd5e1"
              theme={{
                background: "transparent",
                text: { fill: "#cbd5e1", fontSize: 11 },
                tooltip: {
                  container: {
                    background: "#0f172a",
                    color: "#e5e7eb",
                    fontSize: 12,
                    borderRadius: 6,
                    padding: "6px 10px",
                    border: "1px solid #334155",
                  },
                },
              }}
              onClick={(node) => {
                // node 可能是 SankeyNode | SankeyLink
                if ("id" in node && data) {
                  const found = data.nodes.find((n) => n.id === (node as { id: string }).id);
                  if (found) setSelectedNode(found);
                }
              }}
            />
          </div>
        )}
      </section>

      {/* 图例 */}
      <section className="flex flex-wrap gap-3 text-xs text-zinc-500">
        {Object.entries(NODE_TYPE_LABEL).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded"
              style={{ background: NODE_COLOR[k] }}
              aria-hidden
            />
            {v}
          </span>
        ))}
      </section>

      {/* 详情面板 */}
      {selectedNode && (
        <NodeDetailPanel
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  );
}

function StatBox({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900 p-3">
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: color }}
          aria-hidden
        />
        <span className="text-xs text-zinc-500">{label}</span>
      </div>
      <div className="mt-1 text-lg font-medium text-white">{value}</div>
    </div>
  );
}

function NodeDetailPanel({
  node,
  onClose,
}: {
  node: LineageNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-ink-700 bg-ink-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ background: NODE_COLOR[node.type] ?? "#888" }}
              aria-hidden
            />
            <span className="ml-2 text-xs uppercase tracking-wider text-zinc-500">
              {NODE_TYPE_LABEL[node.type] ?? node.type}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            ✕
          </button>
        </div>
        <h4 className="mt-2 text-base font-medium text-white">{node.label}</h4>
        {node.meta && (
          <dl className="mt-4 space-y-2 text-xs">
            {Object.entries(node.meta).map(([k, v]) => (
              <div key={k} className="rounded border border-ink-700 bg-ink-950/60 p-2">
                <dt className="text-zinc-500">{k}</dt>
                <dd className="mt-0.5 text-zinc-200">
                  {v === null || v === undefined ? "—" : String(v)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
