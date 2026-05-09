/**
 * v23 — Headless Cowork runner via Playwright.
 *
 * 在 GitHub Actions 里跑(workflow_dispatch 触发).不适合本地频繁跑
 * (会触动 prod / staging 数据).
 *
 * 流程:
 *   1. 启动 Chromium headless
 *   2. 访问登录页 → 填邮箱 + 密码 → 登入
 *   3. fetch /cowork_suite.js + new Function() 注入
 *   4. await runCoworkSuite()
 *   5. 把 markdown + json 写到磁盘(GitHub Actions 上传 artifact)
 *   6. 退出码 0 = passed_baseline=true,1 = 有偏差(让 workflow 红显)
 */

const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const BASE_URL = process.env.AIMEETING_BASE_URL || "https://aimeeting.zhzjpt.cn";
const EMAIL = process.env.AIMEETING_TEST_EMAIL;
const PASSWORD = process.env.AIMEETING_TEST_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error(
    "❌ 必填环境变量缺失:AIMEETING_TEST_EMAIL + AIMEETING_TEST_PASSWORD",
  );
  console.error("workflow_dispatch 触发时,请先在 repo Settings → Secrets 里配好.");
  process.exit(2);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  console.log(`▸ Navigating to ${BASE_URL}/login`);
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });

  // 简单选择器(Aimeeting 登录页有 input[type="email"] + input[type="password"])
  console.log("▸ Logging in");
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();

  // 等到 /api/auth/me 返回 200 + 跳到首页
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 15000,
  });
  console.log("▸ Logged in, now at:", page.url());

  // 注入 cowork_suite + 跑回归
  console.log("▸ Loading cowork_suite.js + invoking runCoworkSuite()");
  const result = await page.evaluate(async () => {
    const src = await fetch("/cowork_suite.js?v=" + Date.now()).then((r) =>
      r.text(),
    );
    new Function(src)();
    // @ts-ignore — runCoworkSuite is set on window by the suite
    return await window.runCoworkSuite();
  }, { timeout: 600000 });

  // 落盘
  const outDir = path.join(__dirname);
  fs.writeFileSync(
    path.join(outDir, "cowork-report.md"),
    result.markdown || "# Empty report\n",
  );
  fs.writeFileSync(
    path.join(outDir, "cowork-report.json"),
    JSON.stringify(result.json, null, 2),
  );

  const summary = result.json && result.json.summary;
  console.log("▸ Result summary:", JSON.stringify(summary, null, 2));

  await browser.close();

  // 退出码
  if (!summary) {
    console.error("❌ no summary");
    process.exit(1);
  }
  if (summary.fail > 0 || summary.passed_baseline === false) {
    console.error("❌ 与 baseline 有偏差,详见 cowork-report.md");
    process.exit(1);
  }
  console.log("✅ 通过 — 与 baseline 一致");
  process.exit(0);
})().catch((e) => {
  console.error("❌ runner crashed:", e);
  process.exit(2);
});
