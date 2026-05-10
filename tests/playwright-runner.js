/**
 * v24.1 — Multi-account headless Cowork runner via Playwright.
 *
 * 跑方式(从 v23 单账号扩成多账号):
 *
 * 1. JSON 文件(推荐,本地多账号):
 *      node playwright-runner.js path/to/accounts.json
 *    accounts.json 格式:
 *      [
 *        {"email":"a@x.com","password":"p1","label":"admin"},
 *        {"email":"b@x.com","password":"p2","label":"member"},
 *        ...
 *      ]
 *
 * 2. 单账号(GitHub Actions / 老用法 — 完全 back-compat):
 *      AIMEETING_TEST_EMAIL=... AIMEETING_TEST_PASSWORD=... node playwright-runner.js
 *
 * 输出:
 *   tests/cowork-results/<label>-<safeEmail>.json   每账号一份完整 json
 *   tests/cowork-results/<label>-<safeEmail>.md     每账号 markdown
 *   tests/cowork-multi-report.md                    汇总矩阵(case × account)
 *
 * 退出码:
 *   0 — 所有账号 passed_baseline=true
 *   1 — 至少一个账号有 baseline 偏差(让 CI 红显)
 *   2 — runner 崩(账号 / 配置 / 浏览器问题)
 */

const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const BASE_URL = process.env.AIMEETING_BASE_URL || "https://aimeeting.zhzjpt.cn";

function loadAccounts() {
  const argFile = process.argv[2];
  if (argFile && fs.existsSync(argFile)) {
    const raw = fs.readFileSync(argFile, "utf-8");
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) {
      console.error(`❌ ${argFile} 必须是非空 JSON 数组`);
      process.exit(2);
    }
    return arr;
  }
  if (process.env.AIMEETING_TEST_EMAIL && process.env.AIMEETING_TEST_PASSWORD) {
    return [
      {
        email: process.env.AIMEETING_TEST_EMAIL,
        password: process.env.AIMEETING_TEST_PASSWORD,
        label: process.env.AIMEETING_TEST_LABEL || "default",
      },
    ];
  }
  console.error("❌ 未提供账号 — 用法见文件头注释");
  process.exit(2);
}

const ACCOUNTS = loadAccounts();
console.log(`▸ ${ACCOUNTS.length} 个账号要跑:`);
for (const a of ACCOUNTS) console.log(`  - ${a.label} <${a.email}>`);

async function runForAccount(browser, account) {
  console.log(`\n▸▸▸ Account: ${account.label} <${account.email}>`);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    console.log(`  ▸ login`);
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.locator('input[type="email"]').fill(account.email);
    await page.locator('input[type="password"]').fill(account.password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 15000,
    });
    console.log(`  ▸ logged in, at ${page.url()}`);

    console.log(`  ▸ injecting + running cowork_suite`);
    const result = await page.evaluate(
      async () => {
        const src = await fetch("/cowork_suite.js?v=" + Date.now()).then(
          (r) => r.text(),
        );
        new Function(src)();
        // @ts-ignore
        return await window.runCoworkSuite();
      },
      { timeout: 600000 },
    );
    return result;
  } finally {
    await ctx.close();
  }
}

function caseStatusEmoji(status) {
  if (status === "pass") return "✅";
  if (status === "fail") return "❌";
  if (status === "skipped") return "⏭️";
  return "⁇";
}

/**
 * 矩阵报告:行=case_id,列=account label,格子=status emoji.
 * 失败的格子带 inline 错误简述(裁前 60 字).
 */
function buildMatrix(allRuns) {
  const accountLabels = allRuns.map((r) => r.account.label);
  // 收集所有出现过的 case_id(union)
  const caseIds = new Set();
  for (const run of allRuns) {
    if (!run.json || !run.json.results) continue;
    for (const c of run.json.results) caseIds.add(c.id);
  }
  const sortedCases = Array.from(caseIds).sort((a, b) => {
    // 按 series + 编号自然排
    const [as, an] = [a.split("-")[0], parseInt(a.split("-")[1] || "0", 10)];
    const [bs, bn] = [b.split("-")[0], parseInt(b.split("-")[1] || "0", 10)];
    if (as !== bs) return as < bs ? -1 : 1;
    return (an || 0) - (bn || 0);
  });

  const lines = [];
  lines.push(`# Aimeeting Multi-Account Cowork Report`);
  lines.push("");
  lines.push(`Run at: ${new Date().toISOString()}`);
  lines.push(`Base URL: ${BASE_URL}`);
  lines.push("");

  // 顶部 summary
  lines.push("## Per-account summary");
  lines.push("");
  lines.push("| Account | Total | ✅ Pass | ❌ Fail | ⏭️ Skip | passed_baseline |");
  lines.push("|---|---:|---:|---:|---:|:---:|");
  for (const run of allRuns) {
    const s = run.json?.summary || {};
    lines.push(
      `| **${run.account.label}** <${run.account.email}> | ${s.total ?? "—"} | ${s.pass ?? "—"} | ${s.fail ?? "—"} | ${s.skipped ?? "—"} | ${s.passed_baseline === true ? "✅" : s.passed_baseline === false ? "❌" : "—"} |`,
    );
  }
  lines.push("");

  // 矩阵主体
  lines.push("## Case × Account matrix");
  lines.push("");
  lines.push(`| Case | ${accountLabels.join(" | ")} |`);
  lines.push(`|---|${accountLabels.map(() => ":---:").join("|")}|`);

  for (const cid of sortedCases) {
    const cells = allRuns.map((run) => {
      const c = (run.json?.results || []).find((x) => x.id === cid);
      if (!c) return "—";
      const e = caseStatusEmoji(c.status);
      if (c.status === "fail") {
        const err = (c.error || "").slice(0, 60).replace(/\|/g, "\\|");
        return `${e} <sup>${err}</sup>`;
      }
      return e;
    });
    lines.push(`| \`${cid}\` | ${cells.join(" | ")} |`);
  }
  lines.push("");

  // 关键差异:同一个 case,不同账号结果不同 → 标红高亮
  lines.push("## ⚠️ Cross-account divergence(同一用例,不同账号结果不同)");
  lines.push("");
  lines.push("一般是「权限正确生效」的体现(e.g. dispatch 只有 leader 能调).但可以扫一眼有没有意外.");
  lines.push("");
  let div = 0;
  for (const cid of sortedCases) {
    const statuses = allRuns.map(
      (run) => (run.json?.results || []).find((x) => x.id === cid)?.status,
    );
    const uniq = new Set(statuses.filter(Boolean));
    if (uniq.size > 1) {
      div++;
      lines.push(`- \`${cid}\`: ${statuses.map((s, i) => `${accountLabels[i]}=${s || "—"}`).join(" / ")}`);
    }
  }
  if (div === 0) lines.push("(无差异 — 所有账号结果一致)");
  lines.push("");

  return lines.join("\n");
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const allRuns = [];
  let crashed = false;

  for (const acc of ACCOUNTS) {
    try {
      const result = await runForAccount(browser, acc);
      allRuns.push({ account: acc, ...result });
      const s = result.json?.summary;
      console.log(
        `  ▸ ${acc.label} done: total=${s?.total} pass=${s?.pass} fail=${s?.fail} skipped=${s?.skipped} baseline=${s?.passed_baseline}`,
      );
    } catch (e) {
      console.error(`❌ ${acc.label} <${acc.email}> crashed:`, e.message || e);
      allRuns.push({ account: acc, error: String(e.message || e) });
      crashed = true;
    }
  }

  await browser.close();

  // 落盘
  const outDir = path.join(__dirname, "cowork-results");
  fs.mkdirSync(outDir, { recursive: true });
  for (const run of allRuns) {
    const safe = `${run.account.label}-${run.account.email.replace(/[^a-zA-Z0-9]/g, "_")}`;
    fs.writeFileSync(
      path.join(outDir, `${safe}.json`),
      JSON.stringify(run.json || { error: run.error }, null, 2),
    );
    if (run.markdown) {
      fs.writeFileSync(path.join(outDir, `${safe}.md`), run.markdown);
    }
  }
  fs.writeFileSync(
    path.join(__dirname, "cowork-multi-report.md"),
    buildMatrix(allRuns),
  );

  console.log("\n▸ 报告写入:");
  console.log(`  - ${path.join(__dirname, "cowork-multi-report.md")}`);
  console.log(`  - ${outDir}/<label>-<email>.{json,md}`);

  // 退出码
  if (crashed) process.exit(1);
  const allOk = allRuns.every(
    (r) => r.json?.summary?.passed_baseline === true,
  );
  if (!allOk) {
    console.error("\n❌ 至少一个账号 passed_baseline 不为 true");
    process.exit(1);
  }
  console.log("\n✅ 所有账号都通过 baseline");
  process.exit(0);
})().catch((e) => {
  console.error("❌ runner crashed at top level:", e);
  process.exit(2);
});
