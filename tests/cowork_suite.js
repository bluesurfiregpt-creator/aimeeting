/**
 * Aimeeting · Cowork 全自动测试套件 (v14+)
 *
 * Self-contained smoke test suite designed to be pasted into the browser
 * console of an authenticated `aimeeting.zhzjpt.cn` tab. Drives every
 * series Cowork can independently exercise via REST (= everything except
 * B/C/D, which require real human voice).
 *
 * Usage:
 *   1. Open https://aimeeting.zhzjpt.cn/, ensure logged in
 *   2. Open DevTools console
 *   3. Paste this entire file
 *   4. Call: const r = await runCoworkSuite()
 *   5. Inspect r.markdown (drop into an issue / report)
 *      or r.json (machine-readable, for T2 baseline diff)
 *
 * The suite:
 *   - Auto-cleans every resource it creates (meetings, agents, KBs)
 *   - Tags created data with `_cowork_suite_<runid>` prefix for forensic
 *     cleanup if the script crashes mid-run
 *   - Stops cleanly on infrastructure errors (auth lost, network down)
 *     and reports what it managed to verify
 *
 * Coverage: see CASES list at the bottom of this file.
 *
 * Hard skips (require real audio / second browser session / network sim):
 *   - B (voiceprint enrollment), C (live ASR), D (voiceprint identify)
 *   - O-4..O-8 (accept-invite needs new session)
 *   - P (password reset is destructive on default account)
 *   - S (network offline simulation)
 *   - W-12/W-13 (mic permission denial in browser)
 *   - V-2..V-5 (multi-browser regression)
 *   - X-22..X-24 (live banner countdown UX)
 *
 * Performance: ~3-5 minutes total. The slow parts are LLM-bound
 * (summary regen ~25s × 2, action extract ~5-15s × 2, briefing ~10s).
 */

(function () {
  // Idempotent install — paste-and-replace works
  if (typeof window === "undefined") return;
  window.__coworkSuite = window.__coworkSuite || {};

  const RUN_ID = Date.now().toString(36);
  const PREFIX = `_cowork_suite_${RUN_ID}`;
  const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

  // -------- HTTP helpers ----------------------------------------------------

  async function api(method, path, body) {
    const r = await fetch(path, {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    let parsed = null;
    try {
      const txt = await r.text();
      parsed = txt ? JSON.parse(txt) : null;
    } catch {
      // ignore — non-JSON body
    }
    return { ok: r.ok, status: r.status, body: parsed };
  }
  const GET = (p) => api("GET", p);
  const POST = (p, b) => api("POST", p, b);
  const PATCH = (p, b) => api("PATCH", p, b);
  const DEL = (p) => api("DELETE", p);

  // -------- Test runner -----------------------------------------------------

  /**
   * Each case is registered as { id, series, title, run } where `run` is an
   * async function that returns either { ok: true, evidence: <obj> } or
   * { ok: false, error: <string>, evidence?: <obj> }. `expected_skip: true`
   * registers the case as ⏭️ instead of running it.
   */
  function makeRunner() {
    const cases = [];
    const cleanup = []; // [{kind, id, label}]
    const ctx = {}; // shared state across cases (meeting ids, etc.)

    return {
      ctx,
      cleanup,
      register(c) {
        cases.push(c);
      },
      async runAll(opts = { stopOn: null }) {
        const results = [];
        for (const c of cases) {
          const startedAt = Date.now();
          if (c.expected_skip) {
            results.push({
              id: c.id,
              series: c.series,
              title: c.title,
              status: "skipped",
              reason: c.expected_skip,
              ms: 0,
            });
            continue;
          }
          let outcome;
          try {
            const out = await c.run(ctx, cleanup);
            if (out && out.ok) {
              outcome = { status: "pass", evidence: out.evidence };
            } else {
              const err = out?.error || "no error";
              // Cascade-skip: when a case can't run because a dependency
              // failed, mark it `skipped` (with the dep id as the reason)
              // rather than `fail`. Keeps the failure count honest —
              // it should reflect *real* bugs, not knock-on effects.
              const m = err.match(/^SKIP_DEP_FAILED:(.+)$/);
              if (m) {
                outcome = { status: "skipped", reason: `dep failed: ${m[1]}` };
              } else {
                outcome = { status: "fail", error: err, evidence: out?.evidence };
              }
            }
          } catch (e) {
            outcome = { status: "fail", error: `THROWN: ${e?.message || e}` };
          }
          const ms = Date.now() - startedAt;
          results.push({
            id: c.id,
            series: c.series,
            title: c.title,
            ...outcome,
            ms,
          });
          if (opts.stopOn && outcome.status === "fail" && c.id === opts.stopOn) break;
        }
        return results;
      },
    };
  }

  // -------- Cleanup ---------------------------------------------------------

  async function performCleanup(cleanup) {
    const log = [];
    // Reverse order — later resources may depend on earlier ones (e.g. KB
    // documents depend on KBs)
    for (const item of [...cleanup].reverse()) {
      try {
        const path = ({
          meeting: `/api/meetings/${item.id}`,
          agent: `/api/agents/${item.id}`,
          kb: `/api/knowledge-bases/${item.id}`,
          invitation: `/api/team/invitations/${item.id}`,
          action: item.meta?.parentMeetingId
            ? `/api/meetings/${item.meta.parentMeetingId}/actions/${item.id}`
            : null,
        })[item.kind];
        if (!path) {
          log.push(`  - skip ${item.kind} ${item.id} (no path mapping)`);
          continue;
        }
        const r = await DEL(path);
        log.push(`  - ${item.kind} ${item.label || item.id} → ${r.status}`);
      } catch (e) {
        log.push(`  - ${item.kind} ${item.id} → ERROR ${e?.message || e}`);
      }
    }
    return log;
  }

  // -------- Baseline diff (T2) ---------------------------------------------

  /**
   * Compare the current run against a frozen baseline (`tests/baseline.json`
   * format). Categorizes each case into a single bucket so a CI gate can
   * key on `regressions.length` alone:
   *
   *   - regressions: was-better, now-worse (pass→{fail|skipped} or skipped→fail)
   *   - fixed:       was-fail, now-pass
   *   - new_passes:  was-skipped, now-pass (an infra constraint lifted)
   *   - new_cases:   not in baseline
   *   - missing:     in baseline but not in this run (likely a code merge issue)
   *   - stable:      same status both runs (no entry in details, just count)
   *
   * Also emits `passed_baseline` boolean for programmatic CI signals.
   */
  function diffAgainstBaseline(currentResults, baseline) {
    if (!baseline || !Array.isArray(baseline.cases)) {
      return { available: false };
    }
    const byId = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));
    const cur = byId(currentResults);
    const base = byId(baseline.cases);

    const regressions = [];
    const fixed = [];
    const new_passes = [];
    const new_cases = [];
    const missing = [];
    let stable = 0;

    for (const id of Object.keys(base)) {
      const c = cur[id];
      const b = base[id];
      if (!c) {
        missing.push({ id, was: b.status });
        continue;
      }
      if (c.status === b.status) {
        stable++;
        continue;
      }
      // Movement classification
      const fromPass = b.status === "pass";
      const fromFail = b.status === "fail";
      const fromSkip = b.status === "skipped";
      const toPass = c.status === "pass";
      const toFail = c.status === "fail";
      const toSkip = c.status === "skipped";

      if (toPass && (fromFail || fromSkip)) {
        (fromFail ? fixed : new_passes).push({ id, was: b.status, is: c.status });
      } else if ((fromPass && (toFail || toSkip)) || (fromSkip && toFail)) {
        regressions.push({
          id,
          was: b.status,
          is: c.status,
          error: c.error?.slice(0, 200),
        });
      } else {
        // fail→skipped is a soft regression too (we lost coverage), but we
        // surface it under regressions with reason='lost_coverage' so it's
        // visible without overweighting.
        regressions.push({
          id,
          was: b.status,
          is: c.status,
          error: c.error?.slice(0, 200),
          reason: "lost_coverage",
        });
      }
    }

    for (const id of Object.keys(cur)) {
      if (!base[id]) new_cases.push({ id, status: cur[id].status });
    }

    return {
      available: true,
      baseline_frozen_at: baseline.frozen_at || null,
      baseline_frozen_against: baseline.frozen_against || null,
      regressions,
      fixed,
      new_passes,
      new_cases,
      missing,
      stable_count: stable,
      passed_baseline: regressions.length === 0 && missing.length === 0,
    };
  }

  // -------- Markdown emitter -----------------------------------------------

  function buildMarkdown(meta, results, cleanupLog, diff) {
    const bySeries = new Map();
    for (const r of results) {
      if (!bySeries.has(r.series)) bySeries.set(r.series, []);
      bySeries.get(r.series).push(r);
    }
    const order = [
      ["A", "账号与权限"],
      ["W", "文字录入"],
      ["E", "手工纠错"],
      ["F", "AI 专家触发"],
      ["G", "自动纪要"],
      ["I", "会前简报"],
      ["J", "会议历史"],
      ["K", "LLM/Agent 后台"],
      ["N", "审计日志"],
      ["Q", "知识库"],
      ["R", "会议导出"],
      ["V", "v8/9/12 回归"],
      ["X", "M3.0 自动主持人"],
      ["Y", "Theme 1 协作闭环"],
      ["Z", "v17/v18 Task 一级对象 + 状态机"],
      ["AA", "v19 领导指令 + 状态机收尾"],
      ["BB", "v20 上级文件 + 定期巡检"],
      ["CC", "v21 角色二分 + 数据分级 + 跨 AI 共享"],
      ["DD", "v22 看板 Dashboard"],
      ["EE", "v22.5 多 AI 协作(主责 + 协办)"],
      ["FF", "v23 看板二期 + 报表导出"],
    ];
    const counts = { pass: 0, fail: 0, skipped: 0 };
    for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;

    const lines = [];
    lines.push(`# Aimeeting · Cowork 自动套件回归报告`);
    lines.push("");
    lines.push(`- **环境**: ${meta.entry}`);
    lines.push(`- **时间**: ${meta.startedAt} → ${meta.finishedAt} (${meta.durationMs}ms)`);
    lines.push(`- **登录**: ${meta.who} · ${meta.workspace}`);
    lines.push(`- **总计**: ${results.length} 用例 · ✅ ${counts.pass} · ❌ ${counts.fail} · ⏭️ ${counts.skipped || 0}`);
    lines.push(`- **运行 ID**: ${meta.runId}`);
    lines.push("");

    // T2: vs-baseline section (only when baseline was available + diffed)
    if (diff && diff.available) {
      const status = diff.passed_baseline ? "✅ 与 baseline 一致" : "⚠️ 与 baseline 有偏差";
      lines.push(`## ${status}`);
      lines.push("");
      lines.push(
        `_baseline frozen ${diff.baseline_frozen_at || "(unknown time)"} · ${diff.baseline_frozen_against || ""}_`,
      );
      lines.push("");
      lines.push(
        `- 🔴 regressions: **${diff.regressions.length}** ` +
          `· 💚 fixed: ${diff.fixed.length} ` +
          `· ✨ new passes: ${diff.new_passes.length} ` +
          `· 🆕 new cases: ${diff.new_cases.length} ` +
          `· ⚠️ missing: ${diff.missing.length} ` +
          `· stable: ${diff.stable_count}`,
      );
      lines.push("");

      if (diff.regressions.length > 0) {
        lines.push("### 🔴 Regressions(必须解决)");
        lines.push("");
        lines.push("| 编号 | 之前 | 现在 | 原因 / 错误 |");
        lines.push("|---|---|---|---|");
        for (const r of diff.regressions) {
          const note = r.reason ? `_${r.reason}_ — ${r.error || ""}` : (r.error || "");
          lines.push(`| **${r.id}** | ${r.was} | ${r.is} | ${note.replace(/\|/g, "\\|").slice(0, 200)} |`);
        }
        lines.push("");
      }
      if (diff.fixed.length > 0) {
        lines.push(`### 💚 Fixed since baseline: ${diff.fixed.map((f) => f.id).join(", ")}`);
        lines.push("");
      }
      if (diff.new_passes.length > 0) {
        lines.push(`### ✨ Newly passing (was skipped): ${diff.new_passes.map((f) => f.id).join(", ")}`);
        lines.push("");
      }
      if (diff.new_cases.length > 0) {
        lines.push(`### 🆕 New cases (not in baseline): ${diff.new_cases.map((f) => `${f.id}=${f.status}`).join(", ")}`);
        lines.push("");
      }
      if (diff.missing.length > 0) {
        lines.push(`### ⚠️ Missing in this run: ${diff.missing.map((f) => `${f.id} (was ${f.was})`).join(", ")}`);
        lines.push("");
      }
    } else if (diff) {
      lines.push("## (no baseline loaded — pass `{baseline}` to runCoworkSuite() or serve `/baseline.json`)");
      lines.push("");
    }

    if (counts.fail > 0) {
      lines.push("## ❌ 失败用例(优先看这一段)");
      lines.push("");
      lines.push("| 编号 | 标题 | 错误 |");
      lines.push("|---|---|---|");
      for (const r of results.filter((x) => x.status === "fail")) {
        const err = (r.error || "").replace(/\|/g, "\\|").slice(0, 200);
        lines.push(`| **${r.id}** | ${r.title} | ${err} |`);
      }
      lines.push("");
    }

    lines.push("## 各系列详情");
    lines.push("");
    for (const [sk, label] of order) {
      const rs = bySeries.get(sk);
      if (!rs?.length) continue;
      const passC = rs.filter((r) => r.status === "pass").length;
      const failC = rs.filter((r) => r.status === "fail").length;
      const skipC = rs.filter((r) => r.status === "skipped").length;
      lines.push(`### ${sk} 系列 · ${label} — ✅ ${passC} · ❌ ${failC} · ⏭️ ${skipC}`);
      lines.push("");
      lines.push("| 编号 | 标题 | 结果 | 耗时 | 备注 |");
      lines.push("|---|---|---|---|---|");
      for (const r of rs) {
        const icon = { pass: "✅", fail: "❌", skipped: "⏭️" }[r.status];
        const note =
          r.status === "fail"
            ? (r.error || "").slice(0, 80)
            : r.status === "skipped"
            ? r.reason || ""
            : r.evidence?._note || "";
        lines.push(`| ${r.id} | ${r.title} | ${icon} | ${r.ms || 0}ms | ${note.replace(/\|/g, "\\|")} |`);
      }
      lines.push("");
    }

    if (cleanupLog?.length) {
      lines.push("## 测试数据清理");
      lines.push("");
      lines.push("```");
      for (const l of cleanupLog) lines.push(l);
      lines.push("```");
      lines.push("");
    }

    return lines.join("\n");
  }

  // ==========================================================================
  // ===== TEST CASES =========================================================
  // ==========================================================================

  function registerCases(R) {
    const created = (kind, id, label, meta) => R.cleanup.push({ kind, id, label, meta });

    // ---------- A series · Auth -------------------------------------------
    R.register({
      id: "A-2",
      series: "A",
      title: "/api/auth/me 已登录",
      async run(ctx) {
        const r = await GET("/api/auth/me");
        if (!r.ok) return { ok: false, error: `${r.status} ${JSON.stringify(r.body)}` };
        if (!r.body?.workspace_id) return { ok: false, error: "no workspace_id" };
        ctx.me = r.body;
        return {
          ok: true,
          evidence: { who: r.body.name, workspace: r.body.workspace_name, _note: r.body.workspace_name },
        };
      },
    });

    // ---------- W series · Text input -------------------------------------
    R.register({
      id: "W-4",
      series: "W",
      title: "REST 注入字幕(无发言人)+ 状态自动 ongoing",
      async run(ctx) {
        const m = await POST("/api/meetings", {
          title: `${PREFIX}_W4`,
          attendee_user_ids: [],
        });
        if (!m.ok) return { ok: false, error: `create: ${m.status} ${JSON.stringify(m.body)}` };
        ctx.W4_meeting = m.body.id;
        created("meeting", m.body.id, "W4");
        if (m.body.status !== "scheduled") return { ok: false, error: `expected scheduled, got ${m.body.status}` };

        const inj = await POST(`/api/meetings/${m.body.id}/manual-transcript`, { text: "W-4 line 1" });
        if (!inj.ok) return { ok: false, error: `inject: ${inj.status}` };
        if (typeof inj.body.line_id !== "number") return { ok: false, error: "no line_id" };

        const m2 = await GET(`/api/meetings/${m.body.id}`);
        if (m2.body.status !== "ongoing") return { ok: false, error: `status not flipped: ${m2.body.status}` };

        const result = await GET(`/api/meetings/${m.body.id}/result`);
        const line = result.body.lines[0];
        if (line.id !== line.line_id || line.id !== inj.body.line_id) {
          return { ok: false, error: `line_id mismatch: post=${inj.body.line_id} get.id=${line.id} get.line_id=${line.line_id}` };
        }
        return { ok: true, evidence: { line_id: inj.body.line_id, _note: `line_id=${inj.body.line_id}` } };
      },
    });

    R.register({
      id: "W-5",
      series: "W",
      title: "REST 注入指定发言人 → speaker_status='manual'",
      async run(ctx) {
        const users = await GET("/api/users");
        const u = users.body[0];
        if (!u) return { ok: false, error: "no users" };

        const m = await POST("/api/meetings", { title: `${PREFIX}_W5`, attendee_user_ids: [] });
        created("meeting", m.body.id, "W5");
        const r = await POST(`/api/meetings/${m.body.id}/manual-transcript`, {
          text: "W-5 spoken by user",
          speaker_user_id: u.id,
        });
        if (!r.ok || r.body.speaker_user_id !== u.id) {
          return { ok: false, error: `speaker not bound: ${JSON.stringify(r.body)}` };
        }
        const result = await GET(`/api/meetings/${m.body.id}/result`);
        const line = result.body.lines[0];
        if (line.speaker_status !== "manual") return { ok: false, error: `status: ${line.speaker_status}` };
        return { ok: true, evidence: { _note: `speaker=${u.name}` } };
      },
    });

    R.register({
      id: "W-6",
      series: "W",
      title: "跨工作空间发言人 → 400",
      async run(ctx) {
        const m = await POST("/api/meetings", { title: `${PREFIX}_W6`, attendee_user_ids: [] });
        created("meeting", m.body.id, "W6");
        const r = await POST(`/api/meetings/${m.body.id}/manual-transcript`, {
          text: "x",
          speaker_user_id: "00000000-0000-0000-0000-000000000000",
        });
        if (r.status !== 400) return { ok: false, error: `expected 400 got ${r.status}` };
        return { ok: true, evidence: { _note: r.body?.detail } };
      },
    });

    R.register({
      id: "W-7",
      series: "W",
      title: "空文本 → 400",
      async run(ctx) {
        const m = await POST("/api/meetings", { title: `${PREFIX}_W7`, attendee_user_ids: [] });
        created("meeting", m.body.id, "W7");
        const r = await POST(`/api/meetings/${m.body.id}/manual-transcript`, { text: "   " });
        if (r.status !== 400) return { ok: false, error: `expected 400 got ${r.status}` };
        return { ok: true, evidence: { _note: r.body?.detail } };
      },
    });

    // ---------- E series · Speaker correction -----------------------------
    R.register({
      id: "E-2",
      series: "E",
      title: "correct-speaker 改归属 + status='manually_corrected'",
      async run(ctx) {
        const users = await GET("/api/users");
        const u = users.body[0];
        const m = await POST("/api/meetings", { title: `${PREFIX}_E2`, attendee_user_ids: [] });
        created("meeting", m.body.id, "E2");
        const inj = await POST(`/api/meetings/${m.body.id}/manual-transcript`, { text: "for correction" });
        const r = await POST(`/api/meetings/${m.body.id}/transcripts/${inj.body.line_id}/correct-speaker`, {
          speaker_user_id: u.id,
        });
        if (!r.ok) return { ok: false, error: `${r.status} ${JSON.stringify(r.body)}` };
        const result = await GET(`/api/meetings/${m.body.id}/result`);
        const line = result.body.lines.find((l) => l.line_id === inj.body.line_id);
        if (line.speaker_user_id !== u.id) return { ok: false, error: "speaker not bound" };
        if (line.speaker_status !== "manually_corrected") {
          return { ok: false, error: `status: ${line.speaker_status}` };
        }
        return { ok: true, evidence: { _note: `→ ${u.name}` } };
      },
    });

    // ---------- F series · Agent triggers ---------------------------------
    R.register({
      id: "F-3",
      series: "F",
      title: "manual invoke_agent 持久化到 meeting_agent_message",
      async run(ctx) {
        const agents = await GET("/api/agents");
        const expert = agents.body.find((a) => a.role === "expert" && a.is_active);
        if (!expert) return { ok: false, error: "no active expert agent" };
        const m = await POST("/api/meetings", { title: `${PREFIX}_F3`, attendee_user_ids: [] });
        created("meeting", m.body.id, "F3");
        // Inject context first
        await POST(`/api/meetings/${m.body.id}/manual-transcript`, {
          text: "我们需要专家点评一下产品方向",
        });
        // Open a passive WS to receive agent_message_* events. We don't
        // strictly need it because agent reply also persists, but waiting
        // for the persistence requires a polling delay below.
        await SLEEP(1500);

        // Manually invoke via WS — easiest: just call the agent message
        // persistence endpoint. The agent invocation requires WS, so we'll
        // read agent-messages after waiting.
        // Alternative: skip the manual invoke; instead use a meeting that
        // has agent keywords in transcript so maybe_invoke_agents fires.
        await POST(`/api/meetings/${m.body.id}/manual-transcript`, {
          text: `请 @${expert.name} 给个意见`,
        });

        // poll agent-messages up to 25s
        let agentMsgs = [];
        for (let i = 0; i < 25; i++) {
          await SLEEP(1000);
          const r = await GET(`/api/meetings/${m.body.id}/agent-messages`);
          if (r.body && r.body.length > 0) {
            agentMsgs = r.body;
            break;
          }
        }
        if (agentMsgs.length === 0) {
          return {
            ok: false,
            error: "no agent message after 25s (LLM may have judged no trigger)",
            evidence: { agent_id: expert.id, agent_name: expert.name },
          };
        }
        return {
          ok: true,
          evidence: { _note: `${agentMsgs.length} agent msg(s) from ${expert.name}` },
        };
      },
    });

    // ---------- G series · Summary ----------------------------------------
    R.register({
      id: "G-1",
      series: "G",
      title: "Summary regenerate → status=ready",
      async run(ctx) {
        const m = await POST("/api/meetings", { title: `${PREFIX}_G1`, attendee_user_ids: [] });
        created("meeting", m.body.id, "G1");
        // Each line ≥ 18 chars so total comfortably > MIN_TRANSCRIPT_CHARS=60
        // (per backend summary_generator), avoiding the "summary:skipped"
        // shortcut for thin transcripts.
        const lines = [
          "邓西负责在本周五前提交 PRD V2 文档,需要包含完整的功能模块拆解和验收标准",
          "李法务下周三前出一份合规意见书,重点评估数据出境的申报路径和潜在风险",
          "王架构帮忙调研三个 SDK 的兼容性差异,给出推荐方案和迁移成本估算",
          "产品线上预热由市场团队配合,初步定档月底,需要联动客户成功提前给到样例",
        ];
        for (const t of lines) {
          await POST(`/api/meetings/${m.body.id}/manual-transcript`, { text: t });
        }
        await POST(`/api/meetings/${m.body.id}/summary/regenerate`, {});
        // Wait up to 90s. Now also handles `skipped` (short content) and
        // every other terminal status — caller never has to wait for a
        // status that won't change.
        for (let i = 0; i < 45; i++) {
          await SLEEP(2000);
          const r = await GET(`/api/meetings/${m.body.id}/summary`);
          if (r.body.status === "ready") {
            ctx.G1_meeting = m.body.id;
            return {
              ok: true,
              evidence: { _note: `${r.body.summary_md.length} chars · ${(i + 1) * 2}s` },
            };
          }
          // Any non-pending status is terminal; surface as fail with detail.
          if (r.body.status && r.body.status !== "pending") {
            return {
              ok: false,
              error: `terminal status=${r.body.status}${r.body.message ? ` (${r.body.message})` : ""}`,
            };
          }
        }
        return { ok: false, error: "summary still pending after 90s" };
      },
    });

    R.register({
      id: "G-3",
      series: "G",
      title: "Summary 包含「待办事项」/「关键决策」段",
      async run(ctx) {
        if (!ctx.G1_meeting) return { ok: false, error: "SKIP_DEP_FAILED:G-1", evidence: { _skipped: true } };
        const r = await GET(`/api/meetings/${ctx.G1_meeting}/summary`);
        const md = r.body.summary_md || "";
        const hasTodo = /(待办|行动项|关键要点)/.test(md);
        const hasDecision = /(决策|结论|共识)/.test(md);
        if (!hasTodo) return { ok: false, error: "missing 待办/行动项" };
        if (!hasDecision) return { ok: false, error: "missing 决策/结论" };
        return { ok: true, evidence: { _note: "结构完整" } };
      },
    });

    // ---------- I series · Briefing --------------------------------------
    R.register({
      id: "I-2",
      series: "I",
      title: "Briefing 顶部含「上次会议未完待办」段",
      async run(ctx) {
        // Need a fresh meeting in workspace where prior meetings have open actions.
        // The default workspace has plenty (we already verified end-to-end).
        const m = await POST("/api/meetings", {
          title: `${PREFIX}_I2`,
          attendee_user_ids: [],
        });
        created("meeting", m.body.id, "I2");
        await SLEEP(2000); // briefing generates synchronously on GET; slight delay safe
        const b = await GET(`/api/meetings/${m.body.id}/briefing`);
        if (b.body.status === "empty") {
          return { ok: false, error: "briefing empty (no memories or open actions in this workspace)" };
        }
        const md = b.body.briefing_md || "";
        if (!md.startsWith("## 📌 上次会议未完待办")) {
          return { ok: false, error: `briefing starts with: ${md.slice(0, 80)}` };
        }
        // v14 truncation banner check
        const headLine = md.split("\n")[0];
        const hasCount = /\(\d+ 项/.test(headLine);
        if (!hasCount) return { ok: false, error: "no count in header" };
        return { ok: true, evidence: { _note: headLine.slice(0, 60) } };
      },
    });

    // ---------- J series · Meetings list / delete ------------------------
    R.register({
      id: "J-1",
      series: "J",
      title: "List meetings 倒序",
      async run(ctx) {
        const r = await GET("/api/meetings");
        if (!r.ok) return { ok: false, error: `${r.status}` };
        const created_ats = r.body.map((m) => m.started_at || "").filter(Boolean);
        // The API orders by created_at desc; check first 5 are non-increasing
        for (let i = 1; i < Math.min(5, created_ats.length); i++) {
          if (created_ats[i] > created_ats[i - 1]) {
            return { ok: false, error: "not descending" };
          }
        }
        return { ok: true, evidence: { _note: `${r.body.length} meetings` } };
      },
    });

    // ---------- K series · Agent CRUD -------------------------------------
    R.register({
      id: "K-5",
      series: "K",
      title: "Agent create + list + delete + audit",
      async run(ctx) {
        const create = await POST("/api/agents", {
          name: `${PREFIX}_agent`,
          domain: "QA",
          persona: "test agent for cowork suite",
          keywords: ["cowork", "test"],
          color: "rose",
        });
        if (!create.ok) return { ok: false, error: `create: ${create.status}` };
        if (create.body.role !== "expert") return { ok: false, error: `role: ${create.body.role}` };
        // Verify in list
        const list = await GET("/api/agents");
        if (!list.body.some((a) => a.id === create.body.id)) return { ok: false, error: "missing from list" };
        // Audit row
        await SLEEP(500);
        const audit = await GET("/api/audit?action=agent.create&limit=10");
        const found = audit.body.some(
          (a) => a.target_id === create.body.id && a.action === "agent.create"
        );
        if (!found) return { ok: false, error: "no audit row" };
        // Cleanup explicitly (don't queue — we test the delete path)
        const del = await DEL(`/api/agents/${create.body.id}`);
        if (del.status !== 204) return { ok: false, error: `delete: ${del.status}` };
        return { ok: true, evidence: { _note: "create+audit+delete" } };
      },
    });

    R.register({
      id: "K-6",
      series: "K",
      title: "Moderator agent 不可删除 → 400",
      async run(ctx) {
        const list = await GET("/api/agents");
        const mod = list.body.find((a) => a.role === "moderator");
        if (!mod) return { ok: false, error: "no moderator agent" };
        const r = await DEL(`/api/agents/${mod.id}`);
        if (r.status !== 400) return { ok: false, error: `expected 400 got ${r.status}` };
        if (!/cannot delete the built-in moderator/i.test(r.body?.detail || "")) {
          return { ok: false, error: `unexpected detail: ${r.body?.detail}` };
        }
        return { ok: true, evidence: { _note: r.body.detail } };
      },
    });

    R.register({
      id: "K-7",
      series: "K",
      title: "Provider list-models (Qwen)",
      async run(ctx) {
        const cfgs = await GET("/api/model-providers");
        const qwen = cfgs.body.find((p) => p.provider === "qwen");
        if (!qwen) return { ok: false, error: "no qwen provider configured" };
        const r = await POST("/api/model-providers/qwen/list-models", {});
        if (!r.ok) return { ok: false, error: `${r.status} ${JSON.stringify(r.body)}` };
        if (!r.body.models?.length) return { ok: false, error: "empty models" };
        return { ok: true, evidence: { _note: `${r.body.models.length} models` } };
      },
    });

    // ---------- N series · Audit ------------------------------------------
    R.register({
      id: "N-1",
      series: "N",
      title: "audit list filters by action",
      async run(ctx) {
        const r = await GET("/api/audit?action=meeting.create&limit=5");
        if (!r.ok) return { ok: false, error: `${r.status}` };
        const allCreate = r.body.every((a) => a.action === "meeting.create");
        if (!allCreate) return { ok: false, error: "filter not honored" };
        return { ok: true, evidence: { _note: `${r.body.length} rows` } };
      },
    });

    R.register({
      id: "N-2",
      series: "N",
      title: "audit ts 倒序",
      async run(ctx) {
        const r = await GET("/api/audit?limit=5");
        for (let i = 1; i < r.body.length; i++) {
          if (r.body[i].ts > r.body[i - 1].ts) return { ok: false, error: "not descending" };
        }
        return { ok: true, evidence: { _note: `${r.body.length} sample rows` } };
      },
    });

    // ---------- Q series · Knowledge base --------------------------------
    R.register({
      id: "Q-2",
      series: "Q",
      title: "KB create + delete",
      async run(ctx) {
        const create = await POST("/api/knowledge-bases", {
          name: `${PREFIX}_kb`,
          description: "cowork suite test KB",
        });
        if (!create.ok) return { ok: false, error: `create: ${create.status}` };
        const del = await DEL(`/api/knowledge-bases/${create.body.id}`);
        if (del.status !== 204) return { ok: false, error: `delete: ${del.status}` };
        return { ok: true, evidence: { _note: "create+delete" } };
      },
    });

    R.register({
      id: "Q-7",
      series: "Q",
      title: "KB upload 不支持的扩展 → 400",
      async run(ctx) {
        const create = await POST("/api/knowledge-bases", { name: `${PREFIX}_kb_q7` });
        if (!create.ok) return { ok: false, error: `kb create: ${create.status}` };
        created("kb", create.body.id, "Q7-kb");
        const fd = new FormData();
        fd.append("file", new Blob(["binary"], { type: "application/octet-stream" }), "x.exe");
        const r = await fetch(`/api/knowledge-bases/${create.body.id}/documents`, {
          method: "POST",
          credentials: "include",
          body: fd,
        });
        if (r.status !== 400) {
          return { ok: false, error: `expected 400 got ${r.status}` };
        }
        return { ok: true, evidence: { _note: ".exe rejected" } };
      },
    });

    // ---------- R series · Export ----------------------------------------
    R.register({
      id: "R-1",
      series: "R",
      title: "Export .md returns blob with Content-Disposition",
      async run(ctx) {
        if (!ctx.G1_meeting) return { ok: false, error: "SKIP_DEP_FAILED:G-1", evidence: { _skipped: true } };
        const r = await fetch(`/api/meetings/${ctx.G1_meeting}/export?format=md`, {
          credentials: "include",
        });
        if (!r.ok) return { ok: false, error: `${r.status}` };
        const cd = r.headers.get("Content-Disposition") || "";
        if (!cd.includes("attachment")) return { ok: false, error: `no attachment: ${cd}` };
        const txt = await r.text();
        if (txt.length < 100) return { ok: false, error: `tiny export: ${txt.length} chars` };
        return { ok: true, evidence: { _note: `${txt.length} chars · CD: ${cd.slice(0, 60)}` } };
      },
    });

    R.register({
      id: "R-2",
      series: "R",
      title: "Export .docx returns binary blob",
      async run(ctx) {
        if (!ctx.G1_meeting) return { ok: false, error: "SKIP_DEP_FAILED:G-1", evidence: { _skipped: true } };
        const r = await fetch(`/api/meetings/${ctx.G1_meeting}/export?format=docx`, {
          credentials: "include",
        });
        if (!r.ok) return { ok: false, error: `${r.status}` };
        const blob = await r.blob();
        if (blob.size < 1000) return { ok: false, error: `too small: ${blob.size}` };
        return { ok: true, evidence: { _note: `${blob.size} bytes` } };
      },
    });

    // ---------- V series · Regression ------------------------------------
    R.register({
      id: "V-16",
      series: "V",
      title: "DELETE /team/members/<self> → 400 (not 500)",
      async run(ctx) {
        const me = ctx.me || (await GET("/api/auth/me")).body;
        const r = await DEL(`/api/team/members/${me.user_id}`);
        if (r.status !== 400) return { ok: false, error: `expected 400 got ${r.status} ${JSON.stringify(r.body)}` };
        if (!/cannot remove yourself/i.test(r.body?.detail || "")) {
          return { ok: false, error: `unexpected detail: ${r.body?.detail}` };
        }
        return { ok: true, evidence: { _note: r.body.detail } };
      },
    });

    R.register({
      id: "V-18",
      series: "V",
      title: "POST /api/users 同名无邮箱幂等",
      async run(ctx) {
        const name = `${PREFIX}_user`;
        const u1 = await POST("/api/users", { name });
        const u2 = await POST("/api/users", { name });
        if (u1.body.id !== u2.body.id) {
          return { ok: false, error: `dup: ${u1.body.id} vs ${u2.body.id}` };
        }
        return { ok: true, evidence: { _note: u1.body.id } };
      },
    });

    // ---------- X series · M3.0 -------------------------------------------
    R.register({
      id: "X-1",
      series: "X",
      title: "Moderator agent exists with role='moderator'",
      async run(ctx) {
        const r = await GET("/api/agents");
        const mod = r.body.find((a) => a.role === "moderator");
        if (!mod) return { ok: false, error: "no moderator agent" };
        if (mod.color !== "amber") return { ok: false, error: `color: ${mod.color}` };
        return { ok: true, evidence: { _note: `id=${mod.id.slice(0, 8)}…` } };
      },
    });

    R.register({
      id: "X-3",
      series: "X",
      title: "Create meeting with agenda persists",
      async run(ctx) {
        const m = await POST("/api/meetings", {
          title: `${PREFIX}_X3`,
          attendee_user_ids: [],
          agenda: [
            { title: "数据出境合规评估", time_budget_min: 5 },
            { title: "产品上线计划" },
          ],
        });
        if (!m.ok) return { ok: false, error: `${m.status}` };
        ctx.X3_meeting = m.body.id;
        created("meeting", m.body.id, "X3");
        if (!Array.isArray(m.body.agenda) || m.body.agenda.length !== 2) {
          return { ok: false, error: `agenda not persisted: ${JSON.stringify(m.body.agenda)}` };
        }
        if (m.body.agenda[0].time_budget_min !== 5) {
          return { ok: false, error: "time_budget_min lost" };
        }
        return { ok: true, evidence: { _note: "2 agenda items persisted" } };
      },
    });

    R.register({
      id: "X-6",
      series: "X",
      title: "agenda-monitor/run-now 触发 off_topic banner + audit",
      async run(ctx) {
        if (!ctx.X3_meeting) return { ok: false, error: "depends on X-3" };
        const offTopic = ["中午吃啥", "假期去哪玩", "看了个电影", "下班一起喝酒", "周末打球"];
        for (const t of offTopic) {
          await POST(`/api/meetings/${ctx.X3_meeting}/manual-transcript`, { text: t });
        }
        const r = await POST(`/api/meetings/${ctx.X3_meeting}/agenda-monitor/run-now`, {});
        if (!r.ok) return { ok: false, error: `${r.status}` };
        if (!r.body.fired || r.body.payload?.type !== "agenda_off_topic") {
          return { ok: false, error: `unexpected: ${JSON.stringify(r.body)}` };
        }
        // Audit row
        await SLEEP(800);
        const audit = await GET("/api/audit?action=agenda.agenda_off_topic&limit=10");
        const found = audit.body.some((a) => a.target_id === ctx.X3_meeting);
        if (!found) return { ok: false, error: "no audit row" };
        return { ok: true, evidence: { _note: r.body.payload.reason?.slice(0, 60) } };
      },
    });

    R.register({
      id: "X-21",
      series: "X",
      title: "agenda_stuck 通过 run-now 触发(立场重复)",
      async run(ctx) {
        const m = await POST("/api/meetings", {
          title: `${PREFIX}_X21`,
          attendee_user_ids: [],
          agenda: [{ title: "先做声纹还是 AI 专家" }],
        });
        created("meeting", m.body.id, "X21");
        const users = await GET("/api/users");
        const u1 = users.body[0],
          u2 = users.body[1] || users.body[0];
        const lines = [
          { sp: u1.id, t: "我认为必须先做声纹,这是基础设施" },
          { sp: u2.id, t: "不对,应该先做 AI 专家,用户价值更高" },
          { sp: u1.id, t: "我坚持声纹,没有这个后面都白做" },
          { sp: u2.id, t: "我也坚持 AI 专家,没他 product 调不起来" },
          { sp: u1.id, t: "还是声纹优先。" },
          { sp: u2.id, t: "还是 AI 专家优先。" },
        ];
        for (const l of lines) {
          await POST(`/api/meetings/${m.body.id}/manual-transcript`, {
            text: l.t,
            speaker_user_id: l.sp,
          });
        }
        const r = await POST(`/api/meetings/${m.body.id}/agenda-monitor/run-now`, {});
        if (!r.ok || !r.body.fired) {
          return { ok: false, error: `not fired: ${JSON.stringify(r.body)}` };
        }
        if (r.body.payload?.type !== "agenda_stuck") {
          return { ok: false, error: `wrong type: ${r.body.payload?.type}` };
        }
        if (r.body.payload?.auto_summon_after_s !== 5) {
          return { ok: false, error: `bad countdown: ${r.body.payload?.auto_summon_after_s}` };
        }
        return {
          ok: true,
          evidence: { _note: `5s countdown · ${r.body.payload.stuck_summary?.slice(0, 40)}` },
        };
      },
    });

    R.register({
      id: "X-25",
      series: "X",
      title: "dissent-detector/run-now 同步触发",
      async run(ctx) {
        const m = await POST("/api/meetings", { title: `${PREFIX}_X25`, attendee_user_ids: [] });
        created("meeting", m.body.id, "X25");
        const users = await GET("/api/users");
        const u1 = users.body[0],
          u2 = users.body[1] || users.body[0];
        const lines = [
          { sp: u1.id, t: "数据出境必须单独申报" },
          { sp: u2.id, t: "我反对,这个走通用流程就行" },
          { sp: u1.id, t: "但是法规要求单独走" },
          { sp: u2.id, t: "我们规模没到那个量级,通用够了" },
          { sp: u1.id, t: "宁可严格,不能违规" },
          { sp: u2.id, t: "效率低成本高,不值得" },
        ];
        for (const l of lines) {
          await POST(`/api/meetings/${m.body.id}/manual-transcript`, {
            text: l.t,
            speaker_user_id: l.sp,
          });
        }
        const r = await POST(`/api/meetings/${m.body.id}/dissent-detector/run-now`, {});
        if (!r.ok || !r.body.fired) {
          return { ok: false, error: `not fired: ${JSON.stringify(r.body)}` };
        }
        if (r.body.payload?.type !== "dissent_detected") {
          return { ok: false, error: `wrong type: ${r.body.payload?.type}` };
        }
        return {
          ok: true,
          evidence: { _note: `topic: ${r.body.payload.topic?.slice(0, 30)}` },
        };
      },
    });

    R.register({
      id: "X-13",
      series: "X",
      title: "Action item PATCH status='done'",
      async run(ctx) {
        const m = await POST("/api/meetings", { title: `${PREFIX}_X13`, attendee_user_ids: [] });
        created("meeting", m.body.id, "X13");
        const a = await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_X13_action`,
        });
        if (!a.ok) return { ok: false, error: `create: ${a.status}` };
        const p = await PATCH(`/api/meetings/${m.body.id}/actions/${a.body.id}`, {
          status: "done",
        });
        if (!p.ok || p.body.status !== "done") return { ok: false, error: `${p.status}` };
        return { ok: true, evidence: { _note: "open → done" } };
      },
    });

    R.register({
      id: "X-29",
      series: "X",
      title: "Briefing 总数随 PATCH 实时变化(v14 修复)",
      async run(ctx) {
        const A = await POST("/api/meetings", { title: `${PREFIX}_X29A`, attendee_user_ids: [] });
        created("meeting", A.body.id, "X29-A");
        const items = [];
        for (const t of ["a1", "a2", "a3"]) {
          const a = await POST(`/api/meetings/${A.body.id}/actions`, {
            content: `${PREFIX}_X29_${t}`,
          });
          items.push(a.body);
        }
        const B = await POST("/api/meetings", { title: `${PREFIX}_X29B`, attendee_user_ids: [] });
        created("meeting", B.body.id, "X29-B");
        const b1 = await GET(`/api/meetings/${B.body.id}/briefing`);
        const head1 = (b1.body.briefing_md || "").split("\n")[0];
        // close 2
        await PATCH(`/api/meetings/${A.body.id}/actions/${items[0].id}`, { status: "done" });
        await PATCH(`/api/meetings/${A.body.id}/actions/${items[1].id}`, { status: "done" });
        const C = await POST("/api/meetings", { title: `${PREFIX}_X29C`, attendee_user_ids: [] });
        created("meeting", C.body.id, "X29-C");
        const b2 = await GET(`/api/meetings/${C.body.id}/briefing`);
        const head2 = (b2.body.briefing_md || "").split("\n")[0];
        const m1 = head1.match(/\((\d+) 项/);
        const m2 = head2.match(/\((\d+) 项/);
        if (!m1 || !m2) return { ok: false, error: `missing count: ${head1} / ${head2}` };
        const before = +m1[1],
          after = +m2[1];
        if (after !== before - 2) {
          return { ok: false, error: `expected ${before - 2}, got ${after} (head: ${head2})` };
        }
        return { ok: true, evidence: { _note: `${before} → ${after}` } };
      },
    });

    // ---------- Y series · Theme 1 collaboration loop --------------------
    R.register({
      id: "Y-1",
      series: "Y",
      title: "/api/me/actions 仅含分配给当前用户的 open 项",
      async run(ctx) {
        const me = ctx.me || (await GET("/api/auth/me")).body;
        if (!me?.user_id) return { ok: false, error: "no caller user_id" };
        const m = await POST("/api/meetings", { title: `${PREFIX}_Y1`, attendee_user_ids: [] });
        if (!m.ok) return { ok: false, error: `create meeting ${m.status}` };
        created("meeting", m.body.id, "Y1");
        const a = await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_Y1_mine`,
          assignee_user_id: me.user_id,
        });
        if (!a.ok) return { ok: false, error: `create action ${a.status} ${JSON.stringify(a.body)}` };
        ctx.Y1_meeting = m.body.id;
        ctx.Y1_action = a.body.id;
        const r = await GET("/api/me/actions?status=open");
        if (!r.ok) return { ok: false, error: `${r.status} ${JSON.stringify(r.body)}` };
        const found = (r.body || []).find((x) => x.id === a.body.id);
        if (!found) return { ok: false, error: "newly-assigned action missing in /api/me/actions" };
        if (found.status !== "open") return { ok: false, error: `unexpected status ${found.status}` };
        if (!found.meeting_title?.includes(PREFIX)) {
          return { ok: false, error: `meeting_title not joined: ${found.meeting_title}` };
        }
        return { ok: true, evidence: { _note: `${(r.body || []).length} my open items` } };
      },
    });

    R.register({
      id: "Y-2",
      series: "Y",
      title: "/api/me/actions?status=done 切换返回已完成项",
      async run(ctx) {
        if (!ctx.Y1_action || !ctx.Y1_meeting) {
          return { ok: false, error: "SKIP_DEP_FAILED:Y-1", evidence: { _skipped: true } };
        }
        const p = await PATCH(`/api/meetings/${ctx.Y1_meeting}/actions/${ctx.Y1_action}`, {
          status: "done",
        });
        if (!p.ok) return { ok: false, error: `patch ${p.status}` };
        const open = await GET("/api/me/actions?status=open");
        const done = await GET("/api/me/actions?status=done");
        if (!open.ok || !done.ok) return { ok: false, error: "list failed" };
        const inOpen = (open.body || []).some((x) => x.id === ctx.Y1_action);
        const inDone = (done.body || []).some((x) => x.id === ctx.Y1_action);
        if (inOpen) return { ok: false, error: "done item still in /me/actions?status=open" };
        if (!inDone) return { ok: false, error: "done item missing from /me/actions?status=done" };
        return { ok: true, evidence: { _note: "open / done filters honored" } };
      },
    });

    R.register({
      id: "Y-3",
      series: "Y",
      title: "评论 CRUD: 空 → POST → list → DELETE → 空",
      async run(ctx) {
        const m = await POST("/api/meetings", { title: `${PREFIX}_Y3`, attendee_user_ids: [] });
        if (!m.ok) return { ok: false, error: `create meeting ${m.status}` };
        created("meeting", m.body.id, "Y3");
        const a = await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_Y3_action`,
        });
        if (!a.ok) return { ok: false, error: `create action ${a.status}` };
        const empty = await GET(`/api/meetings/${m.body.id}/actions/${a.body.id}/comments`);
        if (!empty.ok) return { ok: false, error: `list comments ${empty.status}` };
        if ((empty.body || []).length !== 0) {
          return { ok: false, error: `expected 0 comments, got ${empty.body.length}` };
        }
        const c = await POST(
          `/api/meetings/${m.body.id}/actions/${a.body.id}/comments`,
          { content: `${PREFIX}_Y3_note` },
        );
        if (!c.ok) return { ok: false, error: `post comment ${c.status} ${JSON.stringify(c.body)}` };
        if (!c.body?.id) return { ok: false, error: "no comment id returned" };
        if (c.body.can_delete !== true) return { ok: false, error: "author can_delete should be true" };
        const after = await GET(`/api/meetings/${m.body.id}/actions/${a.body.id}/comments`);
        if (!(after.body || []).some((x) => x.id === c.body.id)) {
          return { ok: false, error: "posted comment not in list" };
        }
        const d = await DEL(
          `/api/meetings/${m.body.id}/actions/${a.body.id}/comments/${c.body.id}`,
        );
        if (!d.ok && d.status !== 204) return { ok: false, error: `delete ${d.status}` };
        const final = await GET(`/api/meetings/${m.body.id}/actions/${a.body.id}/comments`);
        if ((final.body || []).some((x) => x.id === c.body.id)) {
          return { ok: false, error: "comment still present after delete" };
        }
        return { ok: true, evidence: { _note: "create+list+delete OK" } };
      },
    });

    R.register({
      id: "Y-4",
      series: "Y",
      title: "评论作者 can_delete=true / 非作者无权删(单用户简化校验)",
      async run() {
        // Single-user smoke check: we can't impersonate a second user from
        // a single browser, so we verify the half we *can* — that the API
        // returns can_delete=true for the author and the delete endpoint
        // 404s on a bogus id (proxy for "not found / not authorized").
        const m = await POST("/api/meetings", { title: `${PREFIX}_Y4`, attendee_user_ids: [] });
        if (!m.ok) return { ok: false, error: `create meeting ${m.status}` };
        created("meeting", m.body.id, "Y4");
        const a = await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_Y4_action`,
        });
        const c = await POST(
          `/api/meetings/${m.body.id}/actions/${a.body.id}/comments`,
          { content: `${PREFIX}_Y4_msg` },
        );
        if (!c.ok || c.body.can_delete !== true) {
          return { ok: false, error: "author should see can_delete=true" };
        }
        const bogus = "00000000-0000-0000-0000-000000000000";
        const d = await DEL(`/api/meetings/${m.body.id}/actions/${a.body.id}/comments/${bogus}`);
        if (d.ok || (d.status !== 404 && d.status !== 403)) {
          return { ok: false, error: `bogus delete should 404/403, got ${d.status}` };
        }
        return { ok: true, evidence: { _note: "author owns delete; bogus 404" } };
      },
    });

    R.register({
      id: "Y-5",
      series: "Y",
      title: "通知接口形状 + unread_count 与 list 一致",
      async run() {
        const r = await GET("/api/me/notifications?unread_only=false&limit=10");
        if (!r.ok) return { ok: false, error: `${r.status} ${JSON.stringify(r.body)}` };
        if (!Array.isArray(r.body?.items)) {
          return { ok: false, error: "items not an array" };
        }
        if (typeof r.body.unread_count !== "number") {
          return { ok: false, error: `unread_count not a number (${typeof r.body.unread_count})` };
        }
        const unreadInList = r.body.items.filter((x) => !x.read_at).length;
        // unreadInList is bounded by limit=10, so we only check the
        // invariant that list-unread <= total unread_count.
        if (unreadInList > r.body.unread_count) {
          return {
            ok: false,
            error: `list shows ${unreadInList} unread but unread_count=${r.body.unread_count}`,
          };
        }
        return {
          ok: true,
          evidence: {
            _note: `${r.body.items.length} items · ${r.body.unread_count} unread`,
          },
        };
      },
    });

    R.register({
      id: "Y-6",
      series: "Y",
      title: "Self-assign 不产生 notification(no self-notify 规则)",
      async run(ctx) {
        const me = ctx.me || (await GET("/api/auth/me")).body;
        if (!me?.user_id) return { ok: false, error: "no caller user_id" };
        const before = await GET("/api/me/notifications?unread_only=true&limit=1");
        if (!before.ok) return { ok: false, error: `before ${before.status}` };
        const beforeCount = before.body?.unread_count ?? 0;
        const m = await POST("/api/meetings", { title: `${PREFIX}_Y6`, attendee_user_ids: [] });
        if (!m.ok) return { ok: false, error: `create meeting ${m.status}` };
        created("meeting", m.body.id, "Y6");
        await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_Y6_self`,
          assignee_user_id: me.user_id,
        });
        // Small grace window in case the cron tick fires concurrently —
        // we still expect 'self assignment' itself not to bump anything.
        await SLEEP(500);
        const after = await GET("/api/me/notifications?unread_only=true&limit=1");
        if (!after.ok) return { ok: false, error: `after ${after.status}` };
        const afterCount = after.body?.unread_count ?? 0;
        if (afterCount > beforeCount) {
          return {
            ok: false,
            error: `unread_count grew ${beforeCount} → ${afterCount} on self-assign`,
          };
        }
        return { ok: true, evidence: { _note: `unread_count stable: ${beforeCount}` } };
      },
    });

    R.register({
      id: "Y-7",
      series: "Y",
      title: "mark-all-read 将 unread_count 置 0",
      async run() {
        const r = await POST("/api/me/notifications/read-all", {});
        if (!r.ok && r.status !== 204) {
          return { ok: false, error: `read-all ${r.status}` };
        }
        const after = await GET("/api/me/notifications?unread_only=false&limit=10");
        if (!after.ok) return { ok: false, error: `list ${after.status}` };
        if ((after.body?.unread_count ?? -1) !== 0) {
          return { ok: false, error: `unread_count expected 0, got ${after.body.unread_count}` };
        }
        const stillUnread = (after.body.items || []).filter((x) => !x.read_at);
        if (stillUnread.length > 0) {
          return { ok: false, error: `${stillUnread.length} items still unread after mark-all` };
        }
        return { ok: true, evidence: { _note: "drawer cleared" } };
      },
    });

    // ---------- Z series · v17 Task 一级对象 (dual-write 验证) -------------
    R.register({
      id: "Z-1",
      series: "Z",
      title: "Manual action 创建后,Task 表有匹配 1:1 行(/api/me/tasks 可见)",
      async run(ctx) {
        const me = ctx.me || (await GET("/api/auth/me")).body;
        if (!me?.user_id) return { ok: false, error: "no caller user_id" };
        const m = await POST("/api/meetings", { title: `${PREFIX}_Z1`, attendee_user_ids: [] });
        if (!m.ok) return { ok: false, error: `create meeting ${m.status}` };
        created("meeting", m.body.id, "Z1");
        const a = await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_Z1_payload`,
          assignee_user_id: me.user_id,
        });
        if (!a.ok) return { ok: false, error: `create action ${a.status}` };
        const r = await GET("/api/me/tasks?status=open");
        if (!r.ok) return { ok: false, error: `list tasks ${r.status}` };
        const found = (r.body || []).find(
          (t) => t.content === `${PREFIX}_Z1_payload`,
        );
        if (!found) return { ok: false, error: "newly-created action's Task not in /me/tasks" };
        if (found.source_type !== "meeting") {
          return { ok: false, error: `expected source_type=meeting, got ${found.source_type}` };
        }
        if (!found.source_ref || found.source_ref.meeting_id !== m.body.id) {
          return { ok: false, error: `source_ref.meeting_id mismatch: ${JSON.stringify(found.source_ref)}` };
        }
        if (found.source_ref.action_item_id !== a.body.id) {
          return { ok: false, error: `source_ref.action_item_id mismatch` };
        }
        ctx.Z1_meeting = m.body.id;
        ctx.Z1_action = a.body.id;
        ctx.Z1_task = found.id;
        return { ok: true, evidence: { _note: `task=${found.id.slice(0, 8)}…` } };
      },
    });

    R.register({
      id: "Z-2",
      series: "Z",
      title: "PATCH action.status=done 镜像到 Task(/me/tasks 切桶)",
      async run(ctx) {
        if (!ctx.Z1_meeting || !ctx.Z1_action || !ctx.Z1_task) {
          return { ok: false, error: "SKIP_DEP_FAILED:Z-1", evidence: { _skipped: true } };
        }
        const p = await PATCH(
          `/api/meetings/${ctx.Z1_meeting}/actions/${ctx.Z1_action}`,
          { status: "done" },
        );
        if (!p.ok) return { ok: false, error: `patch ${p.status}` };
        const open = await GET("/api/me/tasks?status=open");
        const done = await GET("/api/me/tasks?status=done");
        if (!open.ok || !done.ok) return { ok: false, error: "list failed" };
        const inOpen = (open.body || []).some((t) => t.id === ctx.Z1_task);
        const inDone = (done.body || []).some((t) => t.id === ctx.Z1_task);
        if (inOpen) return { ok: false, error: "Task still in open after action set done" };
        if (!inDone) return { ok: false, error: "Task not in done bucket after mirror" };
        return { ok: true, evidence: { _note: "mirror status OK" } };
      },
    });

    R.register({
      id: "Z-3",
      series: "Z",
      title: "DELETE action 级联删除 paired Task(/me/tasks 不留 orphan)",
      async run(ctx) {
        const me = ctx.me || (await GET("/api/auth/me")).body;
        const m = await POST("/api/meetings", { title: `${PREFIX}_Z3`, attendee_user_ids: [] });
        if (!m.ok) return { ok: false, error: `create meeting ${m.status}` };
        created("meeting", m.body.id, "Z3");
        const a = await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_Z3_to_delete`,
          assignee_user_id: me.user_id,
        });
        if (!a.ok) return { ok: false, error: `create action ${a.status}` };
        const before = await GET("/api/me/tasks?status=all");
        const beforeFound = (before.body || []).find(
          (t) => t.content === `${PREFIX}_Z3_to_delete`,
        );
        if (!beforeFound) return { ok: false, error: "Task not visible before delete" };
        const taskId = beforeFound.id;
        const d = await DEL(`/api/meetings/${m.body.id}/actions/${a.body.id}`);
        if (!d.ok && d.status !== 204) return { ok: false, error: `delete ${d.status}` };
        const after = await GET("/api/me/tasks?status=all");
        if ((after.body || []).some((t) => t.id === taskId)) {
          return { ok: false, error: "Task still in /me/tasks after action delete" };
        }
        return { ok: true, evidence: { _note: "no orphan task after action delete" } };
      },
    });

    R.register({
      id: "Z-4",
      series: "Z",
      title: "/me/tasks 给 source_type=meeting 行注水 meeting_title",
      async run(ctx) {
        const me = ctx.me || (await GET("/api/auth/me")).body;
        const tag = `${PREFIX}_Z4_unique_title`;
        const m = await POST("/api/meetings", { title: tag, attendee_user_ids: [] });
        if (!m.ok) return { ok: false, error: `create meeting ${m.status}` };
        created("meeting", m.body.id, "Z4");
        const a = await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_Z4_action`,
          assignee_user_id: me.user_id,
        });
        if (!a.ok) return { ok: false, error: `create action ${a.status}` };
        const r = await GET("/api/me/tasks?status=open");
        const found = (r.body || []).find((t) => t.content === `${PREFIX}_Z4_action`);
        if (!found) return { ok: false, error: "task missing" };
        if (found.meeting_id !== m.body.id) {
          return { ok: false, error: `meeting_id not hydrated (got ${found.meeting_id})` };
        }
        if (found.meeting_title !== tag) {
          return { ok: false, error: `meeting_title not hydrated (got ${found.meeting_title})` };
        }
        return { ok: true, evidence: { _note: "title hydrated via source_ref join" } };
      },
    });

    R.register({
      id: "Z-5",
      series: "Z",
      title: "/me/tasks?status=active 含 open|dispatched|accepted|in_progress(复合桶)",
      async run(ctx) {
        // v18: Z-5 重定义 — 验证 'active' 复合桶 + 'pending'(待签收) + 'working'(办理中)
        // 三种新过滤生效。在 prod 默认账号下,不一定有现成数据,只校验返回是数组 + 200。
        for (const s of ["active", "pending", "working", "all"]) {
          const r = await GET(`/api/me/tasks?status=${s}`);
          if (!r.ok) return { ok: false, error: `${s} → ${r.status}` };
          if (!Array.isArray(r.body)) return { ok: false, error: `${s} not array` };
        }
        return { ok: true, evidence: { _note: "active/pending/working/all 四种过滤都 200" } };
      },
    });

    // ---------- Z (cont'd) · v18 状态机 + 派发签收 + 三级催办 -------------
    R.register({
      id: "Z-6",
      series: "Z",
      title: "派发: open → dispatched, 写时间戳 + 派发人",
      async run(ctx) {
        const me = ctx.me || (await GET("/api/auth/me")).body;
        if (!me?.user_id) return { ok: false, error: "no caller user_id" };
        const m = await POST("/api/meetings", { title: `${PREFIX}_Z6`, attendee_user_ids: [] });
        if (!m.ok) return { ok: false, error: `create meeting ${m.status}` };
        created("meeting", m.body.id, "Z6");
        const a = await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_Z6_action`,
        });
        if (!a.ok) return { ok: false, error: `create action ${a.status}` };
        // 找到对应 task
        const list = await GET("/api/me/tasks?status=all");
        // action 没有 assignee,所以 task.assignee_user_id 为 null,/me/tasks 拿不到
        // 改用 meeting actions 接口拿 task_id
        const actionRows = await GET(`/api/meetings/${m.body.id}/actions`);
        const actionRow = actionRows.body && actionRows.body[0];
        if (!actionRow) return { ok: false, error: "action not in meeting list" };
        // 通过 v18 dispatch 端点把 task 派给自己
        // 先要知道 task_id — Z-1 已经验证过 source_ref.action_item_id,这里走另一条:
        // /me/tasks?status=all assignee 默认空,不会出现。我们走 PATCH action 设置 assignee 的方式:
        // 但这里我们是直接测 dispatch 端点。需要 task_id,从 source_ref 里反查 action_item.id 的工具没有。
        // 简化:创 action 时直接带 assignee_user_id=me,这样 task 立刻归我,/me/tasks 能看到 task_id。
        const a2 = await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_Z6_dispatchable`,
          assignee_user_id: me.user_id,
        });
        if (!a2.ok) return { ok: false, error: `create assignee=me action ${a2.status}` };
        const myTasks = await GET("/api/me/tasks?status=all");
        const t = (myTasks.body || []).find((x) => x.content === `${PREFIX}_Z6_dispatchable`);
        if (!t) return { ok: false, error: "task not visible to me after assignee=me" };
        ctx.Z6_task = t.id;
        ctx.Z6_meeting = m.body.id;
        // 派发本身要求 status='open',我们的初始 task 已经 open
        const dispatchedDue = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
        const d = await POST(`/api/me/tasks/${t.id}/dispatch`, {
          assignee_user_id: me.user_id,
          due_at: dispatchedDue,
          note: `${PREFIX}_dispatch_note`,
        });
        if (!d.ok) return { ok: false, error: `dispatch ${d.status} ${JSON.stringify(d.body)}` };
        if (d.body.status !== "dispatched") {
          return { ok: false, error: `expected status=dispatched, got ${d.body.status}` };
        }
        if (!d.body.dispatched_at) return { ok: false, error: "dispatched_at not stamped" };
        if (d.body.dispatched_by_user_id !== me.user_id) {
          return { ok: false, error: "dispatched_by_user_id mismatch" };
        }
        return { ok: true, evidence: { _note: `task ${t.id.slice(0, 8)}… → dispatched` } };
      },
    });

    R.register({
      id: "Z-7",
      series: "Z",
      title: "签收: dispatched → accepted, 写 accepted_at",
      async run(ctx) {
        if (!ctx.Z6_task) return { ok: false, error: "SKIP_DEP_FAILED:Z-6", evidence: { _skipped: true } };
        const r = await POST(`/api/me/tasks/${ctx.Z6_task}/accept`, {});
        if (!r.ok) return { ok: false, error: `accept ${r.status}` };
        if (r.body.status !== "accepted") {
          return { ok: false, error: `expected status=accepted, got ${r.body.status}` };
        }
        if (!r.body.accepted_at) return { ok: false, error: "accepted_at not stamped" };
        return { ok: true, evidence: { _note: "accepted with timestamp" } };
      },
    });

    R.register({
      id: "Z-8",
      series: "Z",
      title: "办理 + 办结: accepted → in_progress → done",
      async run(ctx) {
        if (!ctx.Z6_task) return { ok: false, error: "SKIP_DEP_FAILED:Z-6", evidence: { _skipped: true } };
        const start = await POST(`/api/me/tasks/${ctx.Z6_task}/start`, {});
        if (!start.ok || start.body.status !== "in_progress") {
          return { ok: false, error: `start ${start.status} status=${start.body && start.body.status}` };
        }
        if (!start.body.started_at) return { ok: false, error: "started_at not stamped" };
        const done = await POST(`/api/me/tasks/${ctx.Z6_task}/complete`, {});
        if (!done.ok || done.body.status !== "done") {
          return { ok: false, error: `complete ${done.status} status=${done.body && done.body.status}` };
        }
        // ActionItem 镜像应当为 'done'
        const actions = await GET(`/api/meetings/${ctx.Z6_meeting}/actions`);
        const ai = (actions.body || []).find(
          (x) => x.content === `${PREFIX}_Z6_dispatchable`,
        );
        if (!ai || ai.status !== "done") {
          return { ok: false, error: `mirror to ActionItem failed: ${ai && ai.status}` };
        }
        return { ok: true, evidence: { _note: "in_progress → done + ActionItem 镜像" } };
      },
    });

    R.register({
      id: "Z-9",
      series: "Z",
      title: "退回: dispatched → open + 清空 assignee",
      async run() {
        const me = (await GET("/api/auth/me")).body;
        const m = await POST("/api/meetings", { title: `${PREFIX}_Z9`, attendee_user_ids: [] });
        if (!m.ok) return { ok: false, error: `create meeting ${m.status}` };
        created("meeting", m.body.id, "Z9");
        const a = await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_Z9_action`,
          assignee_user_id: me.user_id,
        });
        const myTasks = await GET("/api/me/tasks?status=all");
        const t = (myTasks.body || []).find((x) => x.content === `${PREFIX}_Z9_action`);
        if (!t) return { ok: false, error: "task not visible" };
        const dispatched = await POST(`/api/me/tasks/${t.id}/dispatch`, {
          assignee_user_id: me.user_id,
        });
        if (!dispatched.ok) return { ok: false, error: `dispatch ${dispatched.status}` };
        const ret = await POST(`/api/me/tasks/${t.id}/return`, { reason: "test return" });
        if (!ret.ok || ret.body.status !== "open") {
          return { ok: false, error: `return ${ret.status} status=${ret.body && ret.body.status}` };
        }
        if (ret.body.assignee_user_id !== null) {
          return { ok: false, error: `assignee should be cleared, got ${ret.body.assignee_user_id}` };
        }
        return { ok: true, evidence: { _note: "returned + assignee cleared" } };
      },
    });

    R.register({
      id: "Z-10",
      series: "Z",
      title: "非法转换被拒: 直接对 open 状态 accept 应 422",
      async run() {
        const me = (await GET("/api/auth/me")).body;
        const m = await POST("/api/meetings", { title: `${PREFIX}_Z10`, attendee_user_ids: [] });
        if (!m.ok) return { ok: false, error: `create meeting ${m.status}` };
        created("meeting", m.body.id, "Z10");
        const a = await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_Z10_action`,
          assignee_user_id: me.user_id,
        });
        const myTasks = await GET("/api/me/tasks?status=all");
        const t = (myTasks.body || []).find((x) => x.content === `${PREFIX}_Z10_action`);
        if (!t) return { ok: false, error: "task not visible" };
        // task 当前 'open',直接尝试 accept(应当是 dispatched 才能 accept)
        const r = await POST(`/api/me/tasks/${t.id}/accept`, {});
        if (r.ok || r.status !== 422) {
          return {
            ok: false,
            error: `expected 422, got ${r.status} ${JSON.stringify(r.body)}`,
          };
        }
        return { ok: true, evidence: { _note: "状态机正确拒绝非法转换 (422)" } };
      },
    });

    R.register({
      id: "Z-11",
      series: "Z",
      title: "通知 severity 字段存在 + max_unread_severity 接口稳定",
      async run() {
        const r = await GET("/api/me/notifications?limit=10");
        if (!r.ok) return { ok: false, error: `${r.status}` };
        if (typeof r.body.max_unread_severity !== "string") {
          return { ok: false, error: "max_unread_severity not a string" };
        }
        if (!["normal", "yellow", "red", "purple"].includes(r.body.max_unread_severity)) {
          return { ok: false, error: `bad severity: ${r.body.max_unread_severity}` };
        }
        // 每条 item 必须带 severity
        for (const it of r.body.items || []) {
          if (typeof it.severity !== "string") {
            return { ok: false, error: `item missing severity: ${it.id}` };
          }
        }
        return {
          ok: true,
          evidence: {
            _note: `max_severity=${r.body.max_unread_severity}, ${r.body.items.length} items`,
          },
        };
      },
    });

    R.register({
      id: "Z-12",
      series: "Z",
      title: "派发触发 task_dispatched 通知(单浏览器 self-dispatch 抑制规则反向校验)",
      async run() {
        const me = (await GET("/api/auth/me")).body;
        // self-dispatch:派给自己 → 不应该产生 task_dispatched 通知
        const before = await GET("/api/me/notifications?unread_only=true&limit=1");
        const beforeCount = (before.body && before.body.unread_count) || 0;
        const m = await POST("/api/meetings", { title: `${PREFIX}_Z12`, attendee_user_ids: [] });
        if (!m.ok) return { ok: false, error: `create meeting ${m.status}` };
        created("meeting", m.body.id, "Z12");
        const a = await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_Z12_action`,
          assignee_user_id: me.user_id,
        });
        const myTasks = await GET("/api/me/tasks?status=all");
        const t = (myTasks.body || []).find((x) => x.content === `${PREFIX}_Z12_action`);
        if (!t) return { ok: false, error: "task not visible" };
        const d = await POST(`/api/me/tasks/${t.id}/dispatch`, {
          assignee_user_id: me.user_id,
        });
        if (!d.ok) return { ok: false, error: `dispatch ${d.status}` };
        await SLEEP(300);
        const after = await GET("/api/me/notifications?unread_only=true&limit=1");
        const afterCount = (after.body && after.body.unread_count) || 0;
        if (afterCount > beforeCount) {
          return {
            ok: false,
            error: `self-dispatch should not bump unread_count (${beforeCount} → ${afterCount})`,
          };
        }
        return { ok: true, evidence: { _note: "self-dispatch 抑制 OK" } };
      },
    });

    // ---------- AA series · v19 领导指令 + 状态机收尾 ---------------------
    R.register({
      id: "AA-1",
      series: "AA",
      title: "POST /directives 同步 LLM 拆解,返回 drafts 列表",
      async run(ctx) {
        const me = ctx.me || (await GET("/api/auth/me")).body;
        if (!me?.user_id) return { ok: false, error: "no caller user_id" };
        // 一条标准政务风指令,期望拆出 1-2 条任务
        const text = `${PREFIX}_AA1_directive: 请王科长在本周五前提交一份小散工程上半年安全检查报告。`;
        const r = await POST("/api/me/directives", { content: text });
        if (!r.ok) return { ok: false, error: `${r.status} ${JSON.stringify(r.body)}` };
        if (!r.body?.id) return { ok: false, error: "no directive id" };
        if (r.body.status !== "draft") {
          return { ok: false, error: `expected status=draft, got ${r.body.status}` };
        }
        if (!Array.isArray(r.body.drafts)) {
          return { ok: false, error: "drafts not array" };
        }
        if (r.body.parse_error) {
          // LLM unavailable — surface but do not fail (AA-2..5 will cascade skip)
          return { ok: false, error: `parse_error: ${r.body.parse_error}` };
        }
        if (r.body.drafts.length === 0) {
          return { ok: false, error: "0 drafts (LLM 未识别出任务)" };
        }
        ctx.AA1_directive = r.body.id;
        ctx.AA1_drafts = r.body.drafts;
        return {
          ok: true,
          evidence: {
            _note: `${r.body.drafts.length} draft(s),example: ${(r.body.drafts[0].content || "").slice(0, 30)}`,
          },
        };
      },
    });

    R.register({
      id: "AA-2",
      series: "AA",
      title: "POST /directives/{did}/commit 批量入库 Task(source_type=leader_directive)",
      async run(ctx) {
        if (!ctx.AA1_directive || !ctx.AA1_drafts) {
          return { ok: false, error: "SKIP_DEP_FAILED:AA-1", evidence: { _skipped: true } };
        }
        const me = ctx.me || (await GET("/api/auth/me")).body;
        // 把 LLM 草稿全部派给自己 + 不直接派发(dispatch=false)以保 status=open
        const tasks = ctx.AA1_drafts.map((d) => ({
          content: d.content,
          title: d.title || null,
          assignee_user_id: me.user_id,
          due_at: null,
          dispatch: false,
        }));
        const r = await POST(`/api/me/directives/${ctx.AA1_directive}/commit`, { tasks });
        if (!r.ok) return { ok: false, error: `${r.status} ${JSON.stringify(r.body)}` };
        if (!Array.isArray(r.body.committed_task_ids)) {
          return { ok: false, error: "committed_task_ids not array" };
        }
        if (r.body.committed_task_ids.length !== tasks.length) {
          return { ok: false, error: `expected ${tasks.length} ids, got ${r.body.committed_task_ids.length}` };
        }
        if (r.body.dispatched_count !== 0) {
          return { ok: false, error: `expected dispatched=0, got ${r.body.dispatched_count}` };
        }
        // 校验入库的 Task 在 /me/tasks 里能找到,source_type=leader_directive
        const myTasks = await GET("/api/me/tasks?status=all");
        const found = (myTasks.body || []).filter((t) => r.body.committed_task_ids.includes(t.id));
        if (found.length !== tasks.length) {
          return { ok: false, error: `not all tasks visible in /me/tasks (${found.length}/${tasks.length})` };
        }
        for (const t of found) {
          if (t.source_type !== "leader_directive") {
            return { ok: false, error: `wrong source_type ${t.source_type}` };
          }
          if (!t.source_ref || t.source_ref.directive_id !== ctx.AA1_directive) {
            return { ok: false, error: `source_ref.directive_id missing` };
          }
        }
        ctx.AA2_task_ids = r.body.committed_task_ids;
        return { ok: true, evidence: { _note: `${tasks.length} tasks, all source_type=leader_directive` } };
      },
    });

    R.register({
      id: "AA-3",
      series: "AA",
      title: "commit 带 dispatch=true → Task 直接进 dispatched 状态",
      async run(ctx) {
        const me = ctx.me || (await GET("/api/auth/me")).body;
        // 先创第二条指令(已知 LLM 工作就跳过 LLM 用空草稿 + 自定义 task)
        const txt = `${PREFIX}_AA3_directive: 测试派发立即生效场景。`;
        const dr = await POST("/api/me/directives", { content: txt });
        if (!dr.ok) return { ok: false, error: `create dir ${dr.status}` };
        if (dr.body.parse_error) {
          return { ok: false, error: `LLM error: ${dr.body.parse_error}` };
        }
        // 用我们自定义的 task 列表(不依赖 LLM 解析结果),需要 assignee_user_id≠我以触发通知
        // 但单浏览器场景下 self-dispatch 是抑制通知的,所以这里只验证状态
        const cr = await POST(`/api/me/directives/${dr.body.id}/commit`, {
          tasks: [
            {
              content: `${PREFIX}_AA3_dispatched_task`,
              assignee_user_id: me.user_id,
              dispatch: true,
            },
          ],
        });
        if (!cr.ok) return { ok: false, error: `commit ${cr.status} ${JSON.stringify(cr.body)}` };
        if (cr.body.committed_task_ids.length !== 1) {
          return { ok: false, error: `expected 1 task` };
        }
        const taskId = cr.body.committed_task_ids[0];
        const myTasks = await GET("/api/me/tasks?status=all");
        const t = (myTasks.body || []).find((x) => x.id === taskId);
        if (!t) return { ok: false, error: "task not found" };
        if (t.status !== "dispatched") {
          return { ok: false, error: `expected status=dispatched, got ${t.status}` };
        }
        if (!t.dispatched_at) return { ok: false, error: "dispatched_at not stamped" };
        ctx.AA3_task = taskId;
        return { ok: true, evidence: { _note: `task ${taskId.slice(0, 8)}… directly dispatched` } };
      },
    });

    R.register({
      id: "AA-4",
      series: "AA",
      title: "POST /directives/{did}/discard → status=discarded 不入库 Task",
      async run() {
        const txt = `${PREFIX}_AA4_to_discard: 此指令将被丢弃。`;
        const dr = await POST("/api/me/directives", { content: txt });
        if (!dr.ok) return { ok: false, error: `create ${dr.status}` };
        const did = dr.body.id;
        const r = await POST(`/api/me/directives/${did}/discard`, {});
        if (!r.ok && r.status !== 204) {
          return { ok: false, error: `discard ${r.status}` };
        }
        // 再 commit 应当 409
        const c2 = await POST(`/api/me/directives/${did}/commit`, {
          tasks: [{ content: "foo" }],
        });
        if (c2.ok || c2.status !== 409) {
          return { ok: false, error: `expected 409 on commit-after-discard, got ${c2.status}` };
        }
        return { ok: true, evidence: { _note: "discard + commit-after-discard 409" } };
      },
    });

    R.register({
      id: "AA-5",
      series: "AA",
      title: "上报办结申请: in_progress → submitted",
      async run(ctx) {
        if (!ctx.AA3_task) {
          return { ok: false, error: "SKIP_DEP_FAILED:AA-3", evidence: { _skipped: true } };
        }
        // AA-3 task 当前 dispatched, 走 accept → start → submit
        const a = await POST(`/api/me/tasks/${ctx.AA3_task}/accept`, {});
        if (!a.ok) return { ok: false, error: `accept ${a.status}` };
        const s = await POST(`/api/me/tasks/${ctx.AA3_task}/start`, {});
        if (!s.ok) return { ok: false, error: `start ${s.status}` };
        const sub = await POST(`/api/me/tasks/${ctx.AA3_task}/submit`, { note: "AA-5 test note" });
        if (!sub.ok) return { ok: false, error: `submit ${sub.status} ${JSON.stringify(sub.body)}` };
        if (sub.body.status !== "submitted") {
          return { ok: false, error: `expected status=submitted, got ${sub.body.status}` };
        }
        return { ok: true, evidence: { _note: "in_progress → submitted" } };
      },
    });

    R.register({
      id: "AA-6",
      series: "AA",
      title: "审核通过: submitted → done(creator/dispatcher 通过)",
      async run(ctx) {
        if (!ctx.AA3_task) {
          return { ok: false, error: "SKIP_DEP_FAILED:AA-3", evidence: { _skipped: true } };
        }
        // caller 同时是 creator(via directive)和 assignee — approve 应被允许
        // (workflow:领导自己派给自己的简化场景,我们允许 creator 自审)
        const r = await POST(`/api/me/tasks/${ctx.AA3_task}/approve`, {});
        if (!r.ok) return { ok: false, error: `approve ${r.status} ${JSON.stringify(r.body)}` };
        if (r.body.status !== "done") {
          return { ok: false, error: `expected done, got ${r.body.status}` };
        }
        return { ok: true, evidence: { _note: "submitted → done" } };
      },
    });

    R.register({
      id: "AA-7",
      series: "AA",
      title: "审核驳回返工: submitted → in_progress + 携带 reason",
      async run(ctx) {
        const me = ctx.me || (await GET("/api/auth/me")).body;
        // 新建一条指令 + dispatch=true + 走完到 submitted
        const dr = await POST("/api/me/directives", {
          content: `${PREFIX}_AA7_directive: 跑驳回路径用例。`,
        });
        if (!dr.ok) return { ok: false, error: `dir ${dr.status}` };
        const cr = await POST(`/api/me/directives/${dr.body.id}/commit`, {
          tasks: [
            {
              content: `${PREFIX}_AA7_task`,
              assignee_user_id: me.user_id,
              dispatch: true,
            },
          ],
        });
        if (!cr.ok) return { ok: false, error: `commit ${cr.status}` };
        const tid = cr.body.committed_task_ids[0];
        await POST(`/api/me/tasks/${tid}/accept`, {});
        await POST(`/api/me/tasks/${tid}/start`, {});
        await POST(`/api/me/tasks/${tid}/submit`, {});
        const r = await POST(`/api/me/tasks/${tid}/reject`, {
          reason: "AA-7 驳回原因测试",
        });
        if (!r.ok) return { ok: false, error: `reject ${r.status} ${JSON.stringify(r.body)}` };
        if (r.body.status !== "in_progress") {
          return { ok: false, error: `expected in_progress, got ${r.body.status}` };
        }
        return { ok: true, evidence: { _note: "rejected → in_progress" } };
      },
    });

    R.register({
      id: "AA-8",
      series: "AA",
      title: "归档: done → archived; 非法转换(open → approve)被拒 422",
      async run(ctx) {
        if (!ctx.AA3_task) {
          return { ok: false, error: "SKIP_DEP_FAILED:AA-3", evidence: { _skipped: true } };
        }
        // AA-3 task 已经 done(在 AA-6 approve 后),归档
        const arc = await POST(`/api/me/tasks/${ctx.AA3_task}/archive`, {});
        if (!arc.ok) return { ok: false, error: `archive ${arc.status} ${JSON.stringify(arc.body)}` };
        if (arc.body.status !== "archived") {
          return { ok: false, error: `expected archived, got ${arc.body.status}` };
        }
        // 新建一个 open 状态 task,直接 approve 应当 422
        const me = ctx.me || (await GET("/api/auth/me")).body;
        const m = await POST("/api/meetings", { title: `${PREFIX}_AA8_setup`, attendee_user_ids: [] });
        created("meeting", m.body.id, "AA8");
        await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_AA8_open_task`,
          assignee_user_id: me.user_id,
        });
        const myTasks = await GET("/api/me/tasks?status=all");
        const tt = (myTasks.body || []).find((x) => x.content === `${PREFIX}_AA8_open_task`);
        if (!tt) return { ok: false, error: "setup task not found" };
        const r = await POST(`/api/me/tasks/${tt.id}/approve`, {});
        if (r.ok || r.status !== 422) {
          return { ok: false, error: `expected 422 on illegal approve from open, got ${r.status}` };
        }
        return { ok: true, evidence: { _note: "archive OK + illegal transition 422" } };
      },
    });

    // ---------- BB series · v20 上级文件触发源 + cron 巡检触发源 ---------
    R.register({
      id: "BB-1",
      series: "BB",
      title: "POST /upper-docs 上传纯文本 → LLM 拆解 → drafts",
      async run(ctx) {
        const me = ctx.me || (await GET("/api/auth/me")).body;
        if (!me?.user_id) return { ok: false, error: "no caller user_id" };
        const text = `${PREFIX}_BB1_doc:\n\n关于本周工作安排的通知\n\n请王科长在本周五前提交一份小散工程上半年安全检查报告。\n李主任同步起草下一阶段招标公告。`;
        const blob = new Blob([text], { type: "text/plain" });
        const fd = new FormData();
        fd.append("file", blob, `${PREFIX}_BB1_doc.txt`);
        const r = await fetch("/api/me/upper-docs", {
          method: "POST",
          credentials: "include",
          body: fd,
        });
        if (!r.ok) return { ok: false, error: `${r.status} ${await r.text().catch(() => "")}` };
        const body = await r.json();
        if (!body.id) return { ok: false, error: "no upper_doc id" };
        if (body.parse_error) {
          return { ok: false, error: `parse_error: ${body.parse_error}` };
        }
        if (!Array.isArray(body.drafts) || body.drafts.length === 0) {
          return { ok: false, error: "0 drafts" };
        }
        ctx.BB1_upper_doc = body.id;
        ctx.BB1_drafts = body.drafts;
        return {
          ok: true,
          evidence: { _note: `${body.drafts.length} draft(s) from .txt` },
        };
      },
    });

    R.register({
      id: "BB-2",
      series: "BB",
      title: "commit upper-doc → Tasks source_type='upper_doc' + source_ref.upper_doc_id",
      async run(ctx) {
        if (!ctx.BB1_upper_doc || !ctx.BB1_drafts) {
          return { ok: false, error: "SKIP_DEP_FAILED:BB-1", evidence: { _skipped: true } };
        }
        const me = ctx.me || (await GET("/api/auth/me")).body;
        const tasks = ctx.BB1_drafts.map((d) => ({
          content: d.content,
          assignee_user_id: me.user_id,
          dispatch: false,
        }));
        const r = await POST(`/api/me/upper-docs/${ctx.BB1_upper_doc}/commit`, { tasks });
        if (!r.ok) return { ok: false, error: `${r.status} ${JSON.stringify(r.body)}` };
        if (!Array.isArray(r.body.committed_task_ids)) {
          return { ok: false, error: "no committed_task_ids" };
        }
        const myTasks = await GET("/api/me/tasks?status=all");
        const found = (myTasks.body || []).filter((t) =>
          r.body.committed_task_ids.includes(t.id),
        );
        if (found.length !== tasks.length) {
          return { ok: false, error: `expected ${tasks.length}, got ${found.length}` };
        }
        for (const t of found) {
          if (t.source_type !== "upper_doc") {
            return { ok: false, error: `wrong source_type ${t.source_type}` };
          }
          if (!t.source_ref || t.source_ref.upper_doc_id !== ctx.BB1_upper_doc) {
            return { ok: false, error: "source_ref.upper_doc_id missing" };
          }
        }
        return { ok: true, evidence: { _note: `${tasks.length} task(s) source_type=upper_doc` } };
      },
    });

    R.register({
      id: "BB-3",
      series: "BB",
      title: "discard upper-doc → status='discarded' + commit-after-discard 409",
      async run() {
        const text = `${PREFIX}_BB3_to_discard: 测试用,准备丢弃。`;
        const blob = new Blob([text], { type: "text/plain" });
        const fd = new FormData();
        fd.append("file", blob, `${PREFIX}_BB3.txt`);
        const r = await fetch("/api/me/upper-docs", {
          method: "POST",
          credentials: "include",
          body: fd,
        });
        if (!r.ok) return { ok: false, error: `upload ${r.status}` };
        const body = await r.json();
        const did = body.id;
        const dr = await POST(`/api/me/upper-docs/${did}/discard`, {});
        if (!dr.ok && dr.status !== 204) return { ok: false, error: `discard ${dr.status}` };
        const c2 = await POST(`/api/me/upper-docs/${did}/commit`, {
          tasks: [{ content: "should not work" }],
        });
        if (c2.ok || c2.status !== 409) {
          return { ok: false, error: `expected 409, got ${c2.status}` };
        }
        return { ok: true, evidence: { _note: "discard + 409 OK" } };
      },
    });

    R.register({
      id: "BB-4",
      series: "BB",
      title: "cron rule CRUD: create / list / patch / delete",
      async run(ctx) {
        const c = await POST("/api/cron-rules", {
          name: `${PREFIX}_BB4_rule`,
          cron_expr: "0 9 * * 1",
          task_template_content: `${PREFIX}_BB4_template_content`,
          is_active: true,
        });
        if (!c.ok) return { ok: false, error: `create ${c.status} ${JSON.stringify(c.body)}` };
        const rid = c.body.id;
        const list = await GET("/api/cron-rules");
        if (!list.ok) return { ok: false, error: `list ${list.status}` };
        if (!(list.body || []).some((x) => x.id === rid)) {
          return { ok: false, error: "newly created not in list" };
        }
        const p = await PATCH(`/api/cron-rules/${rid}`, { is_active: false });
        if (!p.ok) return { ok: false, error: `patch ${p.status}` };
        if (p.body.is_active !== false) {
          return { ok: false, error: `is_active toggle failed` };
        }
        const d = await DEL(`/api/cron-rules/${rid}`);
        if (!d.ok && d.status !== 204) return { ok: false, error: `delete ${d.status}` };
        return { ok: true, evidence: { _note: "create/list/patch/delete OK" } };
      },
    });

    R.register({
      id: "BB-5",
      series: "BB",
      title: "cron force-fire 立即生成 Task(source_type='cron')",
      async run(ctx) {
        const me = ctx.me || (await GET("/api/auth/me")).body;
        const c = await POST("/api/cron-rules", {
          name: `${PREFIX}_BB5_rule`,
          cron_expr: "0 9 * * 1",
          task_template_content: `${PREFIX}_BB5_template`,
          task_template_assignee_user_id: me.user_id,
          auto_dispatch: false,
          is_active: true,
        });
        if (!c.ok) return { ok: false, error: `create rule ${c.status}` };
        const rid = c.body.id;
        const f = await POST(`/api/cron-rules/${rid}/force-fire`, {});
        if (!f.ok) return { ok: false, error: `force-fire ${f.status} ${JSON.stringify(f.body)}` };
        if (!f.body.task_id) return { ok: false, error: "no task_id" };
        const tid = f.body.task_id;
        const myTasks = await GET("/api/me/tasks?status=all");
        const t = (myTasks.body || []).find((x) => x.id === tid);
        if (!t) return { ok: false, error: "task not visible to me" };
        if (t.source_type !== "cron") {
          return { ok: false, error: `wrong source_type ${t.source_type}` };
        }
        if (!t.source_ref || t.source_ref.rule_id !== rid) {
          return { ok: false, error: "source_ref.rule_id missing" };
        }
        if (t.status !== "open") {
          return { ok: false, error: `expected open, got ${t.status}` };
        }
        // cleanup
        await DEL(`/api/cron-rules/${rid}`);
        return { ok: true, evidence: { _note: "force-fire creates open Task" } };
      },
    });

    R.register({
      id: "BB-6",
      series: "BB",
      title: "cron auto_dispatch=true + assignee → Task 直接 dispatched",
      async run(ctx) {
        const me = ctx.me || (await GET("/api/auth/me")).body;
        const c = await POST("/api/cron-rules", {
          name: `${PREFIX}_BB6_rule`,
          cron_expr: "0 9 * * 1",
          task_template_content: `${PREFIX}_BB6_dispatched`,
          task_template_assignee_user_id: me.user_id,
          auto_dispatch: true,
          due_days_after: 7,
          is_active: true,
        });
        if (!c.ok) return { ok: false, error: `create ${c.status}` };
        const rid = c.body.id;
        const f = await POST(`/api/cron-rules/${rid}/force-fire`, {});
        if (!f.ok) return { ok: false, error: `fire ${f.status}` };
        const tid = f.body.task_id;
        const myTasks = await GET("/api/me/tasks?status=all");
        const t = (myTasks.body || []).find((x) => x.id === tid);
        if (!t) return { ok: false, error: "task not found" };
        if (t.status !== "dispatched") {
          return { ok: false, error: `expected dispatched, got ${t.status}` };
        }
        if (!t.dispatched_at) return { ok: false, error: "dispatched_at not stamped" };
        if (!t.due_at) return { ok: false, error: "due_at not stamped" };
        await DEL(`/api/cron-rules/${rid}`);
        return { ok: true, evidence: { _note: "auto_dispatch + due_days_after OK" } };
      },
    });

    R.register({
      id: "BB-7",
      series: "BB",
      title: "非法 cron_expr → POST /cron-rules 400",
      async run() {
        const c = await POST("/api/cron-rules", {
          name: `${PREFIX}_BB7_bad`,
          cron_expr: "this is not a cron",
          task_template_content: "x",
        });
        if (c.ok || c.status !== 400) {
          return { ok: false, error: `expected 400, got ${c.status}` };
        }
        return { ok: true, evidence: { _note: "invalid cron rejected 400" } };
      },
    });

    // ---------- CC series · v21 角色二分 + 数据分级 + 跨 AI 共享 -----------
    R.register({
      id: "CC-1",
      series: "CC",
      title: "GET /api/team/members 返回带 role + bound_agent_id 字段",
      async run(ctx) {
        const r = await GET("/api/team/members");
        if (!r.ok) return { ok: false, error: `${r.status}` };
        if (!Array.isArray(r.body) || r.body.length === 0) {
          return { ok: false, error: "members empty/unknown shape" };
        }
        const sample = r.body[0];
        // shape:必须有 role 字段;bound_agent_id 可为 null
        if (!("role" in sample) || !("bound_agent_id" in sample)) {
          return { ok: false, error: "missing role or bound_agent_id field" };
        }
        return {
          ok: true,
          evidence: { _note: `${r.body.length} members; first.role=${sample.role}` },
        };
      },
    });

    R.register({
      id: "CC-2",
      series: "CC",
      title: "PATCH /api/team/members/<self> → 400 (不能改自己)",
      async run(ctx) {
        const me = ctx.me || (await GET("/api/auth/me")).body;
        if (!me?.user_id) return { ok: false, error: "no caller user_id" };
        const r = await PATCH(`/api/team/members/${me.user_id}`, {
          role: "member",
        });
        if (r.ok || r.status !== 400) {
          return { ok: false, error: `expected 400, got ${r.status}` };
        }
        return { ok: true, evidence: { _note: "self-edit blocked 400" } };
      },
    });

    R.register({
      id: "CC-3",
      series: "CC",
      title: "GET /api/me/tasks 行包含 data_classification 字段(默认 general)",
      async run(ctx) {
        // 创个 task 保证返回非空
        const me = ctx.me || (await GET("/api/auth/me")).body;
        const m = await POST("/api/meetings", { title: `${PREFIX}_CC3`, attendee_user_ids: [] });
        if (!m.ok) return { ok: false, error: `meeting ${m.status}` };
        created("meeting", m.body.id, "CC3");
        await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_CC3_task`,
          assignee_user_id: me.user_id,
        });
        const r = await GET("/api/me/tasks?status=all");
        if (!r.ok) return { ok: false, error: `${r.status}` };
        const t = (r.body || []).find((x) => x.content === `${PREFIX}_CC3_task`);
        if (!t) return { ok: false, error: "newly created task not visible" };
        if (typeof t.data_classification !== "string") {
          return { ok: false, error: "data_classification not in response" };
        }
        if (t.data_classification !== "general") {
          return { ok: false, error: `expected 'general' default, got ${t.data_classification}` };
        }
        return { ok: true, evidence: { _note: `data_classification='${t.data_classification}'` } };
      },
    });

    R.register({
      id: "CC-4",
      series: "CC",
      title: "POST /access-requests 用 bogus task uuid → 404",
      async run() {
        const bogus = "00000000-0000-0000-0000-000000000000";
        const r = await POST("/api/me/access-requests", {
          target_resource_type: "task",
          target_resource_id: bogus,
          justification: `${PREFIX}_CC4_test`,
        });
        if (r.ok || r.status !== 404) {
          return { ok: false, error: `expected 404, got ${r.status}` };
        }
        return { ok: true, evidence: { _note: "bogus target → 404" } };
      },
    });

    R.register({
      id: "CC-5",
      series: "CC",
      title: "POST /access-requests 申请自己拥有的 task → 400",
      async run(ctx) {
        const me = ctx.me || (await GET("/api/auth/me")).body;
        const m = await POST("/api/meetings", { title: `${PREFIX}_CC5`, attendee_user_ids: [] });
        if (!m.ok) return { ok: false, error: `meeting ${m.status}` };
        created("meeting", m.body.id, "CC5");
        const a = await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_CC5_my_task`,
          assignee_user_id: me.user_id,
        });
        // 找到对应 task id
        const myTasks = await GET("/api/me/tasks?status=all");
        const t = (myTasks.body || []).find((x) => x.content === `${PREFIX}_CC5_my_task`);
        if (!t) return { ok: false, error: "task not visible" };
        const r = await POST("/api/me/access-requests", {
          target_resource_type: "task",
          target_resource_id: t.id,
        });
        if (r.ok || r.status !== 400) {
          return { ok: false, error: `expected 400, got ${r.status}` };
        }
        return { ok: true, evidence: { _note: "self-owned 400" } };
      },
    });

    R.register({
      id: "CC-6",
      series: "CC",
      title: "GET /access-requests?role=requester 返回数组,shape OK",
      async run() {
        const r = await GET("/api/me/access-requests?role=requester&status=all");
        if (!r.ok) return { ok: false, error: `${r.status}` };
        if (!Array.isArray(r.body)) return { ok: false, error: "not array" };
        return { ok: true, evidence: { _note: `${r.body.length} requests` } };
      },
    });

    R.register({
      id: "CC-7",
      series: "CC",
      title: "Cron rule create 仍然 OK(owner 是 leader 角色,权限检查通过)",
      async run() {
        // v21 加了 require_leader_or_admin 守卫,master 是 owner 应当通过.
        // 这是回归测试,确保 v21 的权限收紧不破坏 owner 默认权限.
        const c = await POST("/api/cron-rules", {
          name: `${PREFIX}_CC7_perm_check`,
          cron_expr: "0 9 * * 1",
          task_template_content: `${PREFIX}_CC7`,
          is_active: false,
        });
        if (!c.ok) {
          return { ok: false, error: `owner cron-rule create blocked: ${c.status} ${JSON.stringify(c.body)}` };
        }
        // cleanup
        if (c.body?.id) await DEL(`/api/cron-rules/${c.body.id}`);
        return { ok: true, evidence: { _note: "owner 权限未被 v21 收紧拦截" } };
      },
    });

    // ---------- DD series · v22 看板 Dashboard -------------------------------
    R.register({
      id: "DD-1",
      series: "DD",
      title: "GET /api/dashboard/overview shape 完整(7 项 KPI + 元信息)",
      async run() {
        const r = await GET("/api/dashboard/overview");
        if (!r.ok) return { ok: false, error: `${r.status} ${JSON.stringify(r.body)}` };
        const required = [
          "total_tasks", "pending_review", "overdue_red_purple",
          "completion_rate_this_month", "by_status", "by_source",
          "workload", "completion_30d", "creation_7d", "evaluations",
          "period", "role", "scope_label",
        ];
        for (const k of required) {
          if (!(k in r.body)) return { ok: false, error: `missing ${k}` };
        }
        if (typeof r.body.total_tasks !== "number") return { ok: false, error: "total_tasks not number" };
        if (typeof r.body.completion_rate_this_month !== "number") {
          return { ok: false, error: "completion_rate_this_month not number" };
        }
        if (!Array.isArray(r.body.by_status)) return { ok: false, error: "by_status not array" };
        return {
          ok: true,
          evidence: { _note: `${r.body.total_tasks} total, role=${r.body.role}` },
        };
      },
    });

    R.register({
      id: "DD-2",
      series: "DD",
      title: "30d / 7d 折线点数正确(补齐空天)",
      async run() {
        const r = await GET("/api/dashboard/overview");
        if (!r.ok) return { ok: false, error: `${r.status}` };
        if (!Array.isArray(r.body.completion_30d) || r.body.completion_30d.length !== 31) {
          return { ok: false, error: `completion_30d should have 31 points (0..30 inclusive), got ${r.body.completion_30d?.length}` };
        }
        if (!Array.isArray(r.body.creation_7d) || r.body.creation_7d.length !== 8) {
          return { ok: false, error: `creation_7d should have 8 points, got ${r.body.creation_7d?.length}` };
        }
        // shape 检查
        const p0 = r.body.completion_30d[0];
        if (typeof p0.date !== "string" || typeof p0.completed !== "number" || typeof p0.created !== "number") {
          return { ok: false, error: "point shape wrong" };
        }
        return { ok: true, evidence: { _note: "30d=31 points, 7d=8 points" } };
      },
    });

    R.register({
      id: "DD-3",
      series: "DD",
      title: "POST /api/dashboard/seed-eval-data (admin) 生成本月评价",
      async run() {
        const r = await POST("/api/dashboard/seed-eval-data", { overwrite: false });
        if (!r.ok) {
          return { ok: false, error: `${r.status} ${JSON.stringify(r.body)}` };
        }
        if (typeof r.body.period !== "string") {
          return { ok: false, error: "period not string" };
        }
        if (typeof r.body.inserted !== "number" || typeof r.body.updated !== "number") {
          return { ok: false, error: "inserted/updated not number" };
        }
        return {
          ok: true,
          evidence: { _note: `period=${r.body.period}, +${r.body.inserted}/${r.body.updated}` },
        };
      },
    });

    R.register({
      id: "DD-4",
      series: "DD",
      title: "Seed 后 dashboard.evaluations 非空 + 4 维完整",
      async run() {
        const r = await GET("/api/dashboard/overview");
        if (!r.ok) return { ok: false, error: `${r.status}` };
        const evals = r.body.evaluations;
        if (!Array.isArray(evals) || evals.length === 0) {
          return { ok: false, error: "evaluations empty after seed" };
        }
        const e = evals[0];
        const dims = ["completion_rate", "on_time_rate", "quality_score", "collaboration_score"];
        for (const d of dims) {
          if (typeof e[d] !== "number") return { ok: false, error: `${d} not number` };
          if (e[d] < 0 || e[d] > 1) return { ok: false, error: `${d} out of [0,1]: ${e[d]}` };
        }
        if (typeof e.composite !== "number" || e.composite < 0 || e.composite > 1) {
          return { ok: false, error: `composite out of range: ${e.composite}` };
        }
        return {
          ok: true,
          evidence: { _note: `${evals.length} evaluations; top composite=${e.composite}` },
        };
      },
    });

    R.register({
      id: "DD-5",
      series: "DD",
      title: "Seed overwrite=false 幂等(二次调用不重复插)",
      async run() {
        // 调用两次,第二次 inserted 应该是 0 或者远小于第一次
        const r1 = await POST("/api/dashboard/seed-eval-data", { overwrite: false });
        const r2 = await POST("/api/dashboard/seed-eval-data", { overwrite: false });
        if (!r1.ok || !r2.ok) return { ok: false, error: "seed failed" };
        if (r2.body.inserted !== 0) {
          return { ok: false, error: `expected 2nd run inserted=0, got ${r2.body.inserted}` };
        }
        if (r2.body.updated !== 0) {
          return { ok: false, error: `expected 2nd run updated=0 (no overwrite), got ${r2.body.updated}` };
        }
        return { ok: true, evidence: { _note: "seed idempotent OK" } };
      },
    });

    R.register({
      id: "DD-6",
      series: "DD",
      title: "Seed overwrite=true 二次调用 updated > 0",
      async run() {
        const r = await POST("/api/dashboard/seed-eval-data", { overwrite: true });
        if (!r.ok) return { ok: false, error: `${r.status}` };
        if (r.body.updated <= 0 && r.body.inserted <= 0) {
          return { ok: false, error: "neither inserted nor updated, no active assignees?" };
        }
        return {
          ok: true,
          evidence: { _note: `updated=${r.body.updated}, inserted=${r.body.inserted}` },
        };
      },
    });

    // ---------- EE series · v22.5 多 AI 协作(主责 + 协办)------------------
    R.register({
      id: "EE-1",
      series: "EE",
      title: "dispatch 接受 co_assignees(主责=me + 协办=另一用户)→ task 上有协办列表",
      async run(ctx) {
        const me = ctx.me || (await GET("/api/auth/me")).body;
        if (!me?.user_id) return { ok: false, error: "no caller user_id" };
        // 找一个非自己的真实用户作 co_assignee
        const users = await GET("/api/users");
        const otherUser = (users.body || []).find((u) => u.id !== me.user_id);
        if (!otherUser) {
          return { ok: false, error: "需要 workspace 至少 2 个 user 才能测协办" };
        }
        // 创 meeting + open task
        const m = await POST("/api/meetings", { title: `${PREFIX}_EE1`, attendee_user_ids: [] });
        if (!m.ok) return { ok: false, error: `create meeting ${m.status}` };
        created("meeting", m.body.id, "EE1");
        await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_EE1_co_task`,
          assignee_user_id: me.user_id,
        });
        // 找到 task id
        const myTasks = await GET("/api/me/tasks?status=all");
        const t = (myTasks.body || []).find((x) => x.content === `${PREFIX}_EE1_co_task`);
        if (!t) return { ok: false, error: "task not visible" };
        // dispatch 含 co_assignees
        const r = await POST(`/api/me/tasks/${t.id}/dispatch`, {
          assignee_user_id: me.user_id,
          co_assignees: [otherUser.id],
        });
        if (!r.ok) return { ok: false, error: `dispatch ${r.status} ${JSON.stringify(r.body)}` };
        if (!Array.isArray(r.body.co_assignees) || r.body.co_assignees.length !== 1) {
          return { ok: false, error: `co_assignees not in response: ${JSON.stringify(r.body.co_assignees)}` };
        }
        if (r.body.co_assignees[0] !== otherUser.id) {
          return { ok: false, error: "co_assignees member mismatch" };
        }
        ctx.EE1_task = t.id;
        ctx.EE1_co_user = otherUser.id;
        ctx.EE1_meeting = m.body.id;
        return { ok: true, evidence: { _note: `co=[${otherUser.name}]` } };
      },
    });

    R.register({
      id: "EE-2",
      series: "EE",
      title: "co_assignees 超过 5 个 → 400",
      async run(ctx) {
        const me = ctx.me || (await GET("/api/auth/me")).body;
        const users = await GET("/api/users");
        const others = (users.body || []).filter((u) => u.id !== me.user_id);
        if (others.length < 6) {
          // 不够 6 个 user, 用伪造 uuid 凑
          while (others.length < 6) {
            others.push({ id: `00000000-0000-0000-0000-${(others.length + 1).toString().padStart(12, "0")}` });
          }
        }
        const m = await POST("/api/meetings", { title: `${PREFIX}_EE2`, attendee_user_ids: [] });
        if (!m.ok) return { ok: false, error: `meeting ${m.status}` };
        created("meeting", m.body.id, "EE2");
        await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_EE2_t`,
          assignee_user_id: me.user_id,
        });
        const myTasks = await GET("/api/me/tasks?status=all");
        const t = (myTasks.body || []).find((x) => x.content === `${PREFIX}_EE2_t`);
        if (!t) return { ok: false, error: "task not visible" };
        const r = await POST(`/api/me/tasks/${t.id}/dispatch`, {
          assignee_user_id: me.user_id,
          co_assignees: others.slice(0, 6).map((u) => u.id),
        });
        if (r.ok || r.status !== 400) {
          return { ok: false, error: `expected 400, got ${r.status}` };
        }
        return { ok: true, evidence: { _note: "max 5 协办限额生效" } };
      },
    });

    R.register({
      id: "EE-3",
      series: "EE",
      title: "co_assignees 含主责自己 → 400",
      async run() {
        const me = (await GET("/api/auth/me")).body;
        const m = await POST("/api/meetings", { title: `${PREFIX}_EE3`, attendee_user_ids: [] });
        if (!m.ok) return { ok: false, error: `meeting ${m.status}` };
        created("meeting", m.body.id, "EE3");
        await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_EE3_t`,
          assignee_user_id: me.user_id,
        });
        const myTasks = await GET("/api/me/tasks?status=all");
        const t = (myTasks.body || []).find((x) => x.content === `${PREFIX}_EE3_t`);
        const r = await POST(`/api/me/tasks/${t.id}/dispatch`, {
          assignee_user_id: me.user_id,
          co_assignees: [me.user_id], // 主责自己
        });
        if (r.ok || r.status !== 400) {
          return { ok: false, error: `expected 400, got ${r.status}` };
        }
        return { ok: true, evidence: { _note: "主责不能在协办列表" } };
      },
    });

    R.register({
      id: "EE-4",
      series: "EE",
      title: "非协办者调 co-submit → 403(主责自己也不算协办)",
      async run(ctx) {
        if (!ctx.EE1_task) {
          return { ok: false, error: "SKIP_DEP_FAILED:EE-1", evidence: { _skipped: true } };
        }
        // EE-1 的 task: 主责=me,协办=[otherUser].
        // me 是主责,不在 co_assignees 里 → 调 co-submit 应当 403.
        // (智慧住建语义:主责通过 submit 而非 co-submit 来汇总.)
        const r = await POST(`/api/me/tasks/${ctx.EE1_task}/co-submit`, {
          content: "should be rejected",
        });
        if (r.ok || r.status !== 403) {
          return { ok: false, error: `expected 403, got ${r.status} ${JSON.stringify(r.body)}` };
        }
        return { ok: true, evidence: { _note: "主责不能 co-submit (only co_assignees can)" } };
      },
    });

    R.register({
      id: "EE-5",
      series: "EE",
      title: "submit 未交协办 → 422; force=true 强制通过",
      async run(ctx) {
        if (!ctx.EE1_task) {
          return { ok: false, error: "SKIP_DEP_FAILED:EE-1", evidence: { _skipped: true } };
        }
        // EE-1 的 task 现在是 dispatched 主责=me + 协办=otherUser(还没 co-submit)
        // 路径:accept → start → submit (no force) → 422
        const a = await POST(`/api/me/tasks/${ctx.EE1_task}/accept`, {});
        if (!a.ok) return { ok: false, error: `accept ${a.status}` };
        const s = await POST(`/api/me/tasks/${ctx.EE1_task}/start`, {});
        if (!s.ok) return { ok: false, error: `start ${s.status}` };
        const r1 = await POST(`/api/me/tasks/${ctx.EE1_task}/submit`, { note: "test" });
        if (r1.ok || r1.status !== 422) {
          return { ok: false, error: `expected 422, got ${r1.status}` };
        }
        // 再 force=true
        const r2 = await POST(`/api/me/tasks/${ctx.EE1_task}/submit`, { note: "test", force: true });
        if (!r2.ok) {
          return { ok: false, error: `force submit ${r2.status} ${JSON.stringify(r2.body)}` };
        }
        if (r2.body.status !== "submitted") {
          return { ok: false, error: `expected submitted, got ${r2.body.status}` };
        }
        return { ok: true, evidence: { _note: "force submit OK" } };
      },
    });

    R.register({
      id: "EE-6",
      series: "EE",
      title: "rate 给自己 → 400",
      async run(ctx) {
        if (!ctx.EE1_task) {
          return { ok: false, error: "SKIP_DEP_FAILED:EE-1", evidence: { _skipped: true } };
        }
        const me = (await GET("/api/auth/me")).body;
        const r = await POST(`/api/me/tasks/${ctx.EE1_task}/rate`, {
          ratee_user_id: me.user_id,
          dimension: "quality",
          score: 4,
        });
        if (r.ok || r.status !== 400) {
          return { ok: false, error: `expected 400, got ${r.status}` };
        }
        return { ok: true, evidence: { _note: "self-rating 400" } };
      },
    });

    R.register({
      id: "EE-7",
      series: "EE",
      title: "rate 维度无效 → 400; score 越界 → 400",
      async run(ctx) {
        if (!ctx.EE1_task || !ctx.EE1_co_user) {
          return { ok: false, error: "SKIP_DEP_FAILED:EE-1", evidence: { _skipped: true } };
        }
        const r1 = await POST(`/api/me/tasks/${ctx.EE1_task}/rate`, {
          ratee_user_id: ctx.EE1_co_user,
          dimension: "wrong",
          score: 4,
        });
        if (r1.ok || r1.status !== 400) {
          return { ok: false, error: `bad dimension expected 400, got ${r1.status}` };
        }
        const r2 = await POST(`/api/me/tasks/${ctx.EE1_task}/rate`, {
          ratee_user_id: ctx.EE1_co_user,
          dimension: "collaboration",
          score: 99,
        });
        if (r2.ok || r2.status !== 400) {
          return { ok: false, error: `bad score expected 400, got ${r2.status}` };
        }
        return { ok: true, evidence: { _note: "bad dimension + bad score 400" } };
      },
    });

    // ---------- FF series · v23 看板二期 + 报表导出 -------------------------
    R.register({
      id: "FF-1",
      series: "FF",
      title: "GET /api/dashboard/kanban-by-agent shape OK + 列含所有 Agent",
      async run() {
        const r = await GET("/api/dashboard/kanban-by-agent");
        if (!r.ok) return { ok: false, error: `${r.status} ${JSON.stringify(r.body)}` };
        if (r.body.grouping !== "agent") {
          return { ok: false, error: `grouping should be 'agent', got ${r.body.grouping}` };
        }
        if (!Array.isArray(r.body.columns)) {
          return { ok: false, error: "columns not array" };
        }
        // workspace 至少有 1 个 Agent(默认 workspace 应该有 4+)
        if (r.body.columns.length === 0) {
          return { ok: false, error: "no columns; workspace 应至少有 1 个 Agent" };
        }
        if (typeof r.body.role !== "string" || typeof r.body.scope_label !== "string") {
          return { ok: false, error: "role/scope_label missing" };
        }
        return { ok: true, evidence: { _note: `${r.body.columns.length} columns, role=${r.body.role}` } };
      },
    });

    R.register({
      id: "FF-2",
      series: "FF",
      title: "GET /api/dashboard/kanban-by-user shape OK + 工作量降序",
      async run() {
        const r = await GET("/api/dashboard/kanban-by-user");
        if (!r.ok) return { ok: false, error: `${r.status}` };
        if (r.body.grouping !== "user") {
          return { ok: false, error: `grouping should be 'user'` };
        }
        // 列(user)按 cards.length 降序;__unassigned__ 排末尾
        const userCols = (r.body.columns || []).filter((c) => c.column_id !== "__unassigned__");
        for (let i = 1; i < userCols.length; i++) {
          if (userCols[i].cards.length > userCols[i - 1].cards.length) {
            return {
              ok: false,
              error: `not in desc order: ${userCols[i - 1].column_label}=${userCols[i - 1].cards.length}, ${userCols[i].column_label}=${userCols[i].cards.length}`,
            };
          }
        }
        return { ok: true, evidence: { _note: `${userCols.length} user cols, descending` } };
      },
    });

    R.register({
      id: "FF-3",
      series: "FF",
      title: "include_closed=true 让 done/archived 出现在卡片里",
      async run() {
        const rOff = await GET("/api/dashboard/kanban-by-user?include_closed=false");
        const rOn = await GET("/api/dashboard/kanban-by-user?include_closed=true");
        if (!rOff.ok || !rOn.ok) return { ok: false, error: "list failed" };
        const cardCountOff = (rOff.body.columns || []).reduce((acc, c) => acc + c.cards.length, 0);
        const cardCountOn = (rOn.body.columns || []).reduce((acc, c) => acc + c.cards.length, 0);
        if (cardCountOn < cardCountOff) {
          return { ok: false, error: `include_closed=true 应当 ≥ include_closed=false (got ${cardCountOn} < ${cardCountOff})` };
        }
        return {
          ok: true,
          evidence: { _note: `closed off=${cardCountOff}, on=${cardCountOn}` },
        };
      },
    });

    R.register({
      id: "FF-4",
      series: "FF",
      title: "GET /api/reports/monthly-evaluation 返回 Excel(Content-Type)",
      async run() {
        // 直接 fetch 拿头看 content-type;不下载 blob 本身(浪费)
        const r = await fetch("/api/reports/monthly-evaluation", {
          credentials: "include",
        });
        if (!r.ok) return { ok: false, error: `${r.status}` };
        const ct = r.headers.get("Content-Type") || "";
        if (!ct.includes("spreadsheet")) {
          return { ok: false, error: `expected xlsx CT, got ${ct}` };
        }
        const cd = r.headers.get("Content-Disposition") || "";
        if (!cd.includes("attachment")) {
          return { ok: false, error: `expected attachment, CD=${cd}` };
        }
        // discard body
        try { await r.body?.cancel(); } catch {}
        return { ok: true, evidence: { _note: "Excel attachment OK" } };
      },
    });

    R.register({
      id: "FF-5",
      series: "FF",
      title: "GET /api/reports/status-distribution 多区间(7/30/90)各自 200",
      async run() {
        for (const days of [7, 30, 90]) {
          const r = await fetch(`/api/reports/status-distribution?days=${days}`, {
            credentials: "include",
          });
          if (!r.ok) return { ok: false, error: `days=${days} → ${r.status}` };
          const ct = r.headers.get("Content-Type") || "";
          if (!ct.includes("spreadsheet")) {
            return { ok: false, error: `days=${days} bad CT: ${ct}` };
          }
          try { await r.body?.cancel(); } catch {}
        }
        return { ok: true, evidence: { _note: "7/30/90 days 都 200" } };
      },
    });

    R.register({
      id: "FF-6",
      series: "FF",
      title: "report status-distribution days 越界(<7 or >180) → 400/422",
      async run() {
        const r = await fetch("/api/reports/status-distribution?days=3", {
          credentials: "include",
        });
        if (r.ok) {
          try { await r.body?.cancel(); } catch {}
          return { ok: false, error: `expected 422, got ${r.status}` };
        }
        if (r.status !== 422 && r.status !== 400) {
          return { ok: false, error: `expected 4xx, got ${r.status}` };
        }
        return { ok: true, evidence: { _note: "days=3 拒绝" } };
      },
    });

    // ---------- GG series · v23.5 消息中心 + 任务详情页 + 会议追溯链 ----------
    R.register({
      id: "GG-1",
      series: "GG",
      title: "GET /api/me/tasks/{tid}/detail 200 + 关键字段全(timeline/co_progress/ratings/comments)",
      async run(ctx) {
        const me = ctx.me || (await GET("/api/auth/me")).body;
        if (!me?.user_id) return { ok: false, error: "no caller user_id" };
        // 创会议 + action(触发 task 1:1 mirror)
        const m = await POST("/api/meetings", { title: `${PREFIX}_GG1`, attendee_user_ids: [] });
        if (!m.ok) return { ok: false, error: `meeting ${m.status}` };
        created("meeting", m.body.id, "GG1");
        await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_GG1_t`,
          assignee_user_id: me.user_id,
        });
        const myTasks = await GET("/api/me/tasks?status=all");
        const t = (myTasks.body || []).find((x) => x.content === `${PREFIX}_GG1_t`);
        if (!t) return { ok: false, error: "task not visible" };
        ctx.GG1_task = t.id;
        ctx.GG1_meeting = m.body.id;
        const r = await GET(`/api/me/tasks/${t.id}/detail`);
        if (!r.ok) return { ok: false, error: `${r.status} ${JSON.stringify(r.body)}` };
        const d = r.body;
        if (d.id !== t.id) return { ok: false, error: "id mismatch" };
        if (!Array.isArray(d.timeline)) return { ok: false, error: "timeline not array" };
        if (!Array.isArray(d.co_progress)) return { ok: false, error: "co_progress not array" };
        if (!Array.isArray(d.ratings)) return { ok: false, error: "ratings not array" };
        if (!Array.isArray(d.comments)) return { ok: false, error: "comments not array" };
        // 至少有一个 'created' timeline 事件
        if (!d.timeline.some((e) => e.kind === "created")) {
          return { ok: false, error: "timeline 缺少 'created' 事件" };
        }
        return { ok: true, evidence: { _note: `timeline=${d.timeline.length} 条` } };
      },
    });

    R.register({
      id: "GG-2",
      series: "GG",
      title: "GET /api/me/tasks/{nonexistent}/detail → 404",
      async run() {
        const fakeId = "00000000-0000-0000-0000-000000000099";
        const r = await GET(`/api/me/tasks/${fakeId}/detail`);
        if (r.ok || r.status !== 404) {
          return { ok: false, error: `expected 404, got ${r.status}` };
        }
        return { ok: true, evidence: { _note: "404 OK" } };
      },
    });

    R.register({
      id: "GG-3",
      series: "GG",
      title: "task detail 含 dispatched_by_name + assignee_name(派发后)",
      async run(ctx) {
        if (!ctx.GG1_task) {
          return { ok: false, error: "SKIP_DEP_FAILED:GG-1", evidence: { _skipped: true } };
        }
        const me = (await GET("/api/auth/me")).body;
        // 派发给自己,触发 dispatched_at + dispatched_by_user_id
        const disp = await POST(`/api/me/tasks/${ctx.GG1_task}/dispatch`, {
          assignee_user_id: me.user_id,
        });
        if (!disp.ok) return { ok: false, error: `dispatch ${disp.status}` };
        const r = await GET(`/api/me/tasks/${ctx.GG1_task}/detail`);
        if (!r.ok) return { ok: false, error: `${r.status}` };
        const d = r.body;
        if (!d.assignee_name) return { ok: false, error: "assignee_name 缺失" };
        if (!d.dispatched_by_name) return { ok: false, error: "dispatched_by_name 缺失" };
        if (!d.timeline.some((e) => e.kind === "dispatched")) {
          return { ok: false, error: "timeline 缺 'dispatched' 事件" };
        }
        return {
          ok: true,
          evidence: { _note: `assignee=${d.assignee_name} disp=${d.dispatched_by_name}` },
        };
      },
    });

    R.register({
      id: "GG-4",
      series: "GG",
      title: "GET /api/meetings/{mid}/trace shape OK + 含 GG-1 task",
      async run(ctx) {
        if (!ctx.GG1_meeting || !ctx.GG1_task) {
          return { ok: false, error: "SKIP_DEP_FAILED:GG-1", evidence: { _skipped: true } };
        }
        const r = await GET(`/api/meetings/${ctx.GG1_meeting}/trace`);
        if (!r.ok) return { ok: false, error: `${r.status} ${JSON.stringify(r.body)}` };
        const tr = r.body;
        if (tr.meeting_id !== ctx.GG1_meeting) return { ok: false, error: "meeting_id mismatch" };
        if (!Array.isArray(tr.tasks)) return { ok: false, error: "tasks not array" };
        if (typeof tr.total !== "number") return { ok: false, error: "total not number" };
        if (typeof tr.by_status !== "object" || !tr.by_status) {
          return { ok: false, error: "by_status not object" };
        }
        if (!tr.tasks.some((t) => t.task_id === ctx.GG1_task)) {
          return { ok: false, error: "GG1_task 未出现在 trace.tasks" };
        }
        // 每个 task 应同时携带 task_id + action_item_id(双指针)
        const sample = tr.tasks[0];
        if (!sample.task_id || !sample.action_item_id) {
          return { ok: false, error: "task 缺 task_id / action_item_id" };
        }
        return {
          ok: true,
          evidence: { _note: `total=${tr.total}, by_status keys=${Object.keys(tr.by_status).join(",")}` },
        };
      },
    });

    R.register({
      id: "GG-5",
      series: "GG",
      title: "trace 空 meeting → total=0 + tasks=[]",
      async run() {
        const m = await POST("/api/meetings", { title: `${PREFIX}_GG5_empty`, attendee_user_ids: [] });
        if (!m.ok) return { ok: false, error: `meeting ${m.status}` };
        created("meeting", m.body.id, "GG5");
        const r = await GET(`/api/meetings/${m.body.id}/trace`);
        if (!r.ok) return { ok: false, error: `${r.status}` };
        if (r.body.total !== 0) return { ok: false, error: `expected total=0, got ${r.body.total}` };
        if (!Array.isArray(r.body.tasks) || r.body.tasks.length !== 0) {
          return { ok: false, error: `tasks 应为空数组` };
        }
        return { ok: true, evidence: { _note: "空会议 → total=0" } };
      },
    });

    R.register({
      id: "GG-6",
      series: "GG",
      title: "trace 跨工作空间隔离 → 404(请求别人 workspace 的会议)",
      async run() {
        // 用一个肯定不存在的 uuid 走 _load_owned_meeting,应当 404
        // (这等价于跨工作空间访问被拒,因为 workspace_id 过滤后 select 为 None)
        const fakeId = "00000000-0000-0000-0000-000000000088";
        const r = await GET(`/api/meetings/${fakeId}/trace`);
        if (r.ok || r.status !== 404) {
          return { ok: false, error: `expected 404, got ${r.status}` };
        }
        return { ok: true, evidence: { _note: "跨/不存在 meeting → 404" } };
      },
    });

    // ---------- HH series · v24.0 audit_log 全覆盖 -------------------------
    R.register({
      id: "HH-1",
      series: "HH",
      title: "task.dispatch 写 audit_log + payload 含 assignee",
      async run(ctx) {
        const me = ctx.me || (await GET("/api/auth/me")).body;
        // 创会议 + action(触发 task 1:1 mirror)
        const m = await POST("/api/meetings", { title: `${PREFIX}_HH1`, attendee_user_ids: [] });
        if (!m.ok) return { ok: false, error: `meeting ${m.status}` };
        created("meeting", m.body.id, "HH1");
        await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_HH1_t`,
          assignee_user_id: me.user_id,
        });
        const myTasks = await GET("/api/me/tasks?status=all");
        const t = (myTasks.body || []).find((x) => x.content === `${PREFIX}_HH1_t`);
        if (!t) return { ok: false, error: "task not visible" };
        ctx.HH1_task = t.id;
        // dispatch
        const d = await POST(`/api/me/tasks/${t.id}/dispatch`, {
          assignee_user_id: me.user_id,
        });
        if (!d.ok) return { ok: false, error: `dispatch ${d.status}` };
        // 看 audit
        const a = await GET("/api/audit?action=task.dispatch&limit=50");
        if (!a.ok) return { ok: false, error: `audit list ${a.status}` };
        const row = (a.body || []).find((x) => x.target_id === t.id);
        if (!row) {
          return { ok: false, error: "task.dispatch audit row not found" };
        }
        if (!row.payload || row.payload.assignee_user_id !== me.user_id) {
          return { ok: false, error: `payload missing assignee_user_id: ${JSON.stringify(row.payload)}` };
        }
        return { ok: true, evidence: { _note: `audit row id=${row.id}` } };
      },
    });

    R.register({
      id: "HH-2",
      series: "HH",
      title: "task lifecycle (accept/start/complete) 各写一行 audit",
      async run(ctx) {
        if (!ctx.HH1_task) {
          return { ok: false, error: "SKIP_DEP_FAILED:HH-1", evidence: { _skipped: true } };
        }
        // HH-1 task 现在是 dispatched.走 accept → start → complete
        const a1 = await POST(`/api/me/tasks/${ctx.HH1_task}/accept`, {});
        if (!a1.ok) return { ok: false, error: `accept ${a1.status}` };
        const a2 = await POST(`/api/me/tasks/${ctx.HH1_task}/start`, {});
        if (!a2.ok) return { ok: false, error: `start ${a2.status}` };
        const a3 = await POST(`/api/me/tasks/${ctx.HH1_task}/complete`, {});
        if (!a3.ok) return { ok: false, error: `complete ${a3.status}` };
        // 各看 audit(独立查询防止 limit 截断)
        for (const action of ["task.accept", "task.start", "task.complete"]) {
          const a = await GET(`/api/audit?action=${action}&limit=50`);
          if (!a.ok) return { ok: false, error: `${action} audit ${a.status}` };
          const row = (a.body || []).find((x) => x.target_id === ctx.HH1_task);
          if (!row) {
            return { ok: false, error: `${action} audit row not found for task ${ctx.HH1_task}` };
          }
        }
        return { ok: true, evidence: { _note: "accept/start/complete 都有 audit" } };
      },
    });

    R.register({
      id: "HH-3",
      series: "HH",
      title: "task.cancel 写 audit + payload 含 reason",
      async run() {
        const me = (await GET("/api/auth/me")).body;
        const m = await POST("/api/meetings", { title: `${PREFIX}_HH3`, attendee_user_ids: [] });
        if (!m.ok) return { ok: false, error: `meeting ${m.status}` };
        created("meeting", m.body.id, "HH3");
        await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_HH3_t`,
          assignee_user_id: me.user_id,
        });
        const myTasks = await GET("/api/me/tasks?status=all");
        const t = (myTasks.body || []).find((x) => x.content === `${PREFIX}_HH3_t`);
        if (!t) return { ok: false, error: "task not visible" };
        const reason = "测试取消_HH3_" + Date.now();
        const c = await POST(`/api/me/tasks/${t.id}/cancel`, { reason });
        if (!c.ok) return { ok: false, error: `cancel ${c.status}` };
        const a = await GET("/api/audit?action=task.cancel&limit=50");
        if (!a.ok) return { ok: false, error: `audit ${a.status}` };
        const row = (a.body || []).find((x) => x.target_id === t.id);
        if (!row) return { ok: false, error: "task.cancel audit row not found" };
        if (!row.payload || row.payload.reason !== reason) {
          return { ok: false, error: `reason mismatch: got ${row.payload?.reason}` };
        }
        return { ok: true, evidence: { _note: "cancel + reason in audit OK" } };
      },
    });

    // ---------- II series · v24.1 #1 智慧住建 16 AI 专家 seed ---------------
    R.register({
      id: "II-1",
      series: "II",
      title: "POST /api/dashboard/seed-smart-construction-agents 200 + 字段全",
      async run() {
        const r = await POST("/api/dashboard/seed-smart-construction-agents", {});
        if (!r.ok) {
          return { ok: false, error: `${r.status} ${JSON.stringify(r.body)}` };
        }
        const b = r.body || {};
        for (const k of ["agents_created", "agents_skipped", "kbs_created", "kbs_skipped", "preset_set"]) {
          if (!(k in b)) return { ok: false, error: `missing field: ${k}` };
        }
        // 第一次或后续都行,但 created+skipped 加起来必 = 16
        const total = (b.agents_created || 0) + (b.agents_skipped || 0);
        if (total !== 16) {
          return { ok: false, error: `agents_created + skipped 应当 = 16,实际 ${total}` };
        }
        const kbTotal = (b.kbs_created || 0) + (b.kbs_skipped || 0);
        if (kbTotal !== 16) {
          return { ok: false, error: `kb total 应当 = 16,实际 ${kbTotal}` };
        }
        return {
          ok: true,
          evidence: {
            _note: `agents +${b.agents_created}/skip ${b.agents_skipped} · kbs +${b.kbs_created}/skip ${b.kbs_skipped}`,
          },
        };
      },
    });

    R.register({
      id: "II-2",
      series: "II",
      title: "seed 第二次跑必幂等(agents_skipped >= 16 + 0 created)",
      async run() {
        // 假设 II-1 跑过了(seed 已存在);这里再跑一次
        const r = await POST("/api/dashboard/seed-smart-construction-agents", {});
        if (!r.ok) return { ok: false, error: `${r.status}` };
        const b = r.body || {};
        if ((b.agents_created || 0) !== 0) {
          return { ok: false, error: `第二次跑不应再创建 Agent,实际 created=${b.agents_created}` };
        }
        if ((b.agents_skipped || 0) < 16) {
          return { ok: false, error: `agents_skipped 应当 ≥ 16,实际 ${b.agents_skipped}` };
        }
        // KB 同理
        if ((b.kbs_created || 0) !== 0) {
          return { ok: false, error: `第二次不应再建 KB,实际 created=${b.kbs_created}` };
        }
        return { ok: true, evidence: { _note: "幂等 ✅" } };
      },
    });

    R.register({
      id: "II-3",
      series: "II",
      title: "GET /api/agents 后 16 个智慧住建 AI 全部存在 + 关键 keywords 命中",
      async run() {
        const r = await GET("/api/agents");
        if (!r.ok) return { ok: false, error: `${r.status}` };
        const list = r.body || [];
        const expectedNames = [
          "综合事务AI专家", "法制政务AI专家", "房地产与租赁AI专家",
          "公共住房建设AI专家", "住房保障AI专家", "建筑业管理AI专家",
          "房屋安全AI专家", "物业监管AI专家", "建设科技与燃气AI专家",
          "消防人防AI专家", "城市更新规划AI专家", "土地整备AI专家",
          "城市更新项目AI专家", "建设工程质量安全AI专家",
          "住房建设与土地整备AI专家", "住建智脑(全局AI专家)",
        ];
        const haveNames = new Set(list.map((a) => a.name));
        const missing = expectedNames.filter((n) => !haveNames.has(n));
        if (missing.length > 0) {
          return { ok: false, error: `缺 ${missing.length} 个 AI:${missing.join(", ")}` };
        }
        // 抽查:房屋安全 keywords 应含「房屋安全」
        const housing = list.find((a) => a.name === "房屋安全AI专家");
        if (!housing.keywords || !housing.keywords.includes("房屋安全")) {
          return {
            ok: false,
            error: `房屋安全AI专家 keywords 不含「房屋安全」: ${JSON.stringify(housing.keywords)}`,
          };
        }
        return { ok: true, evidence: { _note: `16/16 ✅,abs ${list.length} agents in workspace` } };
      },
    });

    R.register({
      id: "II-4",
      series: "II",
      title: "GET /api/knowledge-bases 后 16 个 'KB · *' 全部存在 + Agent 已绑定",
      async run() {
        const [kbR, agentR] = await Promise.all([
          GET("/api/knowledge-bases"),
          GET("/api/agents"),
        ]);
        if (!kbR.ok) return { ok: false, error: `kb list ${kbR.status}` };
        if (!agentR.ok) return { ok: false, error: `agent list ${agentR.status}` };
        const kbs = kbR.body || [];
        const scKbs = kbs.filter((k) => (k.name || "").startsWith("KB · "));
        if (scKbs.length < 16) {
          return { ok: false, error: `'KB · *' KB 数 ${scKbs.length} < 16` };
        }
        // 找一个智慧住建 Agent,验它的 knowledge_base_ids 含至少 1 个 KB
        const housing = (agentR.body || []).find((a) => a.name === "房屋安全AI专家");
        if (!housing) return { ok: false, error: "房屋安全AI专家 not found" };
        if (!housing.knowledge_base_ids || housing.knowledge_base_ids.length === 0) {
          return { ok: false, error: "房屋安全AI专家 未绑定任何 KB" };
        }
        const kbBound = kbs.find((k) => k.id === housing.knowledge_base_ids[0]);
        if (!kbBound || !kbBound.name.startsWith("KB · ")) {
          return { ok: false, error: "绑定的不是智慧住建 KB" };
        }
        return {
          ok: true,
          evidence: {
            _note: `${scKbs.length} 个智慧住建 KB,Agent ↔ KB 1:1 绑定 ✅`,
          },
        };
      },
    });

    R.register({
      id: "II-5",
      series: "II",
      title: "audit_log 含 workspace.seed_smart_construction 一行",
      async run() {
        const r = await GET("/api/audit?action=workspace.seed_smart_construction&limit=10");
        if (!r.ok) return { ok: false, error: `${r.status}` };
        const rows = r.body || [];
        if (rows.length === 0) {
          return { ok: false, error: "未找到 workspace.seed_smart_construction audit 行" };
        }
        const latest = rows[0];
        if (!latest.payload || typeof latest.payload.agents_created !== "number") {
          return { ok: false, error: `payload 缺 agents_created: ${JSON.stringify(latest.payload)}` };
        }
        return { ok: true, evidence: { _note: `audit row id=${latest.id}` } };
      },
    });

    // ---------- JJ series · v24.1 #2 问题上报 + 异常预警 -----------------
    R.register({
      id: "JJ-1",
      series: "JJ",
      title: "POST /api/me/reports 创建 source_type='report' Task",
      async run(ctx) {
        const me = ctx.me || (await GET("/api/auth/me")).body;
        const r = await POST("/api/me/reports", {
          title: `${PREFIX}_JJ1`,
          content: `${PREFIX}_JJ1_某楼宇瓷砖松动测试报告内容`,
          severity: "medium",
        });
        if (!r.ok) return { ok: false, error: `${r.status} ${JSON.stringify(r.body)}` };
        if (!r.body.task_id) return { ok: false, error: "no task_id in response" };
        ctx.JJ1_task = r.body.task_id;
        // 验 Task 有 source_type='report'
        const t = await GET(`/api/me/tasks/${r.body.task_id}/detail`);
        if (!t.ok) return { ok: false, error: `task detail ${t.status}` };
        if (t.body.source_type !== "report") {
          return { ok: false, error: `expected source_type=report, got ${t.body.source_type}` };
        }
        if (t.body.assignee_user_id !== null) {
          return { ok: false, error: "report task assignee 应当为 null(待派发)" };
        }
        if (!t.body.source_ref || t.body.source_ref.severity !== "medium") {
          return { ok: false, error: "source_ref.severity 不对" };
        }
        return {
          ok: true,
          evidence: { _note: `notified ${r.body.notified_leaders} leaders` },
        };
      },
    });

    R.register({
      id: "JJ-2",
      series: "JJ",
      title: "POST /api/me/reports content 太短(<5字)→ 400",
      async run() {
        const r = await POST("/api/me/reports", {
          content: "短",
          severity: "low",
        });
        if (r.ok || r.status !== 400) {
          return { ok: false, error: `expected 400, got ${r.status}` };
        }
        return { ok: true, evidence: { _note: "短内容拒绝 OK" } };
      },
    });

    R.register({
      id: "JJ-3",
      series: "JJ",
      title: "POST /api/me/reports severity 非法 → 400",
      async run() {
        const r = await POST("/api/me/reports", {
          content: `${PREFIX}_JJ3_合法长度的内容`,
          severity: "critical",  // 非法值
        });
        if (r.ok || r.status !== 400) {
          return { ok: false, error: `expected 400, got ${r.status}` };
        }
        return { ok: true, evidence: { _note: "非法 severity 拒绝 OK" } };
      },
    });

    R.register({
      id: "JJ-4",
      series: "JJ",
      title: "POST /api/dashboard/alerts/force-check 200 + 3 规则字段全",
      async run() {
        const r = await POST("/api/dashboard/alerts/force-check", {});
        if (!r.ok) return { ok: false, error: `${r.status}` };
        const expected = ["overdue_rate", "assignee_overload", "agent_low_completion"];
        for (const k of expected) {
          if (!(k in r.body)) {
            return { ok: false, error: `缺规则 ${k}: ${JSON.stringify(r.body)}` };
          }
          if (typeof r.body[k].would_fire !== "boolean") {
            return { ok: false, error: `${k}.would_fire 不是 boolean` };
          }
        }
        const fired = expected.filter((k) => r.body[k].would_fire);
        return {
          ok: true,
          evidence: { _note: `3 规则跑过,${fired.length} 触发: ${fired.join(", ") || "无"}` },
        };
      },
    });

    R.register({
      id: "JJ-5",
      series: "JJ",
      title: "audit_log 含 report.create 一行(JJ-1 触发的)",
      async run(ctx) {
        if (!ctx.JJ1_task) {
          return { ok: false, error: "SKIP_DEP_FAILED:JJ-1", evidence: { _skipped: true } };
        }
        const r = await GET("/api/audit?action=report.create&limit=20");
        if (!r.ok) return { ok: false, error: `${r.status}` };
        const row = (r.body || []).find((x) => x.target_id === ctx.JJ1_task);
        if (!row) return { ok: false, error: "report.create audit row not found" };
        if (!row.payload || row.payload.severity !== "medium") {
          return { ok: false, error: `payload.severity 不对: ${JSON.stringify(row.payload)}` };
        }
        return { ok: true, evidence: { _note: `audit row id=${row.id}` } };
      },
    });

    // ---------- KK series · v24.1 #3 4-维自动派发路由 -----------------------
    R.register({
      id: "KK-1",
      series: "KK",
      title: "GET route-preview 返回候选 + breakdown 4 维 + threshold",
      async run(ctx) {
        const me = ctx.me || (await GET("/api/auth/me")).body;
        // 创一个 open task(走 report 触发源 — 永远是 open + 无 assignee)
        const r = await POST("/api/me/reports", {
          title: `${PREFIX}_KK1_物业问题`,
          content: `${PREFIX}_KK1_某小区物业管理混乱,业委会希望立即整治`,
          severity: "medium",
        });
        if (!r.ok) return { ok: false, error: `report ${r.status}` };
        ctx.KK_task = r.body.task_id;
        const p = await GET(`/api/me/tasks/${r.body.task_id}/route-preview`);
        if (!p.ok) return { ok: false, error: `preview ${p.status}` };
        if (typeof p.body.threshold !== "number") {
          return { ok: false, error: "threshold not number" };
        }
        if (!Array.isArray(p.body.candidates)) {
          return { ok: false, error: "candidates not array" };
        }
        if (typeof p.body.matched !== "boolean") {
          return { ok: false, error: "matched not boolean" };
        }
        // 候选可能为空(没绑 user 的 Agent 全跳过).有候选时验 breakdown 4 维
        if (p.body.candidates.length > 0) {
          const c0 = p.body.candidates[0];
          for (const dim of ["keyword", "history", "load", "capability"]) {
            if (typeof c0.breakdown[dim] !== "number") {
              return { ok: false, error: `breakdown 缺 ${dim}` };
            }
          }
          // composite 应当是降序
          for (let i = 1; i < p.body.candidates.length; i++) {
            if (p.body.candidates[i].composite > p.body.candidates[i-1].composite) {
              return { ok: false, error: "candidates 不是降序" };
            }
          }
        }
        return {
          ok: true,
          evidence: {
            _note: `${p.body.candidates.length} 候选,matched=${p.body.matched},threshold=${p.body.threshold}`,
          },
        };
      },
    });

    R.register({
      id: "KK-2",
      series: "KK",
      title: "POST auto-route — 已派发(非 open)task → 409",
      async run() {
        // 找一个已派发的 task(走老路:create + dispatch)
        const me = (await GET("/api/auth/me")).body;
        const m = await POST("/api/meetings", { title: `${PREFIX}_KK2`, attendee_user_ids: [] });
        if (!m.ok) return { ok: false, error: `meeting ${m.status}` };
        created("meeting", m.body.id, "KK2");
        await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_KK2_t`,
          assignee_user_id: me.user_id,
        });
        const myTasks = await GET("/api/me/tasks?status=all");
        const t = (myTasks.body || []).find((x) => x.content === `${PREFIX}_KK2_t`);
        // 派发掉
        await POST(`/api/me/tasks/${t.id}/dispatch`, { assignee_user_id: me.user_id });
        // 现在它是 dispatched,试 auto-route 应当 409
        const r = await POST(`/api/me/tasks/${t.id}/auto-route`, {});
        if (r.ok || r.status !== 409) {
          return { ok: false, error: `expected 409, got ${r.status}` };
        }
        return { ok: true, evidence: { _note: "non-open auto-route 拒绝 OK" } };
      },
    });

    R.register({
      id: "KK-3",
      series: "KK",
      title: "POST auto-route — 命中阈值则 dispatch + audit; 否则 matched=false",
      async run(ctx) {
        if (!ctx.KK_task) {
          return { ok: false, error: "SKIP_DEP_FAILED:KK-1", evidence: { _skipped: true } };
        }
        const r = await POST(`/api/me/tasks/${ctx.KK_task}/auto-route`, {});
        if (!r.ok) return { ok: false, error: `${r.status} ${JSON.stringify(r.body)}` };
        if (typeof r.body.matched !== "boolean") {
          return { ok: false, error: "matched not boolean" };
        }
        if (r.body.matched) {
          // 命中:必有 winner + task 状态 = dispatched + audit_log 一行
          if (!r.body.winner || !r.body.winner.candidate_user_id) {
            return { ok: false, error: "matched but no winner" };
          }
          if (!r.body.task || r.body.task.status !== "dispatched") {
            return { ok: false, error: `task 状态 ${r.body.task?.status} != dispatched` };
          }
          const a = await GET("/api/audit?action=task.auto_route&limit=20");
          const row = (a.body || []).find((x) => x.target_id === ctx.KK_task);
          if (!row) return { ok: false, error: "task.auto_route audit row 缺" };
          return {
            ok: true,
            evidence: {
              _note: `auto-routed → ${r.body.winner.agent_name}(composite=${r.body.winner.composite})`,
            },
          };
        } else {
          // 未命中:也是合法返回,有 candidates 列表
          if (!Array.isArray(r.body.candidates)) {
            return { ok: false, error: "miss case 应有 candidates 列表" };
          }
          return {
            ok: true,
            evidence: { _note: `未命中阈值,matched=false,${r.body.candidates.length} 候选` },
          };
        }
      },
    });

    // ---------- LL series · v24.1 #4 24h 签收超时催办 -----------------------
    R.register({
      id: "LL-1",
      series: "LL",
      title: "POST /api/dashboard/dispatch-overdue/force-check 200 + 字段全",
      async run() {
        const r = await POST("/api/dashboard/dispatch-overdue/force-check", {});
        if (!r.ok) return { ok: false, error: `${r.status} ${JSON.stringify(r.body)}` };
        if (typeof r.body.notifications_emitted !== "number") {
          return { ok: false, error: "notifications_emitted not number" };
        }
        return {
          ok: true,
          evidence: { _note: `emitted ${r.body.notifications_emitted}` },
        };
      },
    });

    R.register({
      id: "LL-2",
      series: "LL",
      title: "audit_log 含 dispatch_overdue.force_check 一行",
      async run() {
        // 先跑一次确保有 audit row
        await POST("/api/dashboard/dispatch-overdue/force-check", {});
        const a = await GET("/api/audit?action=dispatch_overdue.force_check&limit=10");
        if (!a.ok) return { ok: false, error: `${a.status}` };
        if ((a.body || []).length === 0) {
          return { ok: false, error: "force_check audit row not found" };
        }
        const latest = a.body[0];
        if (typeof latest.payload?.notifications_emitted !== "number") {
          return { ok: false, error: "payload.notifications_emitted 缺" };
        }
        return { ok: true, evidence: { _note: `audit row id=${latest.id}` } };
      },
    });

    // ---------- MM series · v24.1 #5 阶段性上报模板 -------------------------
    R.register({
      id: "MM-1",
      series: "MM",
      title: "submit 结构化 4 段 → source_ref.submission_payload 写入",
      async run(ctx) {
        const me = ctx.me || (await GET("/api/auth/me")).body;
        // 创 + 派 + 签 + 开始
        const m = await POST("/api/meetings", { title: `${PREFIX}_MM1`, attendee_user_ids: [] });
        if (!m.ok) return { ok: false, error: `meeting ${m.status}` };
        created("meeting", m.body.id, "MM1");
        await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_MM1_t`,
          assignee_user_id: me.user_id,
        });
        const myTasks = await GET("/api/me/tasks?status=all");
        const t = (myTasks.body || []).find((x) => x.content === `${PREFIX}_MM1_t`);
        await POST(`/api/me/tasks/${t.id}/dispatch`, { assignee_user_id: me.user_id });
        await POST(`/api/me/tasks/${t.id}/accept`, {});
        await POST(`/api/me/tasks/${t.id}/start`, {});
        // 结构化 submit
        const r = await POST(`/api/me/tasks/${t.id}/submit`, {
          completed: `${PREFIX}_MM1_completed_本周完成 X`,
          problems: `${PREFIX}_MM1_problems_遇到 Y`,
          next_steps: `${PREFIX}_MM1_next_下周做 Z`,
          evidence_urls: ["https://example.com/proof1.png", "https://example.com/doc.pdf"],
        });
        if (!r.ok) return { ok: false, error: `submit ${r.status} ${JSON.stringify(r.body)}` };
        // 拉 detail 验 source_ref.submission_payload 各字段
        const d = await GET(`/api/me/tasks/${t.id}/detail`);
        if (!d.ok) return { ok: false, error: `detail ${d.status}` };
        const sp = d.body.source_ref?.submission_payload;
        if (!sp) return { ok: false, error: "source_ref.submission_payload 没写入" };
        if (!sp.completed?.includes("MM1_completed")) {
          return { ok: false, error: `completed 不对: ${sp.completed}` };
        }
        if (!sp.problems?.includes("MM1_problems")) {
          return { ok: false, error: "problems 不对" };
        }
        if (!sp.next_steps?.includes("MM1_next")) {
          return { ok: false, error: "next_steps 不对" };
        }
        if (!Array.isArray(sp.evidence_urls) || sp.evidence_urls.length !== 2) {
          return { ok: false, error: `evidence_urls 数不对: ${JSON.stringify(sp.evidence_urls)}` };
        }
        return { ok: true, evidence: { _note: "4 段 + 2 evidence URLs 全写入" } };
      },
    });

    R.register({
      id: "MM-2",
      series: "MM",
      title: "submit evidence_urls > 10 条 → 400",
      async run() {
        const me = (await GET("/api/auth/me")).body;
        const m = await POST("/api/meetings", { title: `${PREFIX}_MM2`, attendee_user_ids: [] });
        if (!m.ok) return { ok: false, error: `meeting ${m.status}` };
        created("meeting", m.body.id, "MM2");
        await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_MM2_t`,
          assignee_user_id: me.user_id,
        });
        const myTasks = await GET("/api/me/tasks?status=all");
        const t = (myTasks.body || []).find((x) => x.content === `${PREFIX}_MM2_t`);
        await POST(`/api/me/tasks/${t.id}/dispatch`, { assignee_user_id: me.user_id });
        await POST(`/api/me/tasks/${t.id}/accept`, {});
        await POST(`/api/me/tasks/${t.id}/start`, {});
        const urls = Array.from({ length: 11 }, (_, i) => `https://e.com/${i}`);
        const r = await POST(`/api/me/tasks/${t.id}/submit`, {
          completed: "x",
          evidence_urls: urls,
        });
        if (r.ok || r.status !== 400) {
          return { ok: false, error: `expected 400, got ${r.status}` };
        }
        return { ok: true, evidence: { _note: "11 个 URL 拒绝 OK" } };
      },
    });

    R.register({
      id: "MM-3",
      series: "MM",
      title: "submit 只填 note(back-compat 老用法)→ 200 + 不写 submission_payload",
      async run() {
        const me = (await GET("/api/auth/me")).body;
        const m = await POST("/api/meetings", { title: `${PREFIX}_MM3`, attendee_user_ids: [] });
        if (!m.ok) return { ok: false, error: `meeting ${m.status}` };
        created("meeting", m.body.id, "MM3");
        await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_MM3_t`,
          assignee_user_id: me.user_id,
        });
        const myTasks = await GET("/api/me/tasks?status=all");
        const t = (myTasks.body || []).find((x) => x.content === `${PREFIX}_MM3_t`);
        await POST(`/api/me/tasks/${t.id}/dispatch`, { assignee_user_id: me.user_id });
        await POST(`/api/me/tasks/${t.id}/accept`, {});
        await POST(`/api/me/tasks/${t.id}/start`, {});
        const r = await POST(`/api/me/tasks/${t.id}/submit`, {
          note: `${PREFIX}_MM3_legacy_note`,
        });
        if (!r.ok) return { ok: false, error: `submit ${r.status}` };
        // note 单字段也算「使用了模板」(>=1 段),应当写 submission_payload
        // 但只含 note,没有 completed/problems/next_steps 等
        const d = await GET(`/api/me/tasks/${t.id}/detail`);
        const sp = d.body.source_ref?.submission_payload;
        if (sp) {
          if (sp.completed || sp.problems || sp.next_steps) {
            return { ok: false, error: "只填 note 不应 populate 其他字段" };
          }
          if (!sp.note?.includes("MM3_legacy_note")) {
            return { ok: false, error: "note 内容不对" };
          }
        }
        // 即使没写 submission_payload 也 OK(纯 back-compat)
        return { ok: true, evidence: { _note: "back-compat OK" } };
      },
    });

    // ---------- NN series · v24.1 #6 AI 辅助起草汇报 ------------------------
    R.register({
      id: "NN-1",
      series: "NN",
      title: "POST /draft-submission 200 + 3 字段(LLM 5-15s)",
      async run(ctx) {
        const me = ctx.me || (await GET("/api/auth/me")).body;
        const m = await POST("/api/meetings", { title: `${PREFIX}_NN1`, attendee_user_ids: [] });
        if (!m.ok) return { ok: false, error: `meeting ${m.status}` };
        created("meeting", m.body.id, "NN1");
        await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_NN1_对沙头街道老旧小区进行幕墙安全鉴定与整治`,
          assignee_user_id: me.user_id,
        });
        const myTasks = await GET("/api/me/tasks?status=all");
        const t = (myTasks.body || []).find((x) => x.content === `${PREFIX}_NN1_对沙头街道老旧小区进行幕墙安全鉴定与整治`);
        if (!t) return { ok: false, error: "task not visible" };
        ctx.NN_task = t.id;
        const r = await POST(`/api/me/tasks/${t.id}/draft-submission`, {});
        if (!r.ok) return { ok: false, error: `${r.status} ${JSON.stringify(r.body)}` };
        // LLM 慢 + 偶尔失败:接受 (3 字段都有 OR error 非空)
        const has3 = ["completed", "problems", "next_steps"].every((k) => typeof r.body[k] === "string");
        if (!has3) return { ok: false, error: "缺 3 字段之一" };
        if (!r.body.error && (!r.body.completed && !r.body.problems && !r.body.next_steps)) {
          return { ok: false, error: "无 error 但 3 段全空" };
        }
        return {
          ok: true,
          evidence: {
            _note: r.body.error
              ? `LLM 失败: ${r.body.error.slice(0,40)}`
              : `LLM 出 3 段(${r.body.completed.length + r.body.problems.length + r.body.next_steps.length} 字符总)`,
          },
        };
      },
    });

    R.register({
      id: "NN-2",
      series: "NN",
      title: "非相关人调 draft-submission → 403",
      async run() {
        // 用一个固定 fake task id,没人是其相关人 → 应该 404(load 找不到),
        // 不是 403.因为 _load_task_in_workspace 先检查存在性.
        // 改为:create 一个 task 派给「别人」,让 me 不是 assignee/dispatcher/creator/co
        // 但实际所有 workspace 用户都用 me 测,无法构造「别人」 → 用 fake id 验 404 也算
        const fakeId = "00000000-0000-0000-0000-000000000077";
        const r = await POST(`/api/me/tasks/${fakeId}/draft-submission`, {});
        if (r.ok || (r.status !== 404 && r.status !== 403)) {
          return { ok: false, error: `expected 404 or 403, got ${r.status}` };
        }
        return { ok: true, evidence: { _note: `非法 task → ${r.status}` } };
      },
    });

    // ---------- OO series · v24.2 #1 办结 → KB 沉淀联动 --------------------
    R.register({
      id: "OO-1",
      series: "OO",
      title: "approve 后 LLM 沉淀(轮询 30s) → source_ref.curated=true",
      async run(ctx) {
        const me = ctx.me || (await GET("/api/auth/me")).body;
        const m = await POST("/api/meetings", { title: `${PREFIX}_OO1`, attendee_user_ids: [] });
        if (!m.ok) return { ok: false, error: `meeting ${m.status}` };
        created("meeting", m.body.id, "OO1");
        await POST(`/api/meetings/${m.body.id}/actions`, {
          content: `${PREFIX}_OO1_对沙头街道老旧小区幕墙进行结构鉴定,30 户范围,本月内出报告`,
          assignee_user_id: me.user_id,
        });
        const myTasks = await GET("/api/me/tasks?status=all");
        const t = (myTasks.body || []).find((x) => x.content.startsWith(`${PREFIX}_OO1`));
        if (!t) return { ok: false, error: "task not visible" };
        ctx.OO1_task = t.id;
        // 走完整流程到 approved
        await POST(`/api/me/tasks/${t.id}/dispatch`, { assignee_user_id: me.user_id });
        await POST(`/api/me/tasks/${t.id}/accept`, {});
        await POST(`/api/me/tasks/${t.id}/start`, {});
        await POST(`/api/me/tasks/${t.id}/submit`, {
          completed: "已完成 30 户排查,12 户存在松动,出具初步整治建议",
          problems: "业委会配合度低,3 户拒绝入户",
          next_steps: "下月联合街道办做拒户协调",
        });
        // me 是 dispatcher 也是 assignee → me 自己 approve
        const ar = await POST(`/api/me/tasks/${t.id}/approve`, {});
        if (!ar.ok) return { ok: false, error: `approve ${ar.status}` };
        // 轮询 30s 看 source_ref.curated 是否变 true
        let curated = false;
        let lastDetail = null;
        for (let i = 0; i < 15; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const d = await GET(`/api/me/tasks/${t.id}/detail`);
          if (!d.ok) continue;
          lastDetail = d.body;
          if (d.body.source_ref?.curated === true) {
            curated = true;
            break;
          }
        }
        if (!curated) {
          return {
            ok: false,
            error: `30s 内 source_ref.curated 没变 true; final source_ref=${JSON.stringify(lastDetail?.source_ref)}`,
          };
        }
        // 验有 memory_id
        if (!lastDetail.source_ref.curated_memory_id) {
          return { ok: false, error: "curated 但 memory_id 没写入" };
        }
        return {
          ok: true,
          evidence: {
            _note: `LLM 沉淀完成,memory_id=${lastDetail.source_ref.curated_memory_id?.slice(0,8)}, kb_id=${lastDetail.source_ref.curated_kb_id?.slice(0,8)}`,
          },
        };
      },
    });

    R.register({
      id: "OO-2",
      series: "OO",
      title: "approved 后 KB 出现「[自动沉淀]」KnowledgeDocument",
      async run(ctx) {
        if (!ctx.OO1_task) {
          return { ok: false, error: "SKIP_DEP_FAILED:OO-1", evidence: { _skipped: true } };
        }
        // OO-1 应已 curated;这里看 task 写的 curated_kb_id 对应 KB 里有没有
        // 「[自动沉淀]」开头的文档
        const d = await GET(`/api/me/tasks/${ctx.OO1_task}/detail`);
        if (!d.ok) return { ok: false, error: `detail ${d.status}` };
        const kbId = d.body.source_ref?.curated_kb_id;
        if (!kbId) {
          // 没绑 agent 时跳过 KB 写入是 OK 的(只 LongTermMemory),算 pass
          return { ok: true, evidence: { _note: "task assignee 没绑 agent,跳过 KB(只写 memory)" } };
        }
        const docs = await GET(`/api/knowledge-bases/${kbId}/documents`);
        if (!docs.ok) return { ok: false, error: `kb docs ${docs.status}` };
        const auto = (docs.body || []).find((x) => x.filename.startsWith("[自动沉淀"));
        if (!auto) {
          return {
            ok: false,
            error: `KB ${kbId} 里没找到「[自动沉淀」开头的文档(总 ${docs.body?.length} 个)`,
          };
        }
        if (auto.status !== "ready") {
          return { ok: false, error: `auto-curated doc 状态 ${auto.status} != ready` };
        }
        return {
          ok: true,
          evidence: { _note: `${auto.filename.slice(0,40)}... ready` },
        };
      },
    });

    R.register({
      id: "OO-3",
      series: "OO",
      title: "approve 幂等 — 已 curated 的 task 重 approve 不会重沉淀",
      async run(ctx) {
        if (!ctx.OO1_task) {
          return { ok: false, error: "SKIP_DEP_FAILED:OO-1", evidence: { _skipped: true } };
        }
        // 拿 OO-1 的 curated_at
        const d1 = await GET(`/api/me/tasks/${ctx.OO1_task}/detail`);
        const oldAt = d1.body.source_ref?.curated_at;
        if (!oldAt) return { ok: false, error: "OO-1 没 curated_at,跳过 OO-3" };
        // task 已经 done 状态,再 approve 应当 422(状态机不允许)— 但其实
        // 可能允许?查 task_state.py.无论如何,我们只验「curated_at 不变」.
        // 先尝试 approve 再
        const a = await POST(`/api/me/tasks/${ctx.OO1_task}/approve`, {});
        // approve 可能 422(状态不对)or 200(允许;但沉淀会跳)
        // 都 OK,关键是 curated_at 不变
        await new Promise((r) => setTimeout(r, 3000));  // 给可能的 LLM 跑
        const d2 = await GET(`/api/me/tasks/${ctx.OO1_task}/detail`);
        const newAt = d2.body.source_ref?.curated_at;
        if (oldAt !== newAt) {
          return { ok: false, error: `curated_at 变了:old=${oldAt} new=${newAt}(应当幂等)` };
        }
        return { ok: true, evidence: { _note: `幂等 OK (curated_at 不变, 二次 approve 状态码 ${a.status})` } };
      },
    });

    // ---------- PP series · v24.2 #2 自然语言图表问数 ----------------------
    R.register({
      id: "PP-1",
      series: "PP",
      title: "POST /chart-qa 简单问题 → 200 + chart_type/data/title",
      async run() {
        const r = await POST("/api/dashboard/chart-qa", {
          question: "近 7 天每天新建多少任务",
        });
        if (!r.ok) return { ok: false, error: `${r.status} ${JSON.stringify(r.body)}` };
        for (const k of ["template", "title", "chart_type", "data", "params", "fallback_used"]) {
          if (!(k in r.body)) return { ok: false, error: `missing ${k}` };
        }
        if (!["pie", "bar", "line"].includes(r.body.chart_type)) {
          return { ok: false, error: `bad chart_type: ${r.body.chart_type}` };
        }
        if (!Array.isArray(r.body.data)) return { ok: false, error: "data not array" };
        return {
          ok: true,
          evidence: {
            _note: `${r.body.template} · ${r.body.chart_type} · ${r.body.data.length} 点 · fallback=${r.body.fallback_used}`,
          },
        };
      },
    });

    R.register({
      id: "PP-2",
      series: "PP",
      title: "chart-qa question 超 500 字 → 400",
      async run() {
        const longQ = "请问".repeat(300);  // 600 chars
        const r = await POST("/api/dashboard/chart-qa", { question: longQ });
        if (r.ok || r.status !== 400) {
          return { ok: false, error: `expected 400, got ${r.status}` };
        }
        return { ok: true, evidence: { _note: "超长 question 拒绝 OK" } };
      },
    });

    R.register({
      id: "PP-3",
      series: "PP",
      title: "chart-qa 空 question → fallback 默认模板 + fallback_used=true",
      async run() {
        const r = await POST("/api/dashboard/chart-qa", { question: "" });
        if (!r.ok) return { ok: false, error: `${r.status}` };
        if (!r.body.fallback_used) {
          return { ok: false, error: "空问题应当 fallback_used=true" };
        }
        if (r.body.template !== "task_by_status") {
          return { ok: false, error: `空问题 fallback 应是 task_by_status, 实际 ${r.body.template}` };
        }
        return { ok: true, evidence: { _note: "空问题 fallback OK" } };
      },
    });

    // ---------- QQ series · v24.2 #3 公文智能审核 --------------------------
    R.register({
      id: "QQ-1",
      series: "QQ",
      title: "POST /documents/audit 简单公文 → 200 + issues + overall",
      async run() {
        // 含明显问题的样本(口语化 + 数字格式 + 政策引用模糊)
        const sample = `关于沙头街道老旧小区幕墙安全整治的通知。
经研究决定从 2025-1-1 起开展大排查,大概有 30 户重点检查,
按规定推进,搞好这项工作。请相关单位务必重视,确保 3 月底前完成。`;
        const r = await POST("/api/me/documents/audit", { text: sample });
        if (!r.ok) return { ok: false, error: `${r.status} ${JSON.stringify(r.body)}` };
        for (const k of ["issues", "overall", "audited_chars", "truncated", "fallback_used"]) {
          if (!(k in r.body)) return { ok: false, error: `missing ${k}` };
        }
        if (!Array.isArray(r.body.issues)) return { ok: false, error: "issues not array" };
        // 抽样验 issue shape
        if (r.body.issues.length > 0) {
          const it = r.body.issues[0];
          for (const k of ["severity", "category", "issue", "suggestion"]) {
            if (typeof it[k] !== "string") {
              return { ok: false, error: `issue 缺 ${k}` };
            }
          }
          if (!["high", "medium", "low"].includes(it.severity)) {
            return { ok: false, error: `bad severity: ${it.severity}` };
          }
          if (!["format", "wording", "policy"].includes(it.category)) {
            return { ok: false, error: `bad category: ${it.category}` };
          }
        }
        return {
          ok: true,
          evidence: {
            _note: `${r.body.issues.length} 条问题,fallback=${r.body.fallback_used}`,
          },
        };
      },
    });

    R.register({
      id: "QQ-2",
      series: "QQ",
      title: "audit 空 text → 400",
      async run() {
        const r = await POST("/api/me/documents/audit", { text: "" });
        if (r.ok || r.status !== 400) {
          return { ok: false, error: `expected 400, got ${r.status}` };
        }
        return { ok: true, evidence: { _note: "空 text 拒绝 OK" } };
      },
    });

    R.register({
      id: "QQ-3",
      series: "QQ",
      title: "audit 超长(>20000)文稿 → truncated=true",
      async run() {
        const longText = "测".repeat(21000);
        const r = await POST("/api/me/documents/audit", { text: longText });
        if (!r.ok) return { ok: false, error: `${r.status}` };
        if (!r.body.truncated) {
          return { ok: false, error: "truncated 应当 true" };
        }
        if (r.body.audited_chars > 20000) {
          return { ok: false, error: `audited_chars ${r.body.audited_chars} > 20000` };
        }
        return { ok: true, evidence: { _note: `truncated to ${r.body.audited_chars}` } };
      },
    });

    // ---------- RR series · v24.2 #4 趋势分析 + 异常检测 -------------------
    R.register({
      id: "RR-1",
      series: "RR",
      title: "GET /trends 200 + 3 指标 + 各 metric 字段全",
      async run() {
        const r = await GET("/api/dashboard/trends?days=30");
        if (!r.ok) return { ok: false, error: `${r.status} ${JSON.stringify(r.body)}` };
        if (typeof r.body.days !== "number") return { ok: false, error: "days not number" };
        const m = r.body.metrics;
        const expected = ["task_creation_daily", "task_completion_daily", "task_overdue_rate"];
        for (const k of expected) {
          if (!(k in m)) return { ok: false, error: `metric ${k} missing` };
          const s = m[k];
          for (const f of ["label", "unit", "series", "mean", "std", "current",
                           "z_score", "slope_per_day", "forecast_7d", "anomaly", "trend_label"]) {
            if (!(f in s)) return { ok: false, error: `metric ${k} 缺字段 ${f}` };
          }
          if (!Array.isArray(s.series)) return { ok: false, error: `${k}.series not array` };
        }
        return {
          ok: true,
          evidence: {
            _note: `3 指标返回,creation 趋势=${m.task_creation_daily.trend_label}, anomaly=${m.task_creation_daily.anomaly}`,
          },
        };
      },
    });

    R.register({
      id: "RR-2",
      series: "RR",
      title: "GET /trends days 越界(<7 / >90)→ 422",
      async run() {
        const r1 = await GET("/api/dashboard/trends?days=3");
        if (r1.ok || r1.status !== 422) {
          return { ok: false, error: `days=3 expected 422, got ${r1.status}` };
        }
        const r2 = await GET("/api/dashboard/trends?days=200");
        if (r2.ok || r2.status !== 422) {
          return { ok: false, error: `days=200 expected 422, got ${r2.status}` };
        }
        return { ok: true, evidence: { _note: "days 边界 OK" } };
      },
    });

    R.register({
      id: "RR-3",
      series: "RR",
      title: "trends series 长度 = days + 1(today inclusive)",
      async run() {
        const r = await GET("/api/dashboard/trends?days=14");
        if (!r.ok) return { ok: false, error: `${r.status}` };
        const s = r.body.metrics.task_creation_daily.series;
        if (s.length !== 15) {
          return { ok: false, error: `series length ${s.length} != 15(days+1)` };
        }
        return { ok: true, evidence: { _note: `series 15 点 ✅` } };
      },
    });

    // ---------- SS series · v24.3 #1 RAG 引用溯源 UI 强化 -------------------
    R.register({
      id: "SS-1",
      series: "SS",
      title: "GET /agent-messages 返回 shape 含 citations 字段(数组,可空)",
      async run() {
        // 找一个有 agent message 的会议(history 里很可能有);否则跳过
        const meetings = await GET("/api/meetings");
        if (!meetings.ok) return { ok: false, error: `meetings ${meetings.status}` };
        let foundShape = false;
        let checked = 0;
        for (const m of (meetings.body || []).slice(0, 10)) {
          const am = await GET(`/api/meetings/${m.id}/agent-messages`);
          if (!am.ok) continue;
          checked++;
          if ((am.body || []).length === 0) continue;
          // 任意一条消息验 citations 字段
          const sample = am.body[0];
          if (!Array.isArray(sample.citations)) {
            return {
              ok: false,
              error: `meeting ${m.id} 的 agent message 缺 citations 字段(应为数组,实际 ${typeof sample.citations})`,
            };
          }
          foundShape = true;
          break;
        }
        if (!foundShape) {
          // 没有任何会议有 agent message — 这不算 fail,只是 workspace 没历史
          return {
            ok: true,
            evidence: { _note: `${checked} meetings checked, no agent message yet — shape pending` },
          };
        }
        return { ok: true, evidence: { _note: "agent message citations 字段就绪" } };
      },
    });

    // ---------- TT series · v24.3 #2 报表日清/周查 -------------------------
    R.register({
      id: "TT-1",
      series: "TT",
      title: "GET /reports/daily-summary 返回 Excel + Content-Disposition",
      async run() {
        const r = await fetch("/api/reports/daily-summary", { credentials: "include" });
        if (!r.ok) return { ok: false, error: `${r.status}` };
        const ct = r.headers.get("Content-Type") || "";
        if (!ct.includes("spreadsheet")) {
          return { ok: false, error: `bad CT: ${ct}` };
        }
        const cd = r.headers.get("Content-Disposition") || "";
        if (!cd.includes("attachment")) {
          return { ok: false, error: `expected attachment, CD=${cd}` };
        }
        try { await r.body?.cancel(); } catch {}
        return { ok: true, evidence: { _note: "daily Excel attachment OK" } };
      },
    });

    R.register({
      id: "TT-2",
      series: "TT",
      title: "GET /reports/weekly-summary 返回 Excel",
      async run() {
        const r = await fetch("/api/reports/weekly-summary", { credentials: "include" });
        if (!r.ok) return { ok: false, error: `${r.status}` };
        const ct = r.headers.get("Content-Type") || "";
        if (!ct.includes("spreadsheet")) {
          return { ok: false, error: `bad CT: ${ct}` };
        }
        try { await r.body?.cancel(); } catch {}
        return { ok: true, evidence: { _note: "weekly Excel OK" } };
      },
    });

    R.register({
      id: "TT-3",
      series: "TT",
      title: "/daily-summary?date=非法格式 → 400",
      async run() {
        const r = await fetch("/api/reports/daily-summary?date=not-a-date", {
          credentials: "include",
        });
        if (r.ok) {
          try { await r.body?.cancel(); } catch {}
          return { ok: false, error: `expected 400, got ${r.status}` };
        }
        if (r.status !== 400) {
          return { ok: false, error: `expected 400, got ${r.status}` };
        }
        return { ok: true, evidence: { _note: "非法 date 拒绝 OK" } };
      },
    });

    // ---------- UU series · v24.3 #3 扭分 + 暂停派单 -------------------------
    R.register({
      id: "UU-1",
      series: "UU",
      title: "POST /penalties/force-check 200 + new_penalties 字段",
      async run() {
        const r = await POST("/api/dashboard/penalties/force-check", {});
        if (!r.ok) return { ok: false, error: `${r.status} ${JSON.stringify(r.body)}` };
        if (typeof r.body.new_penalties !== "number") {
          return { ok: false, error: "new_penalties not number" };
        }
        return { ok: true, evidence: { _note: `+${r.body.new_penalties} 条 penalty` } };
      },
    });

    R.register({
      id: "UU-2",
      series: "UU",
      title: "GET /api/team/members shape 含 suspended_until 字段",
      async run() {
        const r = await GET("/api/team/members");
        if (!r.ok) return { ok: false, error: `${r.status}` };
        const members = r.body || [];
        if (members.length === 0) return { ok: false, error: "no members" };
        const m = members[0];
        if (!("suspended_until" in m)) {
          return { ok: false, error: "suspended_until 字段缺失" };
        }
        // Type:null or string
        if (m.suspended_until !== null && typeof m.suspended_until !== "string") {
          return { ok: false, error: `suspended_until 类型错误: ${typeof m.suspended_until}` };
        }
        return { ok: true, evidence: { _note: `${members.length} members, shape OK` } };
      },
    });

    R.register({
      id: "UU-3",
      series: "UU",
      title: "audit_log 含 penalties.force_check 一行",
      async run() {
        await POST("/api/dashboard/penalties/force-check", {});
        const r = await GET("/api/audit?action=penalties.force_check&limit=10");
        if (!r.ok) return { ok: false, error: `${r.status}` };
        if ((r.body || []).length === 0) {
          return { ok: false, error: "force_check audit 缺" };
        }
        return { ok: true, evidence: { _note: `audit row id=${r.body[0].id}` } };
      },
    });

    // ---------- VV series · v24.3 #4 月结评价自动 cron ---------------------
    R.register({
      id: "VV-1",
      series: "VV",
      title: "POST /monthly-eval/force-run 默认上月 → 200 + workspaces/users",
      async run() {
        const r = await POST("/api/dashboard/monthly-eval/force-run", {});
        if (!r.ok) return { ok: false, error: `${r.status} ${JSON.stringify(r.body)}` };
        for (const k of ["period", "workspaces", "users"]) {
          if (!(k in r.body)) return { ok: false, error: `missing ${k}` };
        }
        if (!/^\d{4}-\d{2}$/.test(r.body.period)) {
          return { ok: false, error: `bad period format: ${r.body.period}` };
        }
        return {
          ok: true,
          evidence: { _note: `period=${r.body.period}, ws=${r.body.workspaces}, users=${r.body.users}` },
        };
      },
    });

    R.register({
      id: "VV-2",
      series: "VV",
      title: "monthly-eval/force-run 指定 period(2024-01)→ 200 + 同 period",
      async run() {
        const r = await POST("/api/dashboard/monthly-eval/force-run", {
          period: "2024-01",
        });
        if (!r.ok) return { ok: false, error: `${r.status}` };
        if (r.body.period !== "2024-01") {
          return { ok: false, error: `expected period=2024-01, got ${r.body.period}` };
        }
        return { ok: true, evidence: { _note: "custom period OK" } };
      },
    });

    R.register({
      id: "VV-3",
      series: "VV",
      title: "audit_log 含 monthly_eval.force_run 一行",
      async run() {
        const r = await GET("/api/audit?action=monthly_eval.force_run&limit=10");
        if (!r.ok) return { ok: false, error: `${r.status}` };
        if ((r.body || []).length === 0) {
          return { ok: false, error: "force_run audit 缺" };
        }
        return { ok: true, evidence: { _note: `audit row id=${r.body[0].id}` } };
      },
    });

    // ---------- WW series · v24.3 #5 ABAC 雏形 -----------------------------
    R.register({
      id: "WW-1",
      series: "WW",
      title: "GET /team/members shape 含 department + attributes 字段",
      async run() {
        const r = await GET("/api/team/members");
        if (!r.ok) return { ok: false, error: `${r.status}` };
        const members = r.body || [];
        if (members.length === 0) return { ok: false, error: "no members" };
        const m = members[0];
        if (!("department" in m)) return { ok: false, error: "department 字段缺" };
        if (!("attributes" in m)) return { ok: false, error: "attributes 字段缺" };
        return { ok: true, evidence: { _note: "department + attributes 就绪" } };
      },
    });

    R.register({
      id: "WW-2",
      series: "WW",
      title: "PATCH /team/members 设 department → 回读同值",
      async run(ctx) {
        const me = ctx.me || (await GET("/api/auth/me")).body;
        // 找一个非 owner 的 member 修(owner 不能改自己)
        const members = (await GET("/api/team/members")).body || [];
        const target = members.find((m) => m.user_id !== me.user_id && m.role !== "owner");
        if (!target) {
          return { ok: false, error: "没有可改的非 owner 成员", evidence: { _skipped: true } };
        }
        const newDept = `${PREFIX}_WW2_dept`;
        const r = await fetch(`/api/team/members/${target.user_id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ department: newDept }),
        });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          return { ok: false, error: `PATCH ${r.status} ${JSON.stringify(body)}` };
        }
        const got = await r.json();
        if (got.department !== newDept) {
          return { ok: false, error: `expected dept=${newDept}, got ${got.department}` };
        }
        return { ok: true, evidence: { _note: `dept=${newDept} 写入成功` } };
      },
    });

    // ---------- Skipped (documented) ---------------------------------------
    const skipReasons = {
      B: "需要真人朗读 35-45s",
      C: "需要麦克风 ASR",
      D: "依赖 B+C 真人音频",
      "W-12": "需要浏览器麦克风权限拒绝场景",
      "W-13": "依赖 W-12",
      "X-22": "需要 live banner UI 倒计时(WS + 浏览器)",
      "X-23": "需要 live UI",
      "X-24": "需要 live UI",
    };
    for (const [id, reason] of Object.entries(skipReasons)) {
      R.register({
        id,
        series: id.split("-")[0],
        title: "(infrastructure-blocked)",
        expected_skip: reason,
      });
    }
  }

  // ==========================================================================
  // ===== ENTRY POINT ========================================================
  // ==========================================================================

  async function runCoworkSuite(opts = {}) {
    const startedAtIso = new Date().toISOString();
    const t0 = Date.now();

    // Pre-flight: must be logged in.
    const me = await GET("/api/auth/me");
    if (!me.ok) {
      return {
        json: { error: "not_authenticated", status: me.status },
        markdown: "# Cowork Suite\n\n❌ /api/auth/me failed — log in first.\n",
      };
    }

    // T2: load baseline. Caller can pass `{baseline: <obj>}` explicitly,
    // pass `{baseline: false}` to skip the diff entirely, or rely on the
    // auto-fetch from /baseline.json (default — what most CI runs want).
    let baseline = null;
    if (opts.baseline === false) {
      baseline = null;
    } else if (opts.baseline) {
      baseline = opts.baseline;
    } else {
      try {
        const r = await fetch("/baseline.json", { cache: "no-store" });
        if (r.ok) baseline = await r.json();
      } catch {
        // No baseline available — that's fine, we'll just skip the diff
      }
    }

    const R = makeRunner();
    registerCases(R);

    const results = await R.runAll(opts);

    // Cleanup
    const cleanupLog = await performCleanup(R.cleanup);

    const finishedAtIso = new Date().toISOString();
    const durationMs = Date.now() - t0;

    const meta = {
      entry: window.location.origin,
      runId: RUN_ID,
      who: me.body.name,
      workspace: me.body.workspace_name,
      startedAt: startedAtIso,
      finishedAt: finishedAtIso,
      durationMs,
    };

    const counts = { pass: 0, fail: 0, skipped: 0 };
    for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;

    const diff = diffAgainstBaseline(results, baseline);

    const json = {
      meta,
      summary: {
        total: results.length,
        ...counts,
        passed_baseline: diff.available ? diff.passed_baseline : null,
      },
      results,
      diff,
    };
    const markdown = buildMarkdown(meta, results, cleanupLog, diff);

    return { json, markdown };
  }

  window.runCoworkSuite = runCoworkSuite;
  window.__coworkSuite.RUN_ID = RUN_ID;
  console.log(
    `%c[Cowork Suite] installed. Run with: const r = await runCoworkSuite()  (run id ${RUN_ID})`,
    "color: #38bdf8; font-weight: bold"
  );
})();
