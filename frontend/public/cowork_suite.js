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
